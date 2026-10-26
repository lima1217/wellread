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
| `read_section_text` | `{ ok, text, chunkCount, via, sectionIndex?, title? }` (+ `truncated` when byte-capped) | `not_found` / `invalid_args` / `extract_not_ready` when meta missing |
| `search_book` | `{ ok, hits: [{ path, title?, sectionIndex?, cfi?, score, snippet }], totalMatches }` | `invalid_args` (no searchable words) / `not_found` / `extract_not_ready` |
| `grep` | `{ ok, hits }` | `invalid_grep_pattern` / `denied` / `extract_not_ready` when scoped to extract |
| `glob` | `{ ok, hits }` | `denied` |
| `write_file` | `{ ok, path }` (+ `composed: true` when `draft` used) | OKF gate / realpath deny; `compose_failed` / `compose_unavailable` / `invalid_args` / `too_many_parallel_compose` for `draft` |
| `search_library` | `{ ok, hits: [{ bookId, bookTitle?, kind: note\|annotation\|memory, path, heading?, score, snippet }], totalMatches, booksSearched }` | `invalid_args` / `not_found` (nothing saved for other books) |
| `remember` | `{ ok, scope, path, added, removed, entries, notFound? }` | `invalid_args` (empty / entry > 280 chars) / `memory_full` (> 40 entries) / `denied` |

**Cross-book reach (`search_library`, `read_file`):** other books expose only what the reader wrote: OKF notes packages, `annotations/<bookId>.md` exports (only while the turn does not send `shareAnnotations: false`) and `memory/books/<bookId>.md`. Other books' extract stays denied (the reader may not have read that far). Results have every `epubcfi(…)` stripped, and the citation guard never accepts a cfi seen through them: those cfi values point into another book.

**Reader memory (`remember`):** `Books/.wellread/memory/reader.md` (who the reader is) and `memory/books/<bookId>.md` (their reading of one book), one `- ` line per entry, human-editable. Entries load into the system prompt as `<reader_memory>` (data, not instructions), so the prompt cache restarts only when memory changes.

**Citation guard:** `[label](<epubcfi(…)>)` links in the streamed reply are dropped unless the cfi appeared in this turn's tool output, in earlier user turns' `<reading_context>` / tool results / `sources`, or is an exact chunk `cfi` / `endCfi` in `section-index.json` (not hidden by the spoiler guard). Assistant prose never vouches for a cfi. Dropped counts log as `eve.citation_check`.

`search_book` is local BM25 over `chunks/*.md` (CJK runs → unigrams + bigrams; other scripts → lower-cased words), cached in memory per book and rebuilt when `meta.json` / `chunks/` change. Use it for topic questions; `grep` stays for exact phrases.

**Spoiler guard:** when a turn sends `spoilerGuard: true` with a `readerState.cfi`, every extract chunk whose start CFI is after the end of that (range) CFI is hidden: `read_file` → `spoiler_guard`; `read_section_text` → partial text (+ `hiddenBySpoilerGuard`) or `spoiler_guard` when the whole section is ahead; `resolve_section` / `grep` / `glob` / `search_book` drop those hits and report `hiddenBySpoilerGuard`.

**Replay compaction:** tool results from earlier turns larger than 4000 serialized chars are replayed as a deterministic stub (`compacted: true`, locator fields such as `path` / `title` / `sectionIndex` / `chunkCount`, and a short `excerpt`). The current turn's tool steps are never compacted.

**Provider tool (not Books FS):** when the active model is DeepSeek on Responses (`apiMode: responses`), sidecar also mounts server-side `web_search` (`openai.tools.webSearch`). DeepSeek executes search; it is not a local tool and must not be wrapped by the parallel budget. Non-DeepSeek hosts never receive it. Multi-turn / multi-step: `@ai-sdk/openai` drops `providerExecuted` web search under `store: false`; sidecar keeps a mutable ALS replay list (seeded from history + session tool traces, refreshed in `prepareStep`) and re-injects `web_search_call` items into the Responses `input` so DeepSeek can restore results.

`write_file` accepts **either** `content` (full markdown) **or** `draft` (structured OKF page fields + `material`). `draft` is for content pages under `sources|chapters|concepts|frameworks|claims|glossary|questions` only; `draft.type` must match the target directory (e.g. `Concept` → `concepts/`). Sidecar expands via AI SDK structured output (JSON schema) with one retry; at most 4 draft composes may run in parallel per step (independent of the 16 `write_file` parallel cap). Chat turn `streamText` path is unchanged. Context-compression `generateTextFn` overrides do not affect draft compose (`composeGenerateTextFn`).

## `<reading_context>` fields

Prepended to the turn's model user message (and persisted with it as `modelContent`) when any extra signal exists. The system prompt holds only stable per-book instructions, so the provider prompt cache covers it and every earlier turn; each earlier turn keeps the envelope it was sent with.

- `extract_status`, `extract_chunk_count`
- `position` (client-reported; may be stale): `chapter`, `cfi`, `sectionIndex`
- `focus_chunks` / `focus_chunks_via` (`cfi` \| `section_mid`) — default read set for “this page”: every chunk the visible range CFI overlaps (≤4; a single hit adds the next chunk)
- `focus_text` — the first focus chunks' text inlined as `<focus_chunk path="…">` blocks (projected frontmatter keeps the cfi) while they fit 3000 estimated tokens, so “this page” needs no `read_file`. Earlier turns replay a fixed stub in its place (same rule as tool-result replay compaction)
- `section_chunks` / `section_chunk_count` — whole spine section; count > 64 marks a large section (`read_section_text` handles it in one call; ask only when the user gave a narrower target)
- `quotes` — each with `text`, optional `chapter`, `cfi` (selection anchor) and `chunks` (extract chunk(s) holding it)
- `prior_sources`, `notes_index`
- `annotations` — `/workspace/.wellread/annotations/<bookId>.md (N items)`: host-written export of the reader's highlights / notes / bookmarks (one `### ` block each, with `cfi:`); readable and greppable for the current book only
- `spoiler_guard` — `on (limit "<cfi>"; …)` when the guard is active

**Locate policy** (also in system prompt): quotes first; "current page" → `focus_text`, then `read_file` only the `focus_chunks` it lacks; `search_book` / `grep` queries in the book's language; "this chapter" / whole-chapter summary → `read_section_text` (returns full section text in one call; use over `resolve_section` + repeated `read_file` for whole-chapter tasks); never glob extract chunks for discovery; `extract_status: missing` → explain and stop empty tool loops; `stale` → tools still work (prefer index, else scan).

## Skills

Bundled under `apps/eve-sidecar/bundled-skills/`. Slash `/skill:<id>` expands into the model user turn. Instructions must align with the locate policy above.

Offline gates: `apps/eve-sidecar/eval/readingContract.eval.test.mjs` (included in `npm test`).

## Observability

Set `EVE_TURN_LOG=1` on the sidecar to emit JSON lines (`type: eve.turn_contract`) with extract/focus/section/skill/quote counts.
