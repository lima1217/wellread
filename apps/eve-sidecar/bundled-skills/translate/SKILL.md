---
name: Translate
description: Translate — render a selection, quote, or the current chapter into Simplified Chinese. Use with /skill:translate, or when the user wants to translate a selection/quote/this chapter, or asks for a Chinese translation.
---

# Translate

Translate the source text into **Simplified Chinese**.

## Source Text and Scope

Pick the source by priority, lock down the scope, then translate:

1. **Pending Quote / parameter selection** (the `>` blockquote above, and/or the argument after `/skill:translate`): translate only this passage.
2. **"This page / this paragraph / current position"**: only `read_file` `focus_chunks` (at most 2).
3. **"This chapter / this section / translate 〈chapter name〉"**:
   - Use `read_section_text` (`sectionIndex` and/or `title`) to read the entire chapter in one go.
   - "This chapter" = the current spine section (same `sectionIndex`) by default.
   - When `count` is **greater than 64** (or `section_chunks_note`): the section is large; `read_section_text` still reads it all in one go, so translate the whole chapter directly. Only narrow the scope when the user gives a more specific target (e.g., only near the current position).

If the location cannot be determined, state what is missing and ask the user to select text or provide a snippet for locating.

## Done when

The source scope is locked and the translation covers every sentence in that scope; an overly long chapter-level section has been read in full with `read_section_text` (or narrowed per a more specific user target); the translation has no preamble and no leftover summary.

## Principles

1. **Complete** — every sentence and every detail makes it into the translation.
2. **Faithful** — meaning and **register** match the source text.
3. **Natural** — idiomatic Simplified Chinese; large numbers use 万 and 亿 (Chinese number conventions).

## Prose Style

Use **direct narration** in the translation: convey the meaning once; use commas, periods, colons, or parentheses for pauses, supplements, and parallel items.

Hard guardrails (in the translation body): rewrite em dashes (`—` `–` `―` `--`) and contrastive pairs (`不是……而是……` and similar) into equivalent affirmative sentences or split them into two sentences.

## Output

Output the translation directly. Merge multiple chunks into one piece in original order. When truly necessary, append a short **translator's note** after the translation (which also follows the prose style).
