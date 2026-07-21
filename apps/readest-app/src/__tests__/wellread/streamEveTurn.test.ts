import { beforeEach, describe, expect, it, vi } from 'vitest';

const eveFetch = vi.fn();

vi.mock('@/services/wellread/assistant/eveFetch', () => ({
  eveFetch: (...args: unknown[]) => eveFetch(...args),
}));

function ndjsonStream(lines: string[]): {
  body: ReadableStream<Uint8Array>;
  cancel: ReturnType<typeof vi.fn>;
} {
  const encoder = new TextEncoder();
  const cancel = vi.fn(async () => {});
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < lines.length) {
        controller.enqueue(encoder.encode(`${lines[i++]}\n`));
        return;
      }
      controller.close();
    },
    cancel,
  });
  return { body, cancel };
}

describe('streamEveTurn', () => {
  beforeEach(() => {
    vi.resetModules();
    eveFetch.mockReset();
    const w = window as Window & { EVE_BASE_URL?: string; EVE_LOOPBACK_TOKEN?: string };
    w.EVE_BASE_URL = 'http://127.0.0.1:43111';
    w.EVE_LOOPBACK_TOKEN = 'tok';
  });

  it('cancels the underlying reader when the consumer exits early on an error event', async () => {
    const { body, cancel } = ndjsonStream([
      JSON.stringify({ type: 'message.assistant.delta', id: 'a1', delta: 'hi' }),
      JSON.stringify({ type: 'error', message: 'model failed' }),
      JSON.stringify({ type: 'done' }),
    ]);
    eveFetch.mockResolvedValue(new Response(body, { status: 200 }));

    const { streamEveTurn } = await import('@/services/wellread/assistant/eveClient');

    await expect(async () => {
      for await (const event of streamEveTurn('ses_1', 'hello')) {
        if (event.type === 'error') throw new Error(event.message);
      }
    }).rejects.toThrow('model failed');

    expect(cancel).toHaveBeenCalled();
  });
});
