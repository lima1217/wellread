---
name: note
description: note — OKF notes package for the current book. Use when taking chapter notes, persisting highlights, distilling a chat into notes, querying notes, auditing notes, or scaffolding a package.
---

# note

Maintain a **compounding** OKF package at `/workspace/.wellread/notes/<bookId>/`. Extract and conversations are raw material; inside the package, be **concept-first** and **traceable**.

Before writing (if not read this session): `read_file` `/workspace/skills/note/PACKAGE.md`. Procedure: `read_file` `/workspace/skills/note/AGENTS.md`.

## Leitwörter

- **compounding** — chapters, highlights, and chats merge into one package; insights become re-referenceable.
- **concept-first** — concepts / frameworks / claims first; chapter pages serve them.
- **traceable** — durable ideas link back to cfi, or enter the **uncertainty ledger**; forward links go to pages that use them.
- **budget** — read ≤4 turns; per turn content pages ≤1 chapter + ≤2 concept/framework/claim; navigation and log don't count but must be written in the same batch; bootstrap probes gaps in ≤2 turns then writes everything in one.
- **batch** — run multiple `write_file` calls in the same step in parallel (main page + touched index + log).
- **handoff** — pages exceeding **budget** go into a "to continue" list (path + one sentence); ask the user to send "continue writing"; continuation resumes from that list.
- **ingest** — lock source → write pages → navigation and log.

## Source

| Source | Trigger | Landing |
| --- | --- | --- |
| **chapter** | note a chapter | `chapters/…` + extracted concept/framework/claim |
| **quote** | highlight to persist | its chapter or concept/claim |
| **chat** | distill a conversation | file per PACKAGE "page selection"; distill into independently readable pages |

Material: this session → Pending Quote → slash args → Extract (`focus_chunks` / `section_chunks` / `resolve_section`; do not spin on `extract_status: missing`) → existing package (`notes_index`, root `index.md`).

`write_file` only when the user explicitly asks to save / ingest / distill / bootstrap / lint-and-fix; otherwise list the pages to write with their key points and wait for confirmation ("write directly" skips confirmation). Writable paths: see AGENTS.

Done when: this turn's branch and source are locked; target paths conform to PACKAGE.

## Branches

One per turn:

- **bootstrap** → B0
- **ingest** → A
- **query** → Q (if persisting, switch to A with source=chat)
- **lint** → L

---

## B0 · bootstrap

Fill missing scaffolding per the PACKAGE Tree. `log.md`: `## [YYYY-MM-DD] bootstrap | OKF package`

Write everything within **budget**, in **batch**.

Done when: all Tree-listed scaffolding exists; reply lists newly created paths.

---

## A · ingest

### A1. Extract points

Read material by source (chapter/quote → extract + cfi; chat → conversation, attach cfi where it maps to the book). **concept-first**, list pages to create/modify: path, `type`, a one-sentence reason, and how it connects to or conflicts with existing pages. When exceeding **budget**, mark this turn's subset and **handoff** the rest.

Done when: each page has path + type + reason; each durable claim has a cfi or enters questions; this turn's subset and **handoff** (if any) are clearly marked.

### A2. Write

For this turn's subset:

- **Content pages** (under `sources|chapters|concepts|frameworks|claims|glossary|questions`): use `write_file` with a **`draft`** (`type`/`title`/`material`, etc.); the sidecar generates frontmatter + body per the OKF JSON schema and writes it; on failure it retries, and if still failing, rewrite the draft and call again. Do not hand-write a full YAML blob as `content`.
- **Navigation and log** (root/directory `index.md`, `log.md`): keep writing via `content` raw text.
- **batch** multiple `write_file` calls in the same step (main page + touched index + log). On conflict, revise and cross-reference; major tensions go into root `index.md` and questions. Leftover pages → **handoff**.

Done when: every page in the subset is written or has a skip reason; new pages are reachable from some `index.md`; log is recorded; written paths are listed; **handoff** (if any) is complete.

---

## Q · query

Root `index.md` → relevant directory index → pages; for gaps, query extract next. Answers carry in-package links and necessary cfi. If persisting, go through A (source=chat; if key points are already in the answer, start from A2).

Done when: answered; if distilling, A's Done when is met.

---

## L · lint

Scan for: contradictions, outdated claims, orphans, named-but-missing pages, broken links, missing scaffolding, upgradeable items in questions. Manual scan (no shell). If the user asks to fix, fix within **budget** in **batch**; **handoff** the rest. `log.md`: `## [YYYY-MM-DD] lint | <scope>`.

Host validation: read `/workspace/skills/note/tools/validate_okf_wiki.py`, run it outside the notes **package**; the script stays in the skill.

Done when: each finding has a path and a suggestion; agreed fixes are applied or **handed off**.
