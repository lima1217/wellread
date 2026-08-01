# Reading Assistant contract

SSOT for eve sidecar grounding: extract on disk, tool envelopes, `<reading_context>`, and bundled skills. Pair with [`architecture.md`](./architecture.md).

**On-disk extract code SSOT:** [`@wellread/extract-contract`](../../../packages/extract-contract) (`EXTRACT_SCHEMA_VERSION`, chunk file-name rule, `meta.json` / `section-index.json` JSON Schemas, shared types). Host (`format.ts`) and sidecar (`extractMeta.mjs`, `sectionIndex.mjs`) import from that package — do not re-pin the version number in callers.

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
| `write_file` | `{ ok, path }` | OKF gate / realpath deny |

## `<reading_context>` fields

Appended to the system prompt when any extra signal exists:

- `extract_status`, `extract_chunk_count`
- `position` (client-reported; may be stale): `chapter`, `cfi`, `sectionIndex`
- `focus_chunks` / `focus_chunks_via` (`cfi` \| `section_mid`) — default read set for “this page”
- `section_chunks` / `section_chunk_count` — whole spine section; ask before reading if count > 20
- `quotes`, `prior_sources`, `notes_index`

Policy (also in system prompt): quotes first; “current page” → `focus_chunks` only; “this chapter” → `section_chunks` / `resolve_section`; never glob extract chunks for discovery; `extract_status: missing` → explain, do not empty-loop tools; `stale` → tools still work (prefer index, else scan).

## Skills

Bundled under `apps/eve-sidecar/bundled-skills/`. Slash `/skill:<id>` expands into the model user turn (Pi-style). Instructions must align with focus/section policy above.

Offline gates: `apps/eve-sidecar/eval/readingContract.eval.test.mjs` (included in `npm test`).

## Observability

Set `EVE_TURN_LOG=1` on the sidecar to emit JSON lines (`type: eve.turn_contract`) with extract/focus/section/skill/quote counts.

## Appendix: extract JSON Schemas

Canonical objects live in `@wellread/extract-contract` as `EXTRACT_META_JSON_SCHEMA` and `SECTION_INDEX_JSON_SCHEMA` (keep this appendix in sync when bumping). Current `EXTRACT_SCHEMA_VERSION` is **2**.

### `meta.json`

```json
{
  "$id": "wellread:extract/meta.json",
  "type": "object",
  "required": [
    "bookId",
    "sourceHash",
    "format",
    "extractedAt",
    "chunkCount",
    "schemaVersion",
    "status"
  ],
  "additionalProperties": true,
  "properties": {
    "bookId": { "type": "string", "minLength": 1 },
    "sourceHash": { "type": "string", "minLength": 1 },
    "sourceMtimeMs": { "type": ["number", "null"] },
    "format": { "type": "string" },
    "extractedAt": { "type": "number" },
    "chunkCount": { "type": "number", "minimum": 0 },
    "schemaVersion": { "type": "number", "const": 2 },
    "status": { "type": "string", "const": "ready" }
  }
}
```

Example:

```json
{
  "bookId": "bk1",
  "sourceHash": "…",
  "sourceMtimeMs": 1710000000000,
  "format": "EPUB",
  "extractedAt": 1710000001000,
  "chunkCount": 42,
  "schemaVersion": 2,
  "status": "ready"
}
```

### `section-index.json`

```json
{
  "$id": "wellread:extract/section-index.json",
  "type": "object",
  "required": ["schemaVersion", "sections", "titles"],
  "additionalProperties": false,
  "properties": {
    "schemaVersion": { "type": "number", "const": 2 },
    "sections": {
      "type": "object",
      "additionalProperties": {
        "type": "array",
        "items": { "$ref": "#/$defs/SectionIndexChunk" }
      }
    },
    "titles": {
      "type": "object",
      "additionalProperties": {
        "type": "array",
        "items": { "type": "number", "minimum": 0 }
      }
    }
  },
  "$defs": {
    "SectionIndexChunk": {
      "type": "object",
      "required": ["fileName", "chunkIndex", "sectionIndex", "cfi", "endCfi"],
      "additionalProperties": false,
      "properties": {
        "fileName": { "type": "string", "pattern": "^\\d{5}-[a-z0-9-]+\\.md$" },
        "chunkIndex": { "type": "number", "minimum": 0 },
        "sectionIndex": { "type": "number", "minimum": 0 },
        "title": { "type": ["string", "null"] },
        "cfi": { "type": "string" },
        "endCfi": { "type": "string" }
      }
    }
  }
}
```

Example:

```json
{
  "schemaVersion": 2,
  "sections": {
    "0": [
      {
        "fileName": "00001-loomings.md",
        "chunkIndex": 0,
        "sectionIndex": 0,
        "title": "Loomings",
        "cfi": "epubcfi(/6/2!/4/2/1:0)",
        "endCfi": "epubcfi(/6/2!/4/2/1:20)"
      }
    ]
  },
  "titles": { "loomings": [0] }
}
```
