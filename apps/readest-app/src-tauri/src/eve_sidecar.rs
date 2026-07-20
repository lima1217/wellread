//! Eve sidecar lifecycle: spawn bundled Node + `.output`, discover port,
//! inject loopback token, restart on model config reload, kill on exit.

use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
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
    /// Optional apiKey from the frontend (already written to keychain).
    /// Passed over local IPC so the main crate need not own keyring deps.
    pub api_key: Option<String>,
}

struct EveSidecarInner {
    child: Option<Child>,
    info: Option<EveSidecarInfo>,
    last_api_key: Option<String>,
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
    let Some(mc) = value.get("modelConfig") else {
        return ModelConfigPayload::default();
    };
    ModelConfigPayload {
        enabled: mc.get("enabled").and_then(|v| v.as_bool()),
        base_url: mc
            .get("baseURL")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        model_id: mc
            .get("modelId")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        context_window_tokens: mc.get("contextWindowTokens").and_then(|v| v.as_u64()),
        api_key: None,
    }
}

fn resolve_node_bin(app: &AppHandle) -> PathBuf {
    let triple = env!("READEST_TARGET");
    let sidecar_name = format!("node-{triple}");
    if let Ok(resource) = app.path().resource_dir() {
        let candidate = resource.join("binaries").join(&sidecar_name);
        if candidate.exists() {
            return candidate;
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join(&sidecar_name);
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

fn resolve_eve_data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("eve")
}

fn stop_locked(inner: &mut EveSidecarInner) {
    if let Some(mut child) = inner.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    inner.info = None;
}

fn health_ok(url: &str, token: &str) -> bool {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build();
    let Ok(client) = client else {
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
pub fn start_or_restart(
    app: &AppHandle,
    model: ModelConfigPayload,
) -> Result<EveSidecarInfo, String> {
    let state = app.state::<EveSidecarState>();
    let mut inner = state.inner.lock().map_err(|e| e.to_string())?;
    stop_locked(&mut inner);

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
        .env("EVE_MODEL_API_KEY", api_key)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(parent) = entry.parent() {
        cmd.current_dir(parent);
    }

    let sidecar_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../eve-sidecar");
    if sidecar_root.join("node_modules").exists() {
        cmd.env(
            "NODE_PATH",
            sidecar_root.join("node_modules").display().to_string(),
        );
    }

    let mut child = cmd.spawn().map_err(|e| format!("spawn eve sidecar: {e}"))?;
    let stdout = child.stdout.take().ok_or("missing sidecar stdout")?;
    if let Some(stderr) = child.stderr.take() {
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().flatten() {
                log::info!("[eve-sidecar:err] {line}");
            }
        });
    }

    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    thread::spawn(move || {
        let mut found = None;
        for line in BufReader::new(stdout).lines().flatten() {
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

    let base_url = rx
        .recv_timeout(HEALTH_TIMEOUT)
        .map_err(|_| "timed out waiting for eve listen URL".to_string())?
        .ok_or_else(|| "eve sidecar exited before printing listen URL".to_string())?;

    let health_url = format!("{base_url}eve/v1");
    let deadline = Instant::now() + HEALTH_TIMEOUT;
    loop {
        if Instant::now() > deadline {
            let _ = child.kill();
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
    inner.child = Some(child);
    inner.info = Some(info.clone());
    Ok(info)
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
        Ok(info) => Ok(Some(info)),
        Err(err) => {
            log::error!("reload_eve_sidecar failed: {err}");
            Err(err)
        }
    }
}

pub fn bootstrap(app: &AppHandle) {
    let model = read_model_config_from_settings(app);
    if let Err(err) = start_or_restart(app, model) {
        log::warn!("eve sidecar bootstrap skipped: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::parse_listen_url;

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
}
