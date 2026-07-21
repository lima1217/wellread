//! Eve sidecar lifecycle: spawn bundled Node + `.output`, discover port,
//! inject loopback token, restart on model config reload, kill on exit.

use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

const HEALTH_TIMEOUT: Duration = Duration::from_secs(30);
const HEALTH_POLL: Duration = Duration::from_millis(200);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EveSidecarInfo {
    pub base_url: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfigPayload {
    pub enabled: Option<bool>,
    pub base_url: Option<String>,
    pub model_id: Option<String>,
    pub context_window_tokens: Option<u64>,
    /// `chat` (Chat Completions) or `responses` (OpenAI Responses API).
    pub api_mode: Option<String>,
    /// Optional apiKey from the frontend (already written to keychain).
    /// Passed over local IPC so the main crate need not own keyring deps.
    pub api_key: Option<String>,
}

struct EveSidecarInner {
    child: Option<Child>,
    info: Option<EveSidecarInfo>,
    last_api_key: Option<String>,
    /// Bumped on each start attempt so a stale health-check finish cannot
    /// overwrite a newer reload (last writer wins by generation).
    generation: u64,
}

pub struct EveSidecarState {
    inner: Mutex<EveSidecarInner>,
}

impl EveSidecarState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(EveSidecarInner {
                child: None,
                info: None,
                last_api_key: None,
                generation: 0,
            }),
        }
    }
}

/// Parse a Nitro/eve listen URL from a stdout line; normalize wildcards to loopback.
pub fn parse_listen_url(line: &str) -> Option<String> {
    let http = line.find("http://").or_else(|| line.find("https://"))?;
    let rest = &line[http..];
    let end = rest
        .find(|c: char| c.is_whitespace() || c == ',' || c == '"')
        .unwrap_or(rest.len());
    let mut raw = rest[..end].trim_end_matches('/').to_string();
    if let Some(stripped) = raw.strip_prefix("http://0.0.0.0") {
        raw = format!("http://127.0.0.1{stripped}");
    } else if let Some(stripped) = raw.strip_prefix("https://0.0.0.0") {
        raw = format!("https://127.0.0.1{stripped}");
    }
    if !raw.ends_with('/') {
        raw.push('/');
    }
    Some(raw)
}

