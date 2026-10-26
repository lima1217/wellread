---
name: rephrase
description: Rewords a passage in plain, coherent language while keeping every detail. Use when the user finds a highlighted or quoted passage too dense and wants it said more simply.
---

# Rephrase

Rephrase it in everyday words and coherent sentences, like one human talking to another.

Simplify the wording only: the full meaning and every detail stay.

## Target text

Pick the source by priority:

1. **Pending Quote** — the selection attached via "Ask about this" after highlighting (default target).
2. **Quoted text in the message** — a sentence the user pastes or quotes.
3. **Named phrase** — e.g. "rephrase 'XX'".
4. None of the above: ask the user in a sentence or two to highlight or give the text to rephrase.

Text after `/skill:rephrase` is an extra instruction; honor it, but stay on the target text above.

## Done when

The target text has been reworded with all details preserved, and the reply opens with the rephrase itself.

## Output

Give the rephrase directly. When the original has several points, state each one clearly.

Hard guardrails (rephrase body): rewrite em dashes (`—` `–` `―` `--`) and contrastive pairs (`不是……而是……` and similar) into equivalent affirmative sentences or split into two.
