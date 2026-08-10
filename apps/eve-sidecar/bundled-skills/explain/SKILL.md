---
name: Explain
description: Explain — clears the blocker in the current book (a word, passage, or concept). Use after highlighting text and running /skill:explain, or when the user says "explain this passage", "what does this mean", or "I can't understand this".
---

# Explain

The user is **stuck** somewhere. Task: clear this **blocker** so they can keep reading; understanding the current sentence is enough.

## Leitworter

- **Blocker** — the spot that blocks further reading (rare word, allusion, a leap in reasoning, irony, long sentence, jargon, background).
- **Plain words** — wording the reader grasps instantly; one or two sentences if that is enough, then stop.

## What to explain (by priority)

1. **Pending Quote** — the passage attached via "ask assistant" after highlighting (default target).
2. **Quoted text in the message** — a sentence the user pasted or quoted.
3. **Named phrase** — e.g., "explain 'XX'".
4. **Current position** — no selection but the user asks "what does this passage mean": only `read_file` `focus_chunks`.
5. None of the above: ask what the target is in a sentence or two, then explain.

Text after `/skill:explain` is a follow-up question; answer it first, but still center on the target text above.

## Done when

The blocker has been explained in plain words; places citing the original text have a clickable cfi; the scope stays the current sentence/passage (not expanded into a whole-chapter translation or notes writing).

## How to explain

- Give the **plain words** first, then point out the **blocker**.
- Only explain words that affect understanding: for each word, "meaning → how it works in this sentence".
- Stay grounded in this book (title, author, genre, context); only give the information needed to understand the current sentence.
- When uncertain, label your basis (original wording vs. inference).
- Reply in the language the user asked in; proper nouns may be kept in the original with a brief note.

## Output

Default structure (omit any section with no content):

```markdown
**Plain words**
(what this passage is saying)

**Where they're stuck**
(the difficulty in one sentence)

**Key terms**
- word/phrase: meaning; its role in this sentence

**Read again**
(optional: a smoother rewrite or sentence breakdown)
```

When the user only wants "a one-sentence explanation" or the target is a single word, compress to two or three sentences. For a full side-by-side passage translation, use `translate`.
