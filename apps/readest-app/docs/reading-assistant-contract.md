# Reading Assistant contract

SSOT for eve sidecar grounding: extract on disk, tool envelopes, `<reading_context>`, and bundled skills. Domain terms: [`CONTEXT.md`](../../../CONTEXT.md). Pair with [`architecture.md`](./architecture.md).

**On-disk extract code SSOT:** [`@wellread/extract-contract`](../../../packages/extract-contract) (`EXTRACT_SCHEMA_VERSION`, chunk file-name rule, `meta.json` / `section-index.json` JSON Schemas, shared types). Host (`format.ts`) and sidecar (`extractMeta.mjs`, `sectionIndex.mjs`) import from that package — read schemas there; do not re-pin the version number in callers.

## Extract tree (`Books/.wellread/extract/<bookId>/`)

| Path | Role |
| --- | --- |
| `meta.json` | `status: ready`, `chunkCount`, `schemaVersion` (current = `EXTRACT_SCHEMA_VERSION`) |
| `section-index.json` | `sections[sectionIndex] → chunks`, `titles[lower] → sectionIndex[]` |
| `toc.md` | Human/model chunk list |
| `chunks/*.md` | Body + frontmatter (`cfi`, `endCfi`, `sectionIndex`, `chunkIndex`, `title`); file name `NNNNN-slug.md` |

Host builds the tree in `ensureBookExtract` (schema bump forces rebuild). Sidecar resolves sections via the index when present; otherwise scans `chunks/` (legacy / stale).

Sidecar `extract_status`: `ready` | `stale` (usable via scan, missing index/schema) | `missing`.

## Tools (do not expand the set without a product decision)

| Tool | Success | Soft fail |
| --- | --- | --- |
| `resolve_section` | `{ ok, paths, count, via, … }` | `extract_not_ready` when meta missing |
| `read_file` | `{ ok, path, content }` | `not_found` / `denied` / `extract_not_ready` on extract paths |
| `grep` | `{ ok, hits }` | `invalid_grep_pattern` / `denied` / `extract_not_ready` when scoped to extract |
| `glob` | `{ ok, hits }` | `denied` |
| `write_file` | `{ ok, path }` (+ `composed: true` when `draft` used) | OKF gate / realpath deny; `compose_failed` / `compose_unavailable` / `invalid_args` / `too_many_parallel_compose` for `draft` |

`write_file` accepts **either** `content` (full markdown) **or** `draft` (structured OKF page fields + `material`). `draft` is for content pages under `sources|chapters|concepts|frameworks|claims|glossary|questions` only; `draft.type` must match the target directory (e.g. `Concept` → `concepts/`). Sidecar expands via AI SDK structured output (JSON schema) with one retry; at most 4 draft composes may run in parallel per step (independent of the 16 `write_file` parallel cap). Chat turn `streamText` path is unchanged. Context-compression `generateTextFn` overrides do not affect draft compose (`composeGenerateTextFn`).

## `<reading_context>` fields

Appended to the system prompt when any extra signal exists:

- `extract_status`, `extract_chunk_count`
- `position` (client-reported; may be stale): `chapter`, `cfi`, `sectionIndex`
- `focus_chunks` / `focus_chunks_via` (`cfi` \| `section_mid`) — default read set for “this page”
- `section_chunks` / `section_chunk_count` — whole spine section; ask before reading if count > 20
- `quotes`, `prior_sources`, `notes_index`

**Locate policy** (also in system prompt): quotes first; “current page” → `focus_chunks` only; “this chapter” → `section_chunks` / `resolve_section`; never glob extract chunks for discovery; `extract_status: missing` → explain and stop empty tool loops; `stale` → tools still work (prefer index, else scan).

## Skills

Bundled under `apps/eve-sidecar/bundled-skills/`. Slash `/skill:<id>` expands into the model user turn. Instructions must align with the locate policy above.

Offline gates: `apps/eve-sidecar/eval/readingContract.eval.test.mjs` (included in `npm test`).

## Observability

Set `EVE_TURN_LOG=1` on the sidecar to emit JSON lines (`type: eve.turn_contract`) with extract/focus/section/skill/quote counts.
