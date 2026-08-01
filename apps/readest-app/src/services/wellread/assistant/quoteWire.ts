/**
 * FE hydrate for Pending Quote wire (protocol in @wellread/quote-wire).
 */

import { parsePendingQuotesFromWire } from '@wellread/quote-wire';

export type HydrateableEveMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  quotes?: Array<{ text: string; chapterTitle?: string | null }>;
  [key: string]: unknown;
};

/**
 * Disk sessions store model wire text (blockquote quotes). Live UI keeps quotes
 * separate — rehydrate so Chat History matches the in-session bubble.
 */
export function hydrateEveMessagesForDisplay<T extends HydrateableEveMessage>(messages: T[]): T[] {
  return messages.map((msg) => {
    if (msg.role !== 'user') return msg;
    if (msg.quotes?.length) return msg;
    const { quotes, content } = parsePendingQuotesFromWire(msg.content);
    if (!quotes.length) return msg;
    return { ...msg, content, quotes };
  });
}
