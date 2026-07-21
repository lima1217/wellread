/**
 * Pure helpers for Reading Assistant v1 (issue #7 / assets 08).
 */

export type ReadingAssistantGate = {
  modelEnabled: boolean;
  sidecarReady: boolean;
  /** Valid `activeProfileId` that resolves to a profile row. */
  hasActiveProfile: boolean;
  /** Non-empty keychain apiKey for the active profile. */
  hasApiKey: boolean;
};

/** AI available = enabled + sidecar ready + valid active profile + that profile's key. */
export function isReadingAssistantAvailable(gate: ReadingAssistantGate): boolean {
  return gate.modelEnabled && gate.sidecarReady && gate.hasActiveProfile && gate.hasApiKey;
}

export type PendingQuoteForTurn = {
  text: string;
  chapterTitle?: string | null;
};

/**
 * Wire content for an eve turn: Pending Quote blockquotes + user question.
 * Composer stays quote-free; this is only what the model receives.
 */
export function formatPendingQuotesForTurn(
  quotes: PendingQuoteForTurn[],
  userText: string,
): string {
  const question = userText.trim();
  const blocks = quotes
    .map((q) => {
      const text = q.text.trim();
      if (!text) return '';
      const lines = [`> ${text}`];
      const chapter = q.chapterTitle?.trim();
      if (chapter) {
        lines.push(`> — 《${chapter}》`);
      }
      return lines.join('\n');
    })
    .filter(Boolean);
  return [...blocks, question].filter(Boolean).join('\n\n');
}

export type SystemPromptInput = {
  bookId: string;
  bookTitle?: string | null;
};

export function buildReadingAssistantSystemPrompt(input: SystemPromptInput): string {
  const title = input.bookTitle?.trim() || input.bookId;
  const extractRoot = `/workspace/.wellread/extract/${input.bookId}/`;
  const notesRoot = `/workspace/.wellread/notes/${input.bookId}/`;
  return [
    'You are the Reading Assistant for wellread — a desktop ebook reader.',
    `Current book: "${title}" (bookId=${input.bookId}).`,
    `Stay on the current book only. Prefer materials under ${extractRoot}.`,
    'You may use glob, grep, and read_file on that extract tree when helpful; do not read epub/pdf binaries as text.',
    'Grounding is optional: answer freely when you already know enough; cite book locations when you reference specific passages.',
    'When citing a passage, prefer sources with cfi (and optional endCfi/title) from chunk frontmatter so the reader can jump back.',
    `write_file only when the user explicitly asks to save/write/store something. Use fixed paths under ${notesRoot} (e.g. summary.md, outline.md, chapters/<slug>.md) and overwrite in place. Do not write otherwise; do not ask for confirmation.`,
    'Match the user language (Chinese question → Chinese answer).',
    'Do not pretend to have skills that are not mounted (translation pipelines, wiki packs, cross-book search).',
  ].join('\n');
}

export type SourceItem = {
  cfi: string;
  endCfi?: string;
  title?: string;
  path?: string;
};

/** Parse 09-style chunk markdown frontmatter into source items. */
export function extractSourcesFromChunkMarkdown(markdown: string, path?: string): SourceItem[] {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return [];
  const block = match[1]!;
  const get = (key: string): string | undefined => {
    const m = block.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
    if (!m) return undefined;
    const raw = m[1]!.trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      try {
        return JSON.parse(
          `"${raw.slice(1, -1).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
        ) as string;
      } catch {
        return raw.slice(1, -1);
      }
    }
    return raw || undefined;
  };
  const cfi = get('cfi');
  if (!cfi) return [];
  const endCfi = get('endCfi');
  const title = get('title');
  return [
    {
      cfi,
      ...(endCfi ? { endCfi } : {}),
      ...(title ? { title } : {}),
      ...(path ? { path } : {}),
    },
  ];
}

export type ToolTraceEntry = { name: string };

/** One-line collapsed summary for tool traces. */
export function summarizeToolTrace(tools: ToolTraceEntry[]): string {
  const n = tools.length;
  if (n === 0) return '';
  // English key-as-content; UI may pass through useTranslation.
  return `Searched ${n} places`;
}
