# AGENTS — wellread note skill（只读）

本文件在 `/workspace/skills/note/AGENTS.md`，**不要** `write_file` 进 notes 包。

## 怎么读包

1. 根 `index.md` → 相关目录 `index.md` → 内容页。
2. 书内引用用 `[小节标题](<epubcfi(...)>)`（chunk frontmatter 全量 cfi）。
3. 包内引用用相对路径，如 `[网络效应](concepts/网络效应.md)`。
4. 有演进的目录记 `log.md`；未决进 `questions/待解决问题.md`。

## 写盘

仅在用户明确要求保存 / ingest / bootstrap / lint-并-修时 `write_file`。可写：`index.md`、`log.md`，以及 `sources|chapters|concepts|frameworks|claims|glossary|questions/` 下的页。

不可写：`AGENTS.md`、`tools/**`（校验器只读本 skill：`/workspace/skills/note/tools/validate_okf_wiki.py`）。
