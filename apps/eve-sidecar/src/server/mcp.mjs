/**
 * MCP server for external agents (Claude Code, other MCP clients).
 *
 * Gives them the in-app Reading Assistant's tool set over the book the
 * reader has open in Wellread, plus two live views of the reader:
 * `get_reading_state` (the same `<reading_context>` + `<reader_memory>` the
 * in-app agent gets per turn) and `get_selection`. Skills are MCP prompts.
 *
 * Transport: stateless Streamable HTTP (POST JSON-RPC → JSON) on the sidecar,
 * reached through the stdio bridge in mcpBridge.mjs. Live state comes from
 * readerLive.mjs; spoiler guard and annotation sharing follow the reader's
 * settings exactly as they do for in-app turns.
 */

import { asSchema } from 'ai';
import { buildReadingSnapshot } from '../agent/readingSnapshot.mjs';
import { formatReaderMemoryBlock } from '../agent/readerMemory.mjs';
import { discoverSkills } from '../agent/skills/discover.mjs';
import { formatSkillInvocation, loadSkillPackage } from '../agent/skills/invoke.mjs';
import { createToolParallelBudget } from '../agent/toolParallelBudget.mjs';
import { READER_ACTIONS } from '../agent/readerActions.mjs';
import { createReadingTools } from '../agent/tools.mjs';

export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const SERVER_INFO = { name: 'wellread', title: 'Wellread', version: '1.0.0' };

export const MCP_INSTRUCTIONS = [
  "Wellread is the reader's ebook app. These tools work on the book open in Wellread right now, the same tools its built-in Reading Assistant uses.",
  'Start with get_reading_state: it names the book and returns <reading_context> (position, focus_text = the page on screen, quotes = what the reader selected or queued, section chunks, extract status, spoiler guard) and <reader_memory>. Call it again whenever the reader says they moved on; get_selection is the cheap check for "this passage / what I selected".',
  'Book text lives under /workspace/.wellread/extract/<bookId>/ (toc.md, section-index.json, chunks/*.md with cfi frontmatter). Locate the smallest text that answers: quotes first (read_file their chunks for surroundings); "this page" from focus_text; a whole chapter with read_section_text; topics with search_book; exact phrases with grep. Write search_book / grep queries in the book\'s language.',
  'spoiler_guard on means the reader asked not to be spoiled: tools hide text past their position; keep later events out of answers, including from your own knowledge of the book.',
  'Reader data: annotations export /workspace/.wellread/annotations/<bookId>.md; notes wiki /workspace/.wellread/notes/<bookId>/ (write_file only when the reader asks to save); search_library searches what the reader wrote about other books. Call remember for durable facts about the reader or their reading of this book.',
  'You can act in the reader too: open_in_reader / turn_page move the reader\'s view; highlight marks a passage (with note = an annotation the reader sees in the margin); add_bookmark; list_annotations / update_annotation / delete_annotation manage highlights, notes and bookmarks (yours and the reader\'s alike). Quote passages exactly as the book prints them (copy from extract text); pass the chunk cfi you read them from so the reader finds them fast. Act when the reader asks or clearly wants it, and say what you changed.',
  "When you point at a passage, name its chapter and quote a short phrase, or open it with open_in_reader; the reader is reading along in Wellread. Reply in the reader's language.",
].join('\n\n');

const READ_ONLY_TOOLS = new Set([
  'read_file',
  'resolve_section',
  'read_section_text',
  'search_book',
  'search_library',
  'glob',
  'grep',
]);

const NO_BOOK_MESSAGE =
  'No book is open in Wellread. Ask the reader to open the book they want help with, then retry.';

/**
 * @param {{
 *   getBooksRoot: () => string,
 *   getLive: () => import('./readerLive.mjs').ReaderLiveState | null,
 *   getModel?: () => import('ai').LanguageModel | null, // write_file(draft) compose
 *   getContextWindowTokens?: () => number | undefined,
 *   runReaderCommand?: (bookId: string, type: string, args: Record<string, unknown>) => Promise<unknown>,
 *   tools?: import('ai').ToolSet, // test seam
 * }} deps
 */
