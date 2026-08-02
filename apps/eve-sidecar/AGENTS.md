# eve-sidecar — agent notes

Canonical product docs: [README.md](./README.md) (env contract, handshake, `.output`, CORS).

## Commands

```bash
cd apps/eve-sidecar
npm test
npm run build
```

`npm test` must use quoted globs (`'src/**/*.test.mjs'`) so Node expands them; bare `sh` `**` is not recursive and silently skips `src/*.test.mjs` / `eval/`.

## Invariants

- Fail-closed loopback token (`EVE_LOOPBACK_TOKEN`); `EVE_ALLOW_NO_TOKEN=1` is debug-only.
- CORS is an allowlist (`src/server/cors.mjs`) — never reflect arbitrary `Origin`.
- Session ids: `isSafeSessionId` (`ses_` + 16 hex) before any path join under `EVE_DATA_DIR/sessions`.
- Books FS: lexical realpath + `.wellread` write confinement (`src/books/scopedFs.mjs`).
- Do not commit or hand-edit `.output/`; regenerate with `npm run build`.
- Keep comments that explain *why* (persist ownership, SDK quirks, symlink gates). Avoid restating the code.

## Touch points outside this package

- Spawn / env injection: `apps/readest-app/src-tauri/src/eve_sidecar.rs`
- Webview client: `apps/readest-app/src/services/wellread/assistant/eveClient.ts` (+ `eveFetch.ts`)
- Shared message / quote / reading-context packages under `packages/`
