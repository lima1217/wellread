# Wellread app code layout

This note maps directories inside `apps/readest-app` and the sibling
`apps/eve-sidecar`. Pair with [`architecture.md`](./architecture.md) for the
system picture.

Wellread’s **shipped** host is macOS (Apple Silicon) via Tauri. `pnpm dev-web`
exists for UI work without Rust; it is not a product download. Mobile / Windows
/ Linux packaging paths are not part of the current release contract.

## Host and sidecar

| Path | Role |
| --- | --- |
| `apps/readest-app/src` | Next.js / React app |
| `apps/readest-app/src-tauri` | Tauri native shell (macOS product path) |
| `apps/eve-sidecar` | Loopback Reading Assistant process (bundled Node + `.output`) |

Rust modules worth knowing: `eve_sidecar.rs`, parsers, `dir_scanner.rs`,
`transfer_file.rs`, `clip_url.rs`, `macos/`.

## Directory classification inside `apps/readest-app`

### Thin server / edge routes

- `src/app/api` — remaining proxies only: `hardcover`, `metadata`, `opds`
- `src/app/runtime-config.js` — emits optional `apiBaseUrl` for the client

There is **no** `src/pages/api` tree and **no** `workers/send-email` (or other
Cloudflare workers) in the current product.

### Mostly client-side

- `src/components`, `src/context`, `src/hooks`, `src/store`, `src/styles`
- `src/data`, `src/i18n`, `src/workers` (browser workers), `public`
- `extensions/send-to-readest` — in-tree extension; not the macOS release contract

### Mixed / shared

- `src/app` — library, reader, opds, updater, offline, share landing (`o`), plus `api`
- `src/pages` — Pages Router reader entry + `_document.tsx` / `_app.tsx`
- `src/services`, `src/utils`, `src/libs`, `src/helpers`, `src/types`
- `src/__tests__`, `e2e`, `scripts`, `docs`

## `src/app` and `src/pages`

### `src/app`

- `api/` — hardcover / metadata / opds proxies
- `library/` — library UI
- `reader/` — reader UI + Reading Assistant panel
- `opds/` — catalog browser
- `updater/`, `offline/`, `o/` — updater, offline, share-style landing
- `runtime-config.js/` — runtime config script route

Removed product surfaces (do not expect them): `auth`, `user`, `send`, `s`
account/share clouds.

### `src/pages`

- `reader/[ids].tsx` — historical reader entry
- `_app.tsx`, `_document.tsx` — Pages Router shell (COOP/COEP, runtime-config)

## `src/services` breakdown

`src/services` is a **shared application layer**, not “the backend.”

### Platform seam

- `appService.ts` + `nativeAppService.ts` / `webAppService.ts` / `nodeAppService.ts`
- `environment.ts`, `runtimeConfig.ts`
- `database/` — web / native / node DB + migrations

### Library and books

- `bookService.ts`, `libraryService.ts`, `ingestService.ts`, `bookContent.ts`
- `settingsService.ts`, `backupService.ts`, `fontService.ts`, `imageService.ts`
- `persistence.ts`, `transformService.ts`, `commandRegistry.ts`

There is **no** `cloudService.ts` upload/download product path.

### Local replica helpers

`sync/` still has `replicaBootstrap`, `replicaPersist`, `replicaRegistry`, and
category `adapters/` (dictionary, font, texture, OPDS catalog, settings). This
supports local replica-shaped persistence—not hosted multi-device sync APIs.

### Reading Assistant (Wellread-specific)

`wellread/`:

- `eveSidecar.ts`, `eveConnectionStore.ts`, `eveListen.ts`
- `assistant/` — eve client, fetch, agent hook, session helpers
- `extract/` — book extract / CFI chunking for assistant context
- `modelConfig.ts`, `modelApiKey.ts`, `syncEveSidecarApiKey.ts`,
  `testModelConnection.ts`

Sidecar implementation lives in `apps/eve-sidecar` (`server/`, `agent/`,
`books/`). Shared SessionMessage ↔ UIMessage conversion lives in
`packages/eve-message` (`@wellread/eve-message`). Turns stream AI SDK UIMessage
SSE (not custom NDJSON) — see `docs/architecture.md` §6.3.

### Reader domain folders (still present)

- `dictionaries/`, `annotation/`, `nav/`, `opds/`, `translators/`
- `rsvp/`, `transformers/`, `metadata/`, `hardcover/`, `readwise/`
- `statistics/`, `rss/`, `wordlens/`, and related helpers

Removed product folders: `tts/`, `ai/` (old cloud RAG chat).

`send/` still holds article→EPUB `conversion/` helpers (and `clipOptions.ts`);
the old cloud inbox / email-to-library product path is gone.

## Practical mental model

1. **macOS product I/O** → `src-tauri` + `nativeAppService`
2. **Reading Assistant** → `src/services/wellread` + `apps/eve-sidecar`
3. **Reader / library UI** → `src/app/{reader,library}` + Foliate
4. **Optional network features** → client services + thin `src/app/api` proxies
5. **Library bytes** → local disk only

Prefer this over “everything under `src` is client” or “`src/app/api` is a full
cloud backend.”
