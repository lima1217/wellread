---
name: note
description: note — 当前书的 OKF notes 包。记章、划词沉淀、会话入库、问笔记、体检笔记、或建包骨架时使用。
---

# note

在 `/workspace/.wellread/notes/<bookId>/` 维护 **compounding** OKF 包。Extract 与会话是原料；包内 **concept-first**、**traceable**。

写盘前（本会话未读过）：`read_file` `/workspace/skills/note/PACKAGE.md`。规程：`read_file` `/workspace/skills/note/AGENTS.md`。

## Leitworter

- **compounding** — 章、划词、聊天并入同一包，洞见可再引用。
- **concept-first** — 先概念 / 框架 / 主张；章页服务它们。
- **traceable** — 耐久想法链回 cfi，或进 **uncertainty ledger**；正向链到使用它的页。
- **budget** — 读 ≤4 轮；每 turn 内容页 ≤1 chapter + ≤2 concept/framework/claim；导航与 log 不计入但须同批写完；bootstrap 探缺 ≤2 轮后一轮写齐。
- **batch** — 同一 step 并行多个 `write_file`（主页 + 触及的 index + log）。
- **handoff** — 超 **budget** 的页列入「待续写」（path + 一句）；请用户发「继续写入」；续写从该列表接着写。
- **ingest** — 锁定 source → 写页 → 导航与 log。

## Source

| Source | 触发 | 落点 |
| --- | --- | --- |
| **chapter** | 记某章 | `chapters/…` + 抽出的 concept/framework/claim |
| **quote** | 划词要记 | 所在章或 concept/claim |
| **chat** | 沉淀会话 | 按 PACKAGE「选页」归入；蒸馏成可独立阅读的页 |

材料：本会话 → Pending Quote → slash 参数 → Extract（`focus_chunks` / `section_chunks` / `resolve_section`；`extract_status: missing` 时勿空转）→ 已有包（`notes_index`、根 `index.md`）。

`write_file` 仅在用户明确要求保存 / ingest / 沉淀 / bootstrap / lint-并-修时；否则先列将写页与要点再等确认（「直接写入」跳过确认）。可写路径见 AGENTS。

Done when: 本轮 branch 与 source 已锁定，目标路径符合 PACKAGE。

## Branches

一轮一条：

- **bootstrap** → B0
- **ingest** → A
- **query** → Q（要存则转 A，source=chat）
- **lint** → L

---

## B0 · bootstrap

按 PACKAGE Tree 补齐缺失骨架。`log.md`：`## [YYYY-MM-DD] bootstrap | OKF package`

在 **budget** 内 **batch** 写齐。

Done when: Tree 所列骨架均存在；回复列出新建路径。

---

## A · ingest

### A1. 抽点

按 source 读原料（chapter/quote → extract + cfi；chat → 会话，能挂书则补 cfi）。**concept-first** 列出将建/改页：path、`type`、一句理由、与旧页衔接或冲突。超 **budget** 时标本 turn 子集与 **handoff**。

Done when: 每页有 path + type + 理由；每条耐久主张有 cfi 或入 questions；本 turn 子集与 **handoff**（若有）已标清。

### A2. 写入

对本 turn 子集：

- **内容页**（`sources|chapters|concepts|frameworks|claims|glossary|questions` 下）：用 `write_file` 的 **`draft`**（`type`/`title`/`material` 等），由 sidecar 按 OKF JSON schema 生成 frontmatter+正文并写入；失败会重试，仍失败则改写 draft 再调。不要手写整份 YAML 当 `content`。
- **导航与 log**（根/目录 `index.md`、`log.md`）：继续用 `content` 原文写入。
- **batch** 同 step 并行多个 `write_file`（主页 + 触及的 index + log）。冲突则修订互指；重大张力进根 `index.md` 与 questions。有余页则 **handoff**。

Done when: 子集每页已写或附跳过理由；新页从某 `index.md` 可达；log 已记；已写路径已列；**handoff**（若有）齐全。

---

## Q · query

根 `index.md` → 相关目录 index → 页；缺口再查 extract。答案带包内链与必要 cfi。要保存则走 A（source=chat；要点已在答案可从 A2 起）。

Done when: 已作答；若沉淀则 A 的 Done when 已满足。

---

## L · lint

扫：矛盾、过时主张、孤儿、有名无页、断链、缺骨架、questions 中可升级项。人工扫（无 shell）。用户要修则在 **budget** 内 **batch** 修，余项 **handoff**。`log.md`：`## [YYYY-MM-DD] lint | <范围>`。

宿主机校验：读 `/workspace/skills/note/tools/validate_okf_wiki.py`，在 notes **包外**跑；脚本留在 skill。

Done when: 每条发现有路径与建议；约定修复已落地或已 **handoff**。
