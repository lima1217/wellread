# PACKAGE — in-book OKF knowledge package for wellread

Loaded when creating or editing note pages. The **single source of truth** for naming, tree, frontmatter, and page responsibilities.

Package root: `/workspace/.wellread/notes/<bookId>/` (`<bookId>` comes from the current Reading Assistant turn). A self-contained OKF package; book text stays in the extract, and this package uses cfi for **traceable** back-references.

Write procedure: `/workspace/skills/note/AGENTS.md`. Validator: `/workspace/skills/note/tools/validate_okf_wiki.py` (read-only reference, not part of the notes package).

## Naming

- Directories are fixed English: `sources/` `chapters/` `concepts/` `frameworks/` `claims/` `glossary/` `questions/`
- Root reserved: `index.md` `log.md`
- Other content page filenames use Chinese (e.g. `concepts/网络效应.md`)
- Body text follows the user's language; YAML keys and the `type` enum stay English

## Tree

```text
notes/<bookId>/
├── index.md
├── log.md
├── sources/
│   ├── index.md
│   ├── log.md
│   └── 来源-001.md         # book title, bookId, extract root path
├── chapters/
│   ├── index.md
│   ├── log.md
│   └── 第01章-<中文短名>.md
├── concepts/               # + index.md; the concept-first main stage
├── frameworks/
├── claims/
├── glossary/
│   └── 术语.md
└── questions/
    └── 待解决问题.md       # uncertainty ledger
```

Any directory with `.md` content must have an `index.md`; directories with ongoing evolution add a `log.md`.

## Frontmatter

Apart from the two reserved root names, every `.md` starts with YAML and `type` must be non-empty:

```yaml
---
type: Concept
title: 示例概念
description: 一句话摘要。
origin: chapter | quote | chat | mixed
source_refs: [source-001]
chapter_refs: [ch03]
tags: [核心]
status: active
timestamp: 2026-07-25T00:00:00Z
---
```

`type`: `Source` | `ChapterNote` | `Concept` | `Framework` | `Claim` | `Glossary` | `OpenQuestions`

## Citations

- In-package: relative path `[网络效应](concepts/网络效应.md)`
- In-book: `[section title](<epubcfi(...)>)` (the chunk frontmatter carries the full cfi)
- Durable claims: have a cfi, or are written into `questions/待解决问题.md`; conversation syntheses are tagged "会话结论"

## Pages

| Page | Responsibility |
| --- | --- |
| `index.md` | book title, scope, human/agent reading paths, directory links, top-level concepts and frameworks, whole-book synthesis |
| `chapters/index.md` | reading-order chapter aims + links to chapter pages |
| `sources/来源-001.md` | metadata and extract pointers (pointers, not full text) |
| `chapters/第NN章-….md` | arguments, key concepts/frameworks/claims, evidence, boundaries, cfi |
| `concepts/….md` | cross-chapter durable concepts |
| `frameworks/….md` | named methods, models, checklists, decision rules |
| `claims/….md` | testable claims: basis, assumptions, confidence, cfi |
| `glossary/术语.md` | short term definitions + links |
| `questions/待解决问题.md` | ambiguities, contradictions, pending verification |

## Page selection

| Shape | Landing |
| --- | --- |
| A chapter's argument | `chapters/…` |
| A reusable concept | `concepts/…` |
| A named model/steps | `frameworks/…` |
| A testable claim | `claims/…` |
| Unresolved/contradiction | `questions/待解决问题.md` |
| Conversation distillation | file into the matching type per the table above |

## Integration

- Conflict: revise and cross-reference; major tensions go into `index.md` and questions; `origin` notes chapter/chat
- New pages are reachable from some `index.md`; overwrite in place