fn random_token() -> String {
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Map `settings.json` → sidecar reload payload.
///
/// Supports the multi-ModelProfile schema (`activeProfileId` + `profiles[]`)
/// and falls back to the legacy flat `{ baseURL, modelId, … }` shape.
fn parse_model_config_from_value(value: &serde_json::Value) -> ModelConfigPayload {
    let Some(mc) = value.get("modelConfig") else {
        return ModelConfigPayload::default();
    };
    let enabled = mc.get("enabled").and_then(|v| v.as_bool());

    // Multi-profile schema (current frontend persistence).
    if let Some(profiles) = mc.get("profiles").and_then(|v| v.as_array()) {
        let active_id = mc.get("activeProfileId").and_then(|v| v.as_str());
        let profile = active_id.and_then(|id| {
            profiles
                .iter()
                .find(|p| p.get("id").and_then(|v| v.as_str()) == Some(id))
        });
        return match profile {
            Some(p) => endpoint_payload_from(enabled, p),
            None => ModelConfigPayload {
                enabled,
                ..ModelConfigPayload::default()
            },
        };
    }

    // Legacy flat single-track schema.
    endpoint_payload_from(enabled, mc)
}

fn endpoint_payload_from(enabled: Option<bool>, obj: &serde_json::Value) -> ModelConfigPayload {
    ModelConfigPayload {
        enabled,
        base_url: obj
            .get("baseURL")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        model_id: obj
            .get("modelId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        context_window_tokens: obj.get("contextWindowTokens").and_then(|v| v.as_u64()),
        api_mode: obj
            .get("apiMode")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        api_key: None,
    }
}

fn read_model_config_from_settings(app: &AppHandle) -> ModelConfigPayload {
    let Ok(dir) = app.path().app_config_dir() else {
        return ModelConfigPayload::default();
    };
    let path = dir.join("settings.json");
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return ModelConfigPayload::default();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return ModelConfigPayload::default();
    };
    parse_model_config_from_value(&value)
}

fn resolve_node_bin(app: &AppHandle) -> PathBuf {
    let triple = env!("WELLREAD_TARGET");
    let sidecar_name = format!("node-{triple}");

    // Production: Tauri copies externalBin next to the main executable as `node`
    // (triple suffix stripped). Prefer that before falling back to PATH.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join("node");
            if bundled.exists() {
                return bundled;
            }
            let triple_named = dir.join(&sidecar_name);
            if triple_named.exists() {
                return triple_named;
            }
        }
    }

    if let Ok(resource) = app.path().resource_dir() {
        let candidate = resource.join("binaries").join(&sidecar_name);
        if candidate.exists() {
            return candidate;
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(&sidecar_name);
    if dev.exists() {
        return dev;
    }
    PathBuf::from("node")
}

fn resolve_eve_output(app: &AppHandle) -> PathBuf {
    if let Ok(resource) = app.path().resource_dir() {
        let candidate = resource
            .join("eve")
            .join(".output")
            .join("server")
            .join("index.mjs");
        if candidate.exists() {
            return candidate;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../eve-sidecar/.output/server/index.mjs")
}

/// Prefer packaged `.output/node_modules`, then repo eve-sidecar node_modules (dev).
fn resolve_node_modules(app: &AppHandle, entry: &Path) -> Option<PathBuf> {
    if let Some(server_dir) = entry.parent() {
        if let Some(output_dir) = server_dir.parent() {
            let packaged = output_dir.join("node_modules");
            if packaged.exists() {
                return Some(packaged);
            }
        }
    }
    if let Ok(resource) = app.path().resource_dir() {
        let packaged = resource.join("eve").join(".output").join("node_modules");
        if packaged.exists() {
            return Some(packaged);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../eve-sidecar/node_modules");
    if dev.exists() {
        return Some(dev);
    }
    None
}

fn resolve_eve_data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("eve")
}

/// Books library root — mirrors LOCAL_BOOKS_SUBDIR (`Wellread/Books`) under app data.
fn resolve_books_root(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("Wellread")
        .join("Books")
}

fn stop_locked(inner: &mut EveSidecarInner) {
    if let Some(mut child) = inner.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    inner.info = None;
}

/// Build the HTTP client used for loopback readiness probes.
///
/// Must disable proxies: with a system HTTP proxy (Clash/V2Ray/etc.), reqwest's
/// macOS system-proxy support sends `http://127.0.0.1:<sidecar>` through the
/// proxy, which returns 502 and makes health checks time out even though the
/// sidecar is healthy.
fn health_client() -> Result<reqwest::blocking::Client, reqwest::Error> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .no_proxy()
        .build()
}

fn health_ok(url: &str, token: &str) -> bool {
    let Ok(client) = health_client() else {
        return false;
    };
    client
        .get(url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Start (or replace) the sidecar; stores child + info in managed state.
///
/// Returns `Ok(None)` when AI is disabled (`enabled == Some(false)`): any
/// running child is stopped and nothing is spawned. Health probing runs
/// without holding the state mutex so `get_eve_sidecar_info` stays responsive.
pub fn start_or_restart(
    app: &AppHandle,
    model: ModelConfigPayload,
) -> Result<Option<EveSidecarInfo>, String> {
    let state = app.state::<EveSidecarState>();

    // Hold the lock only for stop / env prep / spawn bookkeeping — not for the
    // up-to-30s health wait below.
    let (mut child, token, base_url_rx, generation) = {
        let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
        stop_locked(&mut inner);

        if model.enabled == Some(false) {
            // Invalidate in-flight health checks from a prior start.
            inner.generation = inner.generation.wrapping_add(1);
            return Ok(None);
        }

        let node = resolve_node_bin(app);
        let entry = resolve_eve_output(app);
        if !entry.exists() {
            return Err(format!("eve sidecar entry missing: {}", entry.display()));
        }
        let data_dir = resolve_eve_data_dir(app);
        std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

        let token = random_token();
        let api_key = model
            .api_key
            .clone()
            .or_else(|| inner.last_api_key.clone())
            .unwrap_or_default();
        if let Some(key) = &model.api_key {
            inner.last_api_key = if key.is_empty() {
                None
            } else {
                Some(key.clone())
            };
        }

        inner.generation = inner.generation.wrapping_add(1);
        let generation = inner.generation;

        let mut cmd = Command::new(&node);
        cmd.arg(&entry)
            .env("HOST", "127.0.0.1")
            .env("NITRO_HOST", "127.0.0.1")
            .env("PORT", "0")
            .env("NITRO_PORT", "0")
            .env("EVE_LOOPBACK_TOKEN", &token)
            .env("EVE_DATA_DIR", &data_dir)
            .env(
                "EVE_MODEL_BASE_URL",
                model
                    .base_url
                    .clone()
                    .unwrap_or_else(|| "https://api.deepseek.com/v1".into()),
            )
            .env(
                "EVE_MODEL_ID",
                model
                    .model_id
                    .clone()
                    .unwrap_or_else(|| "deepseek-v4-flash".into()),
            )
            .env(
                "EVE_MODEL_CONTEXT_WINDOW",
                model.context_window_tokens.unwrap_or(1_000_000).to_string(),
            )
            .env(
                "EVE_MODEL_API_MODE",
                match model.api_mode.as_deref() {
                    Some("responses") => "responses",
                    _ => "chat",
                },
            )
            .env("EVE_MODEL_API_KEY", api_key)
            .env("EVE_BOOKS_ROOT", resolve_books_root(app))
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(parent) = entry.parent() {
            cmd.current_dir(parent);
        }

        if let Some(node_path) = resolve_node_modules(app, &entry) {
            cmd.env("NODE_PATH", node_path);
        }

        let mut child = cmd.spawn().map_err(|e| format!("spawn eve sidecar: {e}"))?;
        let stdout = child.stdout.take().ok_or("missing sidecar stdout")?;
        if let Some(stderr) = child.stderr.take() {
            thread::spawn(move || {
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    log::info!("[eve-sidecar:err] {line}");
                }
            });
        }

        let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
        thread::spawn(move || {
            let mut found = None;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                log::info!("[eve-sidecar] {line}");
                if found.is_none() {
                    if let Some(url) = parse_listen_url(&line) {
                        found = Some(url.clone());
                        let _ = tx.send(Some(url));
                    }
                }
            }
            if found.is_none() {
                let _ = tx.send(None);
            }
        });

        (child, token, rx, generation)
    };

    let base_url = match base_url_rx.recv_timeout(HEALTH_TIMEOUT) {
        Ok(Some(url)) => url,
        Ok(None) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("eve sidecar exited before printing listen URL".to_string());
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("timed out waiting for eve listen URL".to_string());
        }
    };

    let health_url = format!("{base_url}eve/v1");
    let deadline = Instant::now() + HEALTH_TIMEOUT;
    loop {
        if Instant::now() > deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("eve sidecar health check timed out".into());
        }
        if health_ok(&health_url, &token) {
            break;
        }
        thread::sleep(HEALTH_POLL);
    }

    let info = EveSidecarInfo {
        base_url: base_url.trim_end_matches('/').to_string(),
        token,
    };

    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    if inner.generation != generation {
        // A newer reload won; discard this child.
        let _ = child.kill();
        let _ = child.wait();
        return Ok(inner.info.clone());
    }
    inner.child = Some(child);
    inner.info = Some(info.clone());
    Ok(Some(info))
}

pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<EveSidecarState>() {
        if let Ok(mut inner) = state.inner.lock() {
            stop_locked(&mut inner);
        }
    }
}

