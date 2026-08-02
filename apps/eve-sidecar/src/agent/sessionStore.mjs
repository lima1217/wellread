/**
 * File-backed session store under EVE_DATA_DIR/sessions.
 * Each session is bound to a bookId (issue #7 / 05 §5.2).
 */

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { stripLeadingQuoteBlocks } from '@wellread/quote-wire';

/** create() stamps `ses_` + 16 hex chars; reject anything else before path join. */
const SESSION_ID_RE = /^ses_[0-9a-f]{16}$/;

/**
 * Session ids are path segments under EVE_DATA_DIR/sessions — never allow
 * separators or traversal after URL decode.
 * @param {unknown} id
 */
export function isSafeSessionId(id) {
  return typeof id === 'string' && SESSION_ID_RE.test(id);
}

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
 * @typedef {import('@wellread/eve-message').SessionMessage} SessionMessage
 *
 * @typedef {SessionMeta & { messages: SessionMessage[] }} Session
 */

/** Default title stamped at create time (History distinguishes after first turn). */
export function defaultSessionTitle(bookTitle, bookId) {
  return `Chat about ${bookTitle || bookId}`;
}

/**
 * On the first successful turn, replace the default title with a user-message prefix
 * so History can tell same-book sessions apart.
 * @param {{ bookId: string, bookTitle?: string, title: string }} session
 * @param {string} userMessage
 * @param {number} [maxLen]
 * @returns {boolean} true when title was updated
 */
export function maybeApplyFirstTurnTitle(session, userMessage, maxLen = 40) {
  if (session.title !== defaultSessionTitle(session.bookTitle, session.bookId)) {
    return false;
  }
  // Wire text may prepend Pending Quote blockquotes; prefer the trailing question.
  const forTitle = userQuestionForTitle(userMessage);
  const compact = forTitle.replace(/\s+/g, ' ').trim();
  if (!compact) return false;
  session.title =
    compact.length <= maxLen ? compact : `${compact.slice(0, maxLen - 1)}…`;
  return true;
}

/**
 * @param {string} userMessage
 */
function userQuestionForTitle(userMessage) {
  // Drop composer-question protection (U+200B) used by quote-wire format.
  const question = stripLeadingQuoteBlocks(userMessage).replace(/^\u200B/, '').trim();
  return question || userMessage.trim();
}

/**
 * @param {string} dataDir
 */
export function createSessionStore(dataDir) {
  const root = join(dataDir, 'sessions');
  mkdirSync(root, { recursive: true });

  function pathFor(id) {
    if (!isSafeSessionId(id)) {
      throw new Error(`invalid session id: ${id}`);
    }
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
        title: input.title?.trim() || defaultSessionTitle(input.bookTitle, input.bookId),
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
      if (!isSafeSessionId(id)) return null;
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
      if (!isSafeSessionId(id)) return false;
      try {
        rmSync(pathFor(id));
        return true;
      } catch {
        return false;
      }
    },
  };
}
