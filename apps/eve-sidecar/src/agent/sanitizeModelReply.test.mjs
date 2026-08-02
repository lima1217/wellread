import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TEXT_STREAM_HOLDBACK_CHARS,
  TOOLS_READY_CONTINUE_HINT,
  ensureContinueHintOnMessage,
  looksLikeLeakedToolMarkup,
  sanitizeModelReplyText,
  sanitizeUIMessageTextParts,
  sanitizeUIMessageTextStream,
} from './sanitizeModelReply.mjs';

/**
 * @param {ReadableStream} stream
 */
async function collectChunks(stream) {
  const chunks = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return chunks;
}

describe('sanitizeModelReplyText', () => {
  it('strips DeepSeek-style invoke dumps', () => {
    const raw = [
      'tool_calls>',
      '<invoke name="read_file">',
      '<parameter name="path" string="true">/workspace/.wellread/extract/x/chunks/00464.md</parameter>',
      '</invoke>',
      '<invoke name="read_file">',
      '<parameter name="path" string="true">/workspace/.wellread/extract/x/chunks/00480.md</parameter>',
      '</invoke>',
    ].join(' ');
    assert.equal(looksLikeLeakedToolMarkup(raw), true);
    assert.equal(sanitizeModelReplyText(raw), '');
  });

  it('keeps real prose around markup', () => {
    const raw =
      '先读这一节。\n<invoke name="read_file"><parameter name="path">/a.md</parameter></invoke>\n结论：错误被设计消掉。';
    assert.match(sanitizeModelReplyText(raw), /先读这一节/);
    assert.match(sanitizeModelReplyText(raw), /结论：错误被设计消掉/);
    assert.doesNotMatch(sanitizeModelReplyText(raw), /invoke/);
  });

  it('keeps Markdown tables and plain pipe prose', () => {
    const table = '| Col A | Col B |\n| --- | --- |\n| foo | bar |';
    assert.equal(sanitizeModelReplyText(table), table);
    assert.equal(
      sanitizeModelReplyText('A | B means either'),
      'A | B means either',
    );
  });

  it('strips fullwidth and |DSML| wrappers without touching table pipes', () => {
    const raw = `\uFF5CDSML\uFF5C|DSML|hello| Col A | Col B |`;
    const out = sanitizeModelReplyText(raw);
    assert.match(out, /hello/);
    assert.match(out, /Col A/);
    assert.doesNotMatch(out, /DSML/i);
  });
});

describe('sanitizeUIMessageTextStream', () => {
  it('suppresses DSML text parts and passes tool chunks through', async () => {
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'start' });
        controller.enqueue({ type: 'text-start', id: 't1' });
        controller.enqueue({
          type: 'text-delta',
          id: 't1',
          delta: '<invoke name="read_file"><parameter name="path">/a.md</parameter></invoke>',
        });
        controller.enqueue({ type: 'text-end', id: 't1' });
        controller.enqueue({
          type: 'tool-input-available',
          toolCallId: 'tc1',
          toolName: 'read_file',
          input: { path: '/a.md' },
        });
        controller.enqueue({ type: 'finish' });
        controller.close();
      },
    });

    const chunks = await collectChunks(sanitizeUIMessageTextStream(input));

    assert.equal(
      chunks.some((c) => c.type === 'text-delta' || c.type === 'text-start'),
      false,
    );
    assert.equal(
      chunks.some((c) => c.type === 'tool-input-available'),
      true,
    );
  });

  it('quarantines mid-stream markup and emits sanitized prose at text-end', async () => {
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-start', id: 't1' });
        controller.enqueue({ type: 'text-delta', id: 't1', delta: '结论' });
        controller.enqueue({
          type: 'text-delta',
          id: 't1',
          delta: '<invoke name="x"></invoke>',
        });
        controller.enqueue({ type: 'text-delta', id: 't1', delta: '成立。' });
        controller.enqueue({ type: 'text-end', id: 't1' });
        controller.close();
      },
    });

    const chunks = await collectChunks(sanitizeUIMessageTextStream(input));
    const liveText = chunks
      .filter((c) => c.type === 'text-delta')
      .map((c) => c.delta ?? '')
      .join('');

    assert.deepEqual(
      chunks.filter((c) => c.type.startsWith('text-')).map((c) => c.type),
      ['text-start', 'text-delta', 'text-end'],
    );
    assert.match(liveText, /结论\s*成立。/);
    assert.doesNotMatch(liveText, /invoke/);
  });

  it('streams clean prose before text-end with only holdback lag', async () => {
    const body = 'a'.repeat(TEXT_STREAM_HOLDBACK_CHARS + 20);
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-start', id: 't1' });
        for (const ch of body) {
          controller.enqueue({ type: 'text-delta', id: 't1', delta: ch });
        }
        controller.enqueue({ type: 'text-end', id: 't1' });
        controller.close();
      },
    });

    const chunks = await collectChunks(sanitizeUIMessageTextStream(input));
    const deltas = chunks.filter((c) => c.type === 'text-delta');
    const liveText = deltas.map((c) => c.delta ?? '').join('');

    assert.equal(liveText, body);
    // Holdback means the first flush is shorter than the full body.
    assert.ok(deltas.length >= 2);
    assert.ok((deltas[0]?.delta?.length ?? 0) < body.length);
  });
});

describe('sanitizeUIMessageTextParts / ensureContinueHintOnMessage', () => {
  it('clears DSML parts and injects continue hint', () => {
    const msg = {
      parts: [
        {
          type: 'text',
          text: '<invoke name="read_file"><parameter name="path">/a.md</parameter></invoke>',
          state: 'done',
        },
      ],
    };
    assert.equal(sanitizeUIMessageTextParts(msg), '');
    ensureContinueHintOnMessage(msg);
    assert.equal(sanitizeUIMessageTextParts(msg), TOOLS_READY_CONTINUE_HINT);
  });

  it('does not duplicate hint when prose already present', () => {
    const msg = {
      parts: [{ type: 'text', text: '已有正文。', state: 'done' }],
    };
    ensureContinueHintOnMessage(msg);
    assert.equal(msg.parts.length, 1);
  });
});
