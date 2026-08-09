/**
 * File-backed session store under EVE_DATA_DIR/sessions.
 * Each session is bound to a bookId (issue #7 / 05 §5.2).
 */

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { stripLeadingQuoteBlocks, stripQuoteWireProtection } from '@wellread/quote-wire';

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
  const question = stripQuoteWireProtection(stripLeadingQuoteBlocks(userMessage)).trim();
  return question || userMessage.trim();
}

/**
 * Keep only messages with the minimum on-disk shape; drop corrupt entries.
 * @param {unknown} raw
 * @returns {SessionMessage | null}
 */
export function normalizeSessionMessage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const m = /** @type {Record<string, unknown>} */ (raw);
  if (typeof m.id !== 'string' || !m.id) return null;
  if (m.role !== 'user' && m.role !== 'assistant' && m.role !== 'system') return null;
  if (typeof m.content !== 'string') return null;
  const createdAt =
    typeof m.createdAt === 'number' && Number.isFinite(m.createdAt) ? m.createdAt : Date.now();
  /** @type {SessionMessage} */
  const out = {
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt,
  };
  if (typeof m.modelContent === 'string') out.modelContent = m.modelContent;
  if (typeof m.reasoning === 'string') out.reasoning = m.reasoning;
  if (Array.isArray(m.sources)) out.sources = /** @type {SessionMessage['sources']} */ (m.sources);
  if (Array.isArray(m.tools)) out.tools = /** @type {SessionMessage['tools']} */ (m.tools);
  if (Array.isArray(m.modelMessages)) out.modelMessages = m.modelMessages;
  if (m.compacted === true) out.compacted = true;
  if (Array.isArray(m.parts)) out.parts = m.parts;
  return out;
}

/**
 * Normalize a session loaded from disk (or a cast JSON body).
 * Missing/corrupt containers become safe empties so callers can .map without 500s.
 * @param {unknown} raw
 * @returns {Session | null}
 */
export function normalizeSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s = /** @type {Record<string, unknown>} */ (raw);
  if (typeof s.id !== 'string' || !isSafeSessionId(s.id)) return null;
  if (typeof s.bookId !== 'string' || !s.bookId) return null;
  const messages = Array.isArray(s.messages)
    ? s.messages.map(normalizeSessionMessage).filter((m) => m != null)
    : [];
  const createdAt =
    typeof s.createdAt === 'number' && Number.isFinite(s.createdAt) ? s.createdAt : Date.now();
  const updatedAt =
    typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt) ? s.updatedAt : createdAt;
  return {
    id: s.id,
    bookId: s.bookId,
    bookTitle: typeof s.bookTitle === 'string' ? s.bookTitle : undefined,
    title: typeof s.title === 'string' && s.title.trim() ? s.title : defaultSessionTitle(
      typeof s.bookTitle === 'string' ? s.bookTitle : undefined,
      s.bookId,
    ),
    createdAt,
    updatedAt,
    messages,
  };
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
    const normalized = normalizeSession(JSON.parse(raw));
    if (!normalized) throw new Error(`corrupt session: ${id}`);
    return normalized;
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
          const session = normalizeSession(
            JSON.parse(readFileSync(join(root, name), 'utf8')),
          );
          if (!session) continue;
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
