/**
 * File-backed session store under EVE_DATA_DIR/sessions.
 * Each session is bound to a bookId (issue #7 / 05 §5.2).
 */

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * @typedef {{
 *   id: string,
 *   bookId: string,
 *   bookTitle?: string,
 *   title: string,
 *   createdAt: number,
 *   updatedAt: number,
 * }} SessionMeta
 *
 * @typedef {{
 *   id: string,
 *   role: 'user' | 'assistant' | 'system',
 *   content: string,
 *   createdAt: number,
 *   reasoning?: string,
 *   sources?: Array<{ cfi: string, endCfi?: string, title?: string, path?: string }>,
 *   tools?: Array<{ id: string, name: string, args?: unknown, result?: unknown }>,
 *   compacted?: boolean,
 * }} SessionMessage
 *
 * @typedef {SessionMeta & { messages: SessionMessage[] }} Session
 */

/**
 * @param {string} dataDir
 */
export function createSessionStore(dataDir) {
  const root = join(dataDir, 'sessions');
  mkdirSync(root, { recursive: true });

  function pathFor(id) {
    return join(root, `${id}.json`);
  }

  function read(id) {
    const raw = readFileSync(pathFor(id), 'utf8');
    return /** @type {Session} */ (JSON.parse(raw));
  }

  function writeAtomic(session) {
    const target = pathFor(session.id);
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(session, null, 2));
    renameSync(tmp, target);
  }

  return {
    /**
     * @param {{ bookId: string, bookTitle?: string, title?: string }} input
     * @returns {Session}
     */
    create(input) {
      const id = `ses_${randomBytes(8).toString('hex')}`;
      const now = Date.now();
      const session = {
        id,
        bookId: input.bookId,
        bookTitle: input.bookTitle,
        title: input.title?.trim() || `Chat about ${input.bookTitle || input.bookId}`,
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      writeAtomic(session);
      return session;
    },

    /**
     * @param {string} id
     * @returns {Session | null}
     */
    get(id) {
      try {
        return read(id);
      } catch {
        return null;
      }
    },

    /**
     * @param {string} [bookId]
     * @returns {SessionMeta[]}
     */
    list(bookId) {
      /** @type {SessionMeta[]} */
      const out = [];
      for (const name of readdirSync(root)) {
        if (!name.endsWith('.json')) continue;
        try {
          const session = /** @type {Session} */ (
            JSON.parse(readFileSync(join(root, name), 'utf8'))
          );
          if (bookId && session.bookId !== bookId) continue;
          out.push({
            id: session.id,
            bookId: session.bookId,
            bookTitle: session.bookTitle,
            title: session.title,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
          });
        } catch {
          // skip corrupt
        }
      }
      return out.sort((a, b) => b.updatedAt - a.updatedAt);
    },

    /**
     * @param {Session} session
     */
    save(session) {
      session.updatedAt = Date.now();
      writeAtomic(session);
    },

    /**
     * @param {string} id
     * @returns {boolean}
     */
    remove(id) {
      try {
        rmSync(pathFor(id));
        return true;
      } catch {
        return false;
      }
    },
  };
}
