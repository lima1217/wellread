---
name: note
description: "note — 当前书的 OKF notes 包。/skill:note；要 ingest、query、lint 或 bootstrap 时使用。"
---

# note

在 `/workspace/.wellread/notes/<bookId>/` 维护一份 **compounding** OKF 包。Extract 与会话都是原料；包内是 **concept-first**、**traceable** 的耐久层。

## Leitworter

- **compounding** — 章、划词、聊天都并入同一包，洞见落盘后可再被引用。
- **concept-first** — 先概念 / 框架 / 主张；章页服务于它们。
- **traceable** — 耐久想法链回 cfi，或进入 **uncertainty ledger**（`questions/待解决问题.md`）；正向链到使用它的页。
- **ingest** — 认准本轮 source → 写页 → 更新导航与 log。

命名、树、frontmatter、引用、选页：写盘前 `read_file` `/workspace/skills/note/PACKAGE.md`（本会话未读过时）。代理规程：`read_file` `/workspace/skills/note/AGENTS.md`。

## Source

| Source | 触发 | 落点 |
| --- | --- | --- |
| **chapter** | 记某章 | `chapters/…` + 抽出的 concept/framework/claim |
| **quote** | 划词要记 | 所在章或 concept/claim |
| **chat** | 沉淀会话 | 按 PACKAGE「选页」归入；蒸馏成可独立阅读的页 |

材料优先级：本会话 → Pending Quote → slash 参数 → Extract → 已有包（`notes_index`、根 `index.md`）。

**写盘：** 用户明确要求保存 / ingest / 沉淀 / bootstrap / lint-并-修时才 `write_file`。否则先列将写页与要点，确认后再写。说了「直接写入」则跳过确认。不可写 `AGENTS.md` 或 `tools/**`。

Done when: 本轮 branch 与 source 已锁定，且目标路径符合 PACKAGE。

## Branches

一轮一条：

- **bootstrap** — 缺骨架 → B0
- **ingest** — 编入包 → A
- **query** — 问包；要存则转 A（source=chat）→ Q
- **lint** — 体检 → L

---

## B0 · bootstrap

按 PACKAGE 树补齐缺失项：根 `index.md` `log.md`；`sources/来源-001.md`（书名、bookId、extract 根）；`chapters|concepts|frameworks|claims` 的 `index.md`；`glossary/术语.md`；`questions/待解决问题.md`。不要向 notes 写入 `AGENTS.md` 或任何 `tools/` 文件。

`log.md`：`## [YYYY-MM-DD] bootstrap | OKF package`

Done when: 上列路径均存在；回复列出本轮新建路径。

---

## A · ingest

### A1. 抽点

按 source 读原料（chapter/quote → extract + cfi；chat → 会话，能挂书则补 cfi）。**concept-first** 列出将建/改的页：path、`type`、一句理由、与旧页的衔接或冲突。

Done when: 清单完整（每页有 path + type + 理由），且每条耐久主张已标 cfi 或标入 questions。

### A2. 写入

1. 按清单写主落点页（冲突则修订并互指；重大张力进 `index.md` 与 questions）。
2. 回链 concept↔章、claim→依据；更新触及的各层 `index.md`（含根 `index.md` 与 `chapters/index.md` 若论题或章序变了）。
3. 根 `log.md`（及被改目录 log）：`## [YYYY-MM-DD] ingest | <source> | <标题>`。

Done when: 清单每页已写入或附跳过理由；每个新页从某 `index.md` 可达；log 已记；回复列出改动路径。

---

## Q · query

读根 `index.md` → 相关目录 index → 页；缺口再查 extract。答案带包内链与必要 cfi。要保存或答案可复用时走 A（source=chat；要点已在答案里可从 A2 起）。

Done when: 已作答；若沉淀则 A 的 Done when 已满足。

---

## L · lint

扫：矛盾、过时主张、孤儿、有名无页、断链、缺骨架、questions 中可升级为 claim/concept 的项。Reading Assistant 无 shell：以人工扫为准。

可选宿主机校验：先 `read_file` `/workspace/skills/note/tools/validate_okf_wiki.py` 了解规则，再告诉用户在 **notes 包外**用该 skill 自带脚本对 notes 根跑（例如把脚本拷到临时目录后 `python3 validate_okf_wiki.py /path/to/notes/<bookId>` / `--strict`）。**禁止**把脚本 `write_file` 进 notes，也**禁止**建议执行 notes 树内的任意 `.py`。

用户要修则改完；`log.md`：`## [YYYY-MM-DD] lint | <范围>`。

Done when: 每条发现有路径与建议；若本轮修复，则约定项已落地。
