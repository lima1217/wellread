# eve-sidecar — agent notes

Canonical product docs: [README.md](./README.md) (env contract, handshake, `.output`, CORS). Domain glossary: [`CONTEXT.md`](../../CONTEXT.md). Reading contract: [`reading-assistant-contract.md`](../readest-app/docs/reading-assistant-contract.md).

## Commands

```bash
cd apps/eve-sidecar
npm test
npm run build
```

`npm test` must use quoted globs (`'src/**/*.test.mjs'`) so Node expands them; bare `sh` `**` is not recursive and silently skips `src/*.test.mjs` / `eval/`.

## Invariants

- Fail-closed loopback token (`EVE_LOOPBACK_TOKEN`); `EVE_ALLOW_NO_TOKEN=1` is debug-only.
- CORS is an allowlist (`src/server/cors.mjs`): echo only allowlisted `Origin` values.
- Session ids: `isSafeSessionId` (`ses_` + 16 hex) before any path join under `EVE_DATA_DIR/sessions`.
- Books FS: lexical realpath + `.wellread` write confinement (`src/books/scopedFs.mjs`).
- MCP (`src/server/mcp.mjs`): separate MCP-only token from `mcp-endpoint.json` (0600), refuse any `Origin`; tools bind to the live book from `PUT /eve/v1/reader/live`, never a turn body. Spoiler guard and annotation sharing follow the reader's settings there too.
- Reader actions (`src/agent/readerActions.mjs`) are defined once and shared by the in-app assistant and MCP; they run through the reader command queue (`readerCommands.mjs`), never by writing BookNotes from the sidecar. `update_annotation` / `delete_annotation` stay marked destructive.
- `.output/` is build output: regenerate it with `npm run build`, keep it out of commits and hand edits.
- Comments explain *why* (persist ownership, SDK quirks, symlink gates).

## Model-facing text

The in-app model reads three layers; each rule lives in exactly one of them:

- **System prompt** (`src/agent/prompt.mjs` `buildSystemPrompt`): cross-tool policy (locate order, citation format, reply style, spoiler guard, memory policy). Stable per book so the provider prompt cache holds; per-turn state goes in `<reading_context>`.
- **Tool descriptions** (`src/agent/tools.mjs`): what one tool does, its limits, and when to pick it over a sibling tool.
- **Bundled skills** (`bundled-skills/<id>/SKILL.md`): task procedure only; they inherit the system prompt's reply style and citation rules. The `description` lands in the system catalog flattened and cut at 200 chars (`SKILL_CATALOG_DESC_MAX`), so keep it under that: what the skill does first, then one trigger per distinct case.

External MCP agents never see the system prompt: they get `MCP_INSTRUCTIONS` (`src/server/mcp.mjs`) at `initialize`, plus the same tool descriptions, and skills as MCP prompts. When a cross-tool policy (locate order, spoiler guard, reader actions, reply style such as the Grice maxims) changes in `prompt.mjs`, carry it into `MCP_INSTRUCTIONS` too; `mcp.test.mjs` pins its key phrases.

State the target behavior; keep a prohibition only as a hard guardrail paired with its positive form (the reply style locks are the model). `prompt.test.mjs` and `eval/` pin key phrases, so update them with the wording.

## Touch points outside this package

- Spawn / env injection: `apps/readest-app/src-tauri/src/eve_sidecar.rs`
- Webview client: `apps/readest-app/src/services/wellread/assistant/eveClient.ts` (+ `eveFetch.ts`)
- Reader live push / reader commands: `apps/readest-app/src/app/reader/hooks/useReaderLivePublisher.ts`, `useAgentReaderCommands.ts` → `src/app/reader/utils/agentReaderCommands.ts`, `src/services/wellread/agent/locatePassage.ts`
- MCP setup UI: `apps/readest-app/src/components/settings/ExternalAgentsSection.tsx`; user doc: [`external-agents-mcp.md`](../readest-app/docs/external-agents-mcp.md)
- Shared message / quote / reading-context packages under `packages/`