#[tauri::command]
pub fn get_eve_sidecar_info(state: State<'_, EveSidecarState>) -> Option<EveSidecarInfo> {
    state.inner.lock().ok().and_then(|g| g.info.clone())
}

#[tauri::command]
pub fn reload_eve_sidecar(
    app: AppHandle,
    model: Option<ModelConfigPayload>,
) -> Result<Option<EveSidecarInfo>, String> {
    let model = model.unwrap_or_else(|| read_model_config_from_settings(&app));
    match start_or_restart(&app, model) {
        Ok(info) => Ok(info),
        Err(err) => {
            log::error!("reload_eve_sidecar failed: {err}");
            Err(err)
        }
    }
}

pub fn bootstrap(app: &AppHandle) {
    let model = read_model_config_from_settings(app);
    if model.enabled == Some(false) {
        log::info!("eve sidecar bootstrap skipped: AI disabled");
        return;
    }
    // Do not spawn here. Rust cannot read the OS keychain; the frontend
    // `syncEveSidecarApiKey` starts the sidecar once after settings load with
    // the active ModelProfile + apiKey (P0-2: avoid wrong/keyless start then
    // immediate restart).
    log::info!("eve sidecar bootstrap deferred to frontend key sync");
}

#[cfg(test)]
mod tests {
    use super::{health_ok, parse_listen_url, parse_model_config_from_value};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Mutex;
    use std::thread;

