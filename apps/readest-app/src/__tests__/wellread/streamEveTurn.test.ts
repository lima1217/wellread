import { beforeEach, describe, expect, it, vi } from 'vitest';
import { responseToUIMessageChunkStream } from '@/services/wellread/assistant/eveClient';

const eveFetch = vi.fn();

vi.mock('@/services/wellread/assistant/eveFetch', () => ({
  eveFetch: (...args: unknown[]) => eveFetch(...args),
}));

function sseStream(chunks: object[]): {
  body: ReadableStream<Uint8Array>;
  cancel: ReturnType<typeof vi.fn>;
} {
  const encoder = new TextEncoder();
  const cancel = vi.fn(async () => {});
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunks[i++])}\n\n`));
        return;
      }
      controller.close();
    },
    cancel,
  });
  return { body, cancel };
}

describe('responseToUIMessageChunkStream', () => {
  it('parses AI SDK SSE chunks into UIMessageChunk objects', async () => {
    const { body } = sseStream([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'hi' },
      { type: 'text-end', id: 't1' },
    ]);

    const reader = responseToUIMessageChunkStream(body).getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    expect(chunks.some((c) => c.type === 'text-delta' && c.delta === 'hi')).toBe(true);
  });
});

describe('streamEveTurn', () => {
  beforeEach(() => {
    vi.resetModules();
    eveFetch.mockReset();
    const w = window as Window & { EVE_BASE_URL?: string; EVE_LOOPBACK_TOKEN?: string };
    w.EVE_BASE_URL = 'http://127.0.0.1:43111';
    w.EVE_LOOPBACK_TOKEN = 'tok';
  });

  it('surfaces side-channel error events from the SSE stream', async () => {
    const { body } = sseStream([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'hi' },
      { type: 'error', errorText: 'model failed' },
    ]);
    eveFetch.mockResolvedValue(new Response(body, { status: 200 }));

    const { streamEveTurn } = await import('@/services/wellread/assistant/eveClient');

    await expect(async () => {
      for await (const event of streamEveTurn('ses_1', 'hello')) {
        if (event.type === 'error') throw new Error(event.message);
      }
    }).rejects.toThrow('model failed');
  });

  it('yields ui-message events assembled from the SSE stream', async () => {
    const { body } = sseStream([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Hello' },
      { type: 'text-end', id: 't1' },
    ]);
    eveFetch.mockResolvedValue(new Response(body, { status: 200 }));

    const { streamEveTurn } = await import('@/services/wellread/assistant/eveClient');

    const events = [];
    for await (const event of streamEveTurn('ses_1', 'hello')) {
      events.push(event);
    }

    const uiMessages = events.filter((e) => e.type === 'ui-message');
    expect(uiMessages.length).toBeGreaterThan(0);
    const last = uiMessages.at(-1)!;
    expect(last.type).toBe('ui-message');
    if (last.type === 'ui-message') {
      const text = last.message.parts
        ?.filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('');
      expect(text).toBe('Hello');
    }
  });
});
