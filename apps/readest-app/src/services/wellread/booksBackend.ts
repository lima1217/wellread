/**
 * SandboxBackend-shaped factory for Books (no eve import).
 * Ticket 05/06 wires: defineSandbox({ backend: wellreadBooksBackend(...) }).
 */

import { createBooksFsSession, type BooksFsSession } from './booksFsSession';

export type WellreadBooksBackendOptions = {
  getBooksRoot: () => string;
};

export type WellreadBooksBackendHandle = {
  session: BooksFsSession;
  captureState(): Promise<{
    backendName: string;
    sessionKey: string;
    metadata: Record<string, unknown>;
  }>;
  shutdown(): Promise<void>;
};

export type WellreadBooksBackend = {
  readonly name: 'wellread-books';
  create(input?: { sessionKey?: string }): Promise<WellreadBooksBackendHandle>;
  /** No seed/template — live Books root; always "reused". */
  prewarm(): Promise<{ reused: true }>;
};

export function wellreadBooksBackend(options: WellreadBooksBackendOptions): WellreadBooksBackend {
  return {
    name: 'wellread-books',
    async prewarm() {
      return { reused: true };
    },
    async create(input = {}) {
      const session = createBooksFsSession({
        getBooksRoot: options.getBooksRoot,
      });
      return {
        session,
        async captureState() {
          return {
            backendName: 'wellread-books',
            sessionKey: input.sessionKey ?? 'wellread-books',
            metadata: {},
          };
        },
        async shutdown() {
          // Host FS — nothing to tear down.
        },
      };
    },
  };
}
