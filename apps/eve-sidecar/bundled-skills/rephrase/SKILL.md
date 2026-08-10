---
name: rephrase
description: rephrase — reword a selected quote without jargon, in plain coherent language. Use after highlighting text, or when the user says "rephrase", "simplify", "put it another way", or that the wording is too dense.
---

# Rephrase

Rephrase it. Stop using jargon and speak coherently. State it more simply and concisely, like one human talking to another. Respond in Chinese only.

Rephrasing is not compression — keep the full meaning and every detail intact.

## Target text

Pick the source by priority:

1. **Pending Quote** — the selection attached via "Ask about this" after highlighting (default target).
2. **Quoted text in the message** — a sentence the user pastes or quotes.
3. **Named phrase** — e.g. "rephrase 'XX'".
4. None of the above: ask the user in a sentence or two to highlight or give the text to rephrase.

Text after `/skill:rephrase` is an extra instruction; honor it, but stay on the target text above.

## Done when

The target text has been reworded with all details preserved; no preamble, no "here is the rephrase" filler.

## Output

Give the rephrase directly. When the original has several points, state each one clearly.

Hard guardrails (rephrase body): rewrite em dashes (`—` `–` `―` `--`) and contrastive pairs (`不是……而是……` and similar) into equivalent affirmative sentences or split into two; no emoji.