    static PROXY_ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn parses_listen_line() {
        assert_eq!(
            parse_listen_url("Listening http://127.0.0.1:54321/").as_deref(),
            Some("http://127.0.0.1:54321/")
        );
    }

    #[test]
    fn normalizes_wildcard() {
        let url = parse_listen_url("Listening on http://0.0.0.0:4123").unwrap();
        assert!(url.contains("127.0.0.1"));
        assert!(url.ends_with('/'));
    }

    #[test]
    fn parses_legacy_flat_model_config() {
        let value = serde_json::json!({
            "modelConfig": {
                "enabled": true,
                "baseURL": "https://api.example.com/v1",
                "modelId": "legacy-model",
                "contextWindowTokens": 128000,
                "apiMode": "responses"
            }
        });
        let payload = parse_model_config_from_value(&value);
        assert_eq!(payload.enabled, Some(true));
        assert_eq!(
            payload.base_url.as_deref(),
            Some("https://api.example.com/v1")
        );
        assert_eq!(payload.model_id.as_deref(), Some("legacy-model"));
        assert_eq!(payload.context_window_tokens, Some(128000));
        assert_eq!(payload.api_mode.as_deref(), Some("responses"));
    }

    #[test]
    fn parses_active_profile_from_multi_profile_schema() {
        let value = serde_json::json!({
            "modelConfig": {
                "enabled": true,
                "activeProfileId": "openai-work",
                "profiles": [
                    {
                        "id": "deepseek-default",
                        "name": "DeepSeek",
                        "baseURL": "https://api.deepseek.com/v1",
                        "modelId": "deepseek-v4-flash",
                        "contextWindowTokens": 1000000,
                        "apiMode": "chat"
                    },
                    {
                        "id": "openai-work",
                        "name": "OpenAI",
                        "baseURL": "https://api.openai.com/v1",
                        "modelId": "gpt-4o",
                        "contextWindowTokens": 128000,
                        "apiMode": "responses"
                    }
                ]
            }
        });
        let payload = parse_model_config_from_value(&value);
        assert_eq!(payload.enabled, Some(true));
        assert_eq!(
            payload.base_url.as_deref(),
            Some("https://api.openai.com/v1")
        );
        assert_eq!(payload.model_id.as_deref(), Some("gpt-4o"));
        assert_eq!(payload.context_window_tokens, Some(128000));
        assert_eq!(payload.api_mode.as_deref(), Some("responses"));
    }

    #[test]
    fn multi_profile_missing_active_leaves_endpoint_fields_empty() {
        let value = serde_json::json!({
            "modelConfig": {
                "enabled": false,
                "activeProfileId": "gone",
                "profiles": [
                    {
                        "id": "deepseek-default",
                        "baseURL": "https://api.deepseek.com/v1",
                        "modelId": "deepseek-v4-flash",
                        "contextWindowTokens": 1000000,
                        "apiMode": "chat"
                    }
                ]
            }
        });
        let payload = parse_model_config_from_value(&value);
        assert_eq!(payload.enabled, Some(false));
        assert!(payload.base_url.is_none());
        assert!(payload.model_id.is_none());
        assert!(payload.context_window_tokens.is_none());
        assert!(payload.api_mode.is_none());
    }

    #[test]
    fn health_ok_reaches_loopback_despite_http_proxy_env() {
        let _guard = PROXY_ENV_LOCK.lock().unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let addr = listener.local_addr().expect("local_addr");
        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 1024];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}",
                );
            }
        });

        let prev_http = std::env::var("HTTP_PROXY").ok();
        let prev_http_l = std::env::var("http_proxy").ok();
        // Dead proxy — without .no_proxy() the probe would fail here (and under
        // macOS system proxy it fails even when the sidecar is healthy).
        std::env::set_var("HTTP_PROXY", "http://127.0.0.1:9");
        std::env::set_var("http_proxy", "http://127.0.0.1:9");

        let url = format!("http://{addr}/eve/v1");
        let ok = health_ok(&url, "test-token");

        match prev_http {
            Some(v) => std::env::set_var("HTTP_PROXY", v),
            None => std::env::remove_var("HTTP_PROXY"),
        }
        match prev_http_l {
            Some(v) => std::env::set_var("http_proxy", v),
            None => std::env::remove_var("http_proxy"),
        }

        assert!(ok, "loopback health probe must bypass HTTP_PROXY");
    }
}
