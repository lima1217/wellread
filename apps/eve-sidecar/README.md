# @wellread/eve-sidecar

Loopback HTTP sidecar for wellread’s Reading Assistant. Speaks an eve-compatible `/eve/v1` surface: sessions, streaming turns (AI SDK UIMessage chunks), Books FS tools, and `/skill:<id>` packages.

Rust boots this process from `apps/readest-app/src-tauri/src/eve_sidecar.rs` (random port, Bearer token, model env). The webview talks to it via `@tauri-apps/plugin-http` (`eveFetch`), which bypasses browser CORS.

## Layout

| Path | Role |
| --- | --- |
| `src/server/` | HTTP handshake, auth, CORS, turn gate |
| `src/agent/` | `runTurn`, prompts, tools, session store, skills |
| `src/books/` | `/workspace` path sandbox over Books root |
| `src/createModel*.mjs` | OpenAI-compatible model wiring + host adapters |
| `bundled-skills/` | Default skill packages shipped with the sidecar |
| `scripts/build.mjs` | Packs a self-contained `.output/` for Tauri resources |
| `eval/` | Contract / regression evals |

## Handshake

1. Listen on `127.0.0.1` with `PORT=0` (or `NITRO_PORT`).
2. Print exactly one line: `Listening http://127.0.0.1:<port>/`
3. Rust parses that line, then probes `GET /eve/v1` with `Authorization: Bearer <token>`.

Fail-closed at boot: missing `EVE_LOOPBACK_TOKEN` exits non-zero unless `EVE_ALLOW_NO_TOKEN=1`.

## Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `EVE_LOOPBACK_TOKEN` | yes* | Bearer token; *skip only with `EVE_ALLOW_NO_TOKEN=1` |
| `EVE_ALLOW_NO_TOKEN` | no | `1` = local debug only; auth open, CORS still allowlisted |
| `EVE_DATA_DIR` | no | Default `./.eve-data`; sessions under `<dir>/sessions/` |
| `EVE_BOOKS_ROOT` | for tools/skills | Host Books directory mapped to `/workspace` |
| `EVE_MODEL_BASE_URL` | no | OpenAI-compatible base (default DeepSeek) |
| `EVE_MODEL_API_KEY` | for turns | Empty → `modelReady: false`, turns return 503 |
| `EVE_MODEL_ID` | no | Model id |
| `EVE_MODEL_CONTEXT_WINDOW` | no | Token budget for compress / context |
| `EVE_MODEL_API_MODE` | no | `responses` (default, DeepSeek web_search) or `chat` |
| `EVE_CORS_ORIGINS` | no | Extra comma-separated Origins appended to the allowlist |
| `EVE_MAX_TOOL_ROUNDS` | no | Cap tool steps per turn |
| `EVE_FINAL_MAX_OUTPUT_TOKENS` | no | Final-step output token cap |
| `EVE_TURN_LOG` | no | `1` → JSON turn-contract lines on stderr |
| `PORT` / `NITRO_PORT` | no | Prefer `0` (ephemeral) |

## CORS / security surface

- Origins are **allowlisted** (wellread webviews: `localhost:3000/3001`, `tauri.localhost`, `tauri://localhost`). Unknown `Origin` values do **not** get `Access-Control-Allow-Origin` (no reflection, never `*`).
- Add debug origins with `EVE_CORS_ORIGINS=http://127.0.0.1:4173`.
- Tauri production traffic uses plugin-http and does not depend on browser CORS.
- `EVE_ALLOW_NO_TOKEN=1` disables Bearer checks. Combined with a browser page whose Origin is on the allowlist, that page can drive the loopback API. Keep that flag off outside local debug.
- Session ids must match `ses_` + 16 lowercase hex; path traversal after URL-decode is rejected.
- Books writes are confined to `/workspace/.wellread/` (notes package rules + realpath sandbox).

## API sketch

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/eve/v1` | Readiness: `ok`, `modelReady`, `modelId`, … |
| `GET` | `/health` | Plain `ok` |
| `GET` | `/eve/v1/skills` | Skill catalog (`includeDisabled=1` optional) |
| `GET/POST` | `/eve/v1/sessions` | List / create (`bookId` required) |
| `GET/DELETE` | `/eve/v1/sessions/:id` | Load / remove (turn mutex on DELETE) |
| `POST` | `/eve/v1/sessions/:id/turns` | Stream UIMessage chunks |

## `.output` packaging

`npm run build` produces gitignored `.output/`:

```
.output/server/index.mjs   # entry (+ agent/, books/, createModel*)
.output/bundled-skills/    # default skills
.output/node_modules/      # production deps (no pnpm symlinks)
```

Tauri registers `../../eve-sidecar/.output` as a bundle resource and spawns vendored Node with `NODE_PATH` pointing at `.output/node_modules`. Do not hand-edit `.output`; rebuild after source changes.

## Commands

```bash
cd apps/eve-sidecar
npm test          # node:test (quoted globs — includes src/ + eval/)
npm run build     # pack .output/
npm run dod:static
npm start         # run packaged server (needs env + prior build)
```

Manual local boot (debug):

```bash
EVE_ALLOW_NO_TOKEN=1 \
EVE_BOOKS_ROOT=/path/to/Books \
EVE_DATA_DIR=/tmp/eve-data \
EVE_MODEL_API_KEY=… \
PORT=0 node src/server/index.mjs
```
