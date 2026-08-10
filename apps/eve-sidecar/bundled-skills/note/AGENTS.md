# AGENTS — wellread note skill (read-only)

This file lives at `/workspace/skills/note/AGENTS.md`. Writing targets only notes package content pages, not this file or `tools/**`.

## Reading the package

1. Root `index.md` → relevant directory `index.md` → content pages.
2. Citations and naming: PACKAGE Citations / Naming.
3. Directories with ongoing evolution record a `log.md`; unresolved items go into `questions/待解决问题.md`.

## Writing

`write_file` only when the user explicitly asks to save / ingest / bootstrap / lint-and-fix.

Writable: `index.md`, `log.md`, and pages under `sources|chapters|concepts|frameworks|claims|glossary|questions/`.

Content pages prefer `draft` (sidecar JSON-schema synthesis); `index.md` / `log.md` use `content`. Write cadence (**budget** / **batch** / **handoff**) follows SKILL.md. Validator is read-only: `/workspace/skills/note/tools/validate_okf_wiki.py`.
