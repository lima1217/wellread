# PACKAGE — wellread 书内 OKF 知识包

创建或编辑笔记页时加载。命名、树、frontmatter、页职责的 **single source of truth**。

包根：`/workspace/.wellread/notes/<bookId>/`（`<bookId>` 来自本轮 Reading Assistant）。自包含 OKF 包；书文留在 extract，本包用 cfi **traceable** 回溯。

写盘规程：`/workspace/skills/note/AGENTS.md`。校验器：`/workspace/skills/note/tools/validate_okf_wiki.py`（只读引用，不入 notes 包）。

## Naming

- 目录英文固定：`sources/` `chapters/` `concepts/` `frameworks/` `claims/` `glossary/` `questions/`
- 根保留：`index.md` `log.md`
- 其余内容页文件名用中文（如 `concepts/网络效应.md`）
- 正文随用户语言；YAML key 与 `type` 枚举保持英文

## Tree

```text
notes/<bookId>/
├── index.md
├── log.md
├── sources/
│   ├── index.md
│   ├── log.md
│   └── 来源-001.md         # 书名、bookId、extract 根路径
├── chapters/
│   ├── index.md
│   ├── log.md
│   └── 第01章-<中文短名>.md
├── concepts/               # + index.md；concept-first 主场
├── frameworks/
├── claims/
├── glossary/
│   └── 术语.md
└── questions/
    └── 待解决问题.md       # uncertainty ledger
```

有 `.md` 内容的目录必有 `index.md`；有演进的目录加 `log.md`。

## Frontmatter

除根上两个保留名外，每个 `.md` 以 YAML 开头且 `type` 非空：

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

`type`：`Source` | `ChapterNote` | `Concept` | `Framework` | `Claim` | `Glossary` | `OpenQuestions`

## Citations

- 包内：相对路径 `[网络效应](concepts/网络效应.md)`
- 书内：`[小节标题](<epubcfi(...)>)`（chunk frontmatter 全量 cfi）
- 耐久主张：有 cfi，或写入 `questions/待解决问题.md`；会话综合标「会话结论」

## Pages

| 页 | 职责 |
| --- | --- |
| `index.md` | 书名、范围、人/代理阅读路径、目录链、顶层概念与框架、全书综合 |
| `chapters/index.md` | 阅读序章旨 + 链到章页 |
| `sources/来源-001.md` | 元数据与 extract 指针（指针，非全文） |
| `chapters/第NN章-….md` | 论点、关键概念/框架/主张、例证、边界、cfi |
| `concepts/….md` | 跨章耐久概念 |
| `frameworks/….md` | 具名方法、模型、清单、决策规则 |
| `claims/….md` | 可检验主张：依据、假设、信心、cfi |
| `glossary/术语.md` | 术语短定义 + 链 |
| `questions/待解决问题.md` | 歧义、矛盾、待外证 |

## 选页

| 形态 | 落点 |
| --- | --- |
| 一章论点 | `chapters/…` |
| 可复用概念 | `concepts/…` |
| 具名模型/步骤 | `frameworks/…` |
| 可检验主张 | `claims/…` |
| 未决/矛盾 | `questions/待解决问题.md` |
| 会话蒸馏 | 按上表归入对应 type |

## 整合

- 冲突：修订并互指；重大张力进 `index.md` 与 questions；`origin` 写明 chapter/chat
- 新页从某 `index.md` 可达；原地覆盖