export function createMcpServer(deps) {
  const readingTools = deps.tools ?? createReadingTools();

  function liveBook() {
    const live = deps.getLive();
    if (!live) return null;
    let booksRoot = '';
    try {
      booksRoot = deps.getBooksRoot();
    } catch {
      // Snapshot still names the book; tools report the missing root.
    }
    return { live, booksRoot };
  }

  /** @param {import('./readerLive.mjs').ReaderLiveState} live */
  function liveQuotes(live) {
    const quotes = live.selection ? [live.selection] : [];
    for (const q of live.pendingQuotes) {
      if (!quotes.some((x) => x.text === q.text && x.cfi === q.cfi)) quotes.push(q);
    }
    return quotes;
  }

  /** @param {{ live: import('./readerLive.mjs').ReaderLiveState, booksRoot: string }} at */
  function snapshot(at, quotes) {
    return buildReadingSnapshot({
      booksRoot: at.booksRoot,
      bookId: at.live.bookId,
      bookTitle: at.live.bookTitle,
      readerState: at.live.readerState,
      spoilerGuard: at.live.spoilerGuard,
      quotes,
    });
  }

  /** Live views only Wellread has; everything else is the in-app tool set. */
  const liveTools = {
    get_reading_state: {
      description:
        "What the reader is doing in Wellread now: the open book, position, the page on screen (focus_text), selected / queued quotes with their extract chunks, section chunks, spoiler guard and the reader's saved memory. Call this first and whenever the reader may have moved on.",
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => {
        const at = liveBook();
        if (!at) return { ok: false, error: 'no_book_open', message: NO_BOOK_MESSAGE };
        const snap = snapshot(at, liveQuotes(at.live));
        return [snap.envelope, formatReaderMemoryBlock(snap.memory)]
          .filter(Boolean)
          .join('\n\n');
      },
    },
    get_selection: {
      description:
        'The text the reader has selected in Wellread right now, plus quotes they queued with "Ask about this". Each comes with its chapter, cfi and the extract chunk(s) holding it (read_file those for surrounding text).',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => {
        const at = liveBook();
        if (!at) return { ok: false, error: 'no_book_open', message: NO_BOOK_MESSAGE };
        const pending = at.live.pendingQuotes;
        const resolved = snapshot(at, [
          ...(at.live.selection ? [at.live.selection] : []),
          ...pending,
        ]).quotes;
        const selection = at.live.selection ? resolved[0] : null;
        return {
          ok: true,
          bookId: at.live.bookId,
          ...(at.live.bookTitle ? { bookTitle: at.live.bookTitle } : {}),
          selection,
          pendingQuotes: resolved.slice(selection ? 1 : 0),
          ...(selection || pending.length
            ? {}
            : { message: 'Nothing is selected in Wellread right now.' }),
        };
      },
    },
  };

  /** @type {Promise<unknown[]> | null} */
  let toolListPromise = null;
  function listTools() {
    toolListPromise ??= Promise.all([
      ...Object.entries(liveTools).map(async ([name, t]) => ({
        name,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: { readOnlyHint: true },
      })),
      ...Object.entries(readingTools).map(async ([name, t]) => {
        const { $schema: _schema, ...inputSchema } = /** @type {Record<string, unknown>} */ (
          await asSchema(t.inputSchema).jsonSchema
        );
        return {
          name,
          description: t.description,
          inputSchema,
          annotations: Object.hasOwn(READER_ACTIONS, name)
            ? READER_ACTIONS[/** @type {keyof typeof READER_ACTIONS} */ (name)].annotations
            : READ_ONLY_TOOLS.has(name)
              ? { readOnlyHint: true }
              : { readOnlyHint: false, destructiveHint: false },
        };
      }),
    ]);
    return toolListPromise;
  }

  /**
   * @param {string} name
   * @param {unknown} args
   * @returns {Promise<{ content: Array<{ type: 'text', text: string }>, isError?: boolean }>}
   */
  async function callTool(name, args) {
    const text = (/** @type {unknown} */ value) =>
      typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    const result = (/** @type {unknown} */ value, isError = false) => ({
      content: [{ type: /** @type {const} */ ('text'), text: text(value) }],
      ...(isError ? { isError: true } : {}),
    });

    if (Object.hasOwn(liveTools, name)) {
      return result(liveTools[/** @type {keyof typeof liveTools} */ (name)].run());
    }
    const def = Object.hasOwn(readingTools, name) ? readingTools[name] : null;
    if (!def?.execute) return result({ ok: false, error: 'unknown_tool', message: name }, true);

    const at = liveBook();
    if (!at) return result({ ok: false, error: 'no_book_open', message: NO_BOOK_MESSAGE }, true);

    const parsed = await asSchema(def.inputSchema).validate?.(args ?? {});
    if (parsed && !parsed.success) {
      return result(
        { ok: false, error: 'invalid_args', message: parsed.error?.message ?? 'invalid arguments' },
        true,
      );
    }
    const { live, booksRoot } = at;
    const model = deps.getModel?.() ?? null;
    const contextWindowTokens = deps.getContextWindowTokens?.();
    // One call = one step: the parallel budget only bounds a step's fan-out.
    const parallelBudget = createToolParallelBudget();
    parallelBudget.beginStep();
    const context = {
      bookId: live.bookId,
      booksRoot,
      parallelBudget,
      ...(model ? { model } : {}),
      ...(typeof contextWindowTokens === 'number' ? { contextWindowTokens } : {}),
      ...(live.bookTitle ? { bookTitle: live.bookTitle } : {}),
      ...(live.shareAnnotations ? {} : { shareAnnotations: false }),
      ...(deps.runReaderCommand ? { runReaderCommand: deps.runReaderCommand } : {}),
      spoilerGuard: snapshot(at, []).spoilerGuard,
    };
    try {
      const out = await def.execute(parsed?.success ? parsed.value : args, {
        toolCallId: `mcp_${Date.now().toString(36)}`,
        messages: [],
        context,
      });
      return result(out);
    } catch (error) {
      return result(
        { ok: false, error: 'tool_failed', message: error instanceof Error ? error.message : String(error) },
        true,
      );
    }
  }

  function booksRootOrEmpty() {
    try {
      return deps.getBooksRoot();
    } catch {
      return '';
    }
  }

  function listPrompts() {
    return discoverSkills({ booksRoot: booksRootOrEmpty() }).map((s) => ({
      name: s.id,
      title: s.name,
      description: s.description,
      arguments: [
        { name: 'request', description: 'What to apply the skill to (optional)', required: false },
      ],
    }));
  }

  /** @param {string} name @param {Record<string, unknown> | undefined} args */
  function getPrompt(name, args) {
    const skill = loadSkillPackage(booksRootOrEmpty(), name);
    if (!skill) return null;
    const request = typeof args?.request === 'string' ? args.request : undefined;
    return {
      description: skill.description,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              'First call get_reading_state (and get_selection when the request is about a passage) to see what I am reading in Wellread.',
              formatSkillInvocation(skill, request),
            ].join('\n\n'),
          },
        },
      ],
    };
  }

  /**
   * Handle one JSON-RPC message. Returns null for notifications.
   * @param {unknown} message
   */
  async function handleMessage(message) {
    const msg = /** @type {{ jsonrpc?: string, id?: unknown, method?: unknown, params?: any }} */ (
      message && typeof message === 'object' ? message : {}
    );
    const isRequest = msg.id !== undefined && msg.id !== null;
    if (!isRequest) return null; // notifications (initialized, cancelled) and responses
    const ok = (/** @type {unknown} */ res) => ({ jsonrpc: '2.0', id: msg.id, result: res });
    const fail = (/** @type {number} */ code, /** @type {string} */ text) => ({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code, message: text },
    });
    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return fail(-32600, 'Invalid Request');
    }
    const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
    switch (msg.method) {
      case 'initialize': {
        const requested = params.protocolVersion;
        return ok({
          protocolVersion: MCP_PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : MCP_PROTOCOL_VERSIONS[0],
          capabilities: { tools: {}, prompts: {} },
          serverInfo: SERVER_INFO,
          instructions: MCP_INSTRUCTIONS,
        });
      }
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: await listTools() });
      case 'tools/call':
        if (typeof params.name !== 'string') return fail(-32602, 'tools/call needs a name');
        return ok(await callTool(params.name, params.arguments));
      case 'prompts/list':
        return ok({ prompts: listPrompts() });
      case 'prompts/get': {
        const prompt =
          typeof params.name === 'string' ? getPrompt(params.name, params.arguments) : null;
        return prompt ? ok(prompt) : fail(-32602, `Unknown prompt: ${String(params.name)}`);
      }
      default:
        return fail(-32601, `Method not found: ${msg.method}`);
    }
  }

  /**
   * One HTTP POST body: a message or a batch.
   * @param {unknown} body
   * @returns {Promise<unknown | null>} null → 202 Accepted, nothing to send
   */
  async function handleBody(body) {
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map(handleMessage))).filter((r) => r !== null);
      return out.length ? out : null;
    }
    return handleMessage(body);
  }

  return { handleBody, handleMessage };
}
