'use client';

import { useCallback, useEffect, useRef, useState, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { ArrowUpIcon, CheckIcon, ChevronUpIcon, CopyIcon, Loader2Icon, XIcon } from 'lucide-react';
import clsx from 'clsx';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReaderStore } from '@/store/readerStore';
import { useEnv } from '@/context/EnvContext';
import { writeTextToClipboard } from '@/utils/clipboard';
import { saveSysSettings } from '@/helpers/settings';
import { eventDispatcher } from '@/utils/event';
import { getModelApiKey } from '@/services/wellread/modelApiKey';
import {
  getActiveProfile,
  mergeModelConfig,
  setActiveProfile,
  shouldHotReloadEve,
  toSidecarModelPayload,
} from '@/services/wellread/modelConfig';
import { reloadEveSidecar } from '@/services/wellread/eveSidecar';
import { useEveConnectionStore } from '@/services/wellread/eveConnectionStore';
import {
  applySlashSkillSelection,
  filterSkillsForSlash,
  formatWorkDuration,
  getComposerSlashQuery,
  isExternalHttpHref,
  isReadingAssistantAvailable,
  linkifyBareEpubCfi,
  normalizeEpubCfi,
  resolveEveSource,
  shouldPushAgentSessionToStore,
  shouldShowPendingReply,
  SKILL_SLASH_PREFIX,
  stripAssistantCfiCitations,
  summarizeToolTrace,
} from '@/services/wellread/assistant/helpers';
import { useEveAgent } from '@/services/wellread/assistant/useEveAgent';
import {
  useReadingAssistantStore,
  type PendingQuote,
} from '@/services/wellread/assistant/readingAssistantStore';
import type {
  EveMessage,
  EveMessageQuote,
  EveSkillSummary,
  EveSource,
  EveToolTrace,
} from '@/services/wellread/assistant/eveClient';
import { listEveSkills } from '@/services/wellread/assistant/eveClient';
import { openExternalUrl } from '@/utils/open';

interface AIAssistantProps {
  bookKey: string;
  /** False while History pane covers chat (chat stays mounted). */
  isActive?: boolean;
}

const focusRing =
  'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2';

/** Composer toolbar selects: flat ghost, not filled pills. */
const composerSelectTrigger = clsx(
  'text-base-content/55 hover:text-base-content hover:bg-base-200/70',
  // Optical: less padding on the chevron side (text-side − 2px).
  'flex h-7 items-center gap-0.5 rounded-md ps-2 pe-1.5 text-[0.85em] leading-tight whitespace-nowrap',
  'transition-colors duration-150',
);
// Daisy `.dropdown-content` defaults to 14px radius / 10px pad — override for a dense
// composer menu. Outer 10px + p-1 (4px) → inner rounded-md (6px) stays concentric.
const composerSelectMenu = clsx(
  'dropdown-content no-triangle border-base-200 bg-base-100 eink-bordered',
  'z-20 mb-1.5 overflow-y-auto overscroll-contain !rounded-[10px] border !p-1 font-sans',
  '!shadow-[0_1px_2px_oklch(0_0_0/0.06),0_4px_14px_oklch(0_0_0/0.08)]',
);
const composerSelectItem = clsx(
  'hover:bg-base-200/80 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
  'text-start text-[0.85em] leading-snug transition-colors duration-150',
);
const composerSelectItemActive = 'bg-base-200/70 text-base-content hover:bg-base-200/80';

function ComposerSelectCheck({ active }: { active: boolean }) {
  return (
    <span className='flex size-3.5 shrink-0 items-center justify-center' aria-hidden='true'>
      {active ? <CheckIcon size={14} strokeWidth={2.25} className='text-base-content/55' /> : null}
    </span>
  );
}
/** Shared circular action: solid when Send/Stop is live, muted when idle. */
const composerPrimaryBtn =
  'ms-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-150';
const composerPrimaryBtnLive = 'bg-base-content text-base-100 hover:opacity-90';
const composerPrimaryBtnIdle = 'bg-base-200/70 text-base-content/30';

/** Book excerpt in assistant prose — editorial pull-quote, not a chat bubble. */
function MarkdownBlockquote({ children }: { children?: ReactNode }) {
  return (
    <blockquote className='border-base-content/20 text-base-content/65 my-[0.75em] border-s-2 ps-3.5 text-[0.92em] leading-[1.6] not-italic'>
      <div
        className='text-base-content/30 mb-1 select-none font-sans text-[0.8em] leading-none tracking-wide'
        aria-hidden='true'
      >
        ❝
      </div>
      <div className='text-pretty [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0'>
        {children}
      </div>
    </blockquote>
  );
}

/** Models often wrap citations with `---` → `<hr>`; keep the break, drop the white line. */
function MarkdownRule() {
  return <div className='my-[0.75em]' aria-hidden='true' />;
}

function languageFromClassName(className?: string): string | null {
  if (!className) return null;
  const m = /(?:^|\s)language-([\w#+.-]+)/.exec(className);
  return m?.[1] ?? null;
}

/** Fenced block chrome: optional language chip; shell carries eink-safe 1px edge. */
function MarkdownPre({ children }: { children?: ReactNode }) {
  const child = Array.isArray(children) ? children[0] : children;
  const language =
    isValidElement(child) && child.props && typeof child.props === 'object'
      ? languageFromClassName((child.props as { className?: string }).className)
      : null;
  return (
    <div
      className={clsx(
        'bg-base-100/80 eink-bordered border-base-content/10 my-[0.75em] overflow-hidden rounded-lg border',
      )}
    >
      {language ? (
        <div
          className={clsx(
            'text-base-content/45 border-base-content/10 border-b px-3 py-1.5',
            'select-none font-sans text-[0.75em] leading-none tracking-wide',
          )}
        >
          {language}
        </div>
      ) : null}
      <pre className='overflow-x-auto p-3.5 font-mono text-[0.875em] leading-relaxed'>
        {children}
      </pre>
    </div>
  );
}

function MarkdownTable({ children }: { children?: ReactNode }) {
  return (
    <div
      className={clsx(
        'eink-bordered border-base-content/15 my-[0.75em] overflow-x-auto rounded-lg border',
      )}
    >
      <table className='w-full border-collapse text-[0.92em] leading-[1.45]'>{children}</table>
    </div>
  );
}

function plainTextFromChildren(children: ReactNode): string {
  if (children == null || typeof children === 'boolean') return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(plainTextFromChildren).join('');
  if (isValidElement(children)) {
    const el = children as ReactElement<{ children?: ReactNode }>;
    return plainTextFromChildren(el.props.children);
  }
  return '';
}

function jumpToCfi(bookKey: string, cfi: string) {
  eventDispatcher.dispatch('navigate', { bookKey, cfi });
  useReaderStore.getState().getView(bookKey)?.goTo(cfi);
}

function createAssistantMarkdownComponents(opts: {
  bookKey: string;
  sources?: EveSource[];
  passageLabel: string;
}): Components {
  const jumpButton = (cfi: string, display?: ReactNode) => {
    const source = resolveEveSource(opts.sources, { href: cfi });
    const label = display ?? source?.title?.trim() ?? opts.passageLabel;
    return (
      <button
        type='button'
        className={clsx(
          'text-base-content underline decoration-from-font underline-offset-2',
          'hover:text-base-content/80',
          focusRing,
        )}
        onClick={(e) => {
          e.preventDefault();
          jumpToCfi(opts.bookKey, source?.cfi ?? cfi);
        }}
      >
        {label}
      </button>
    );
  };

  return {
    blockquote: ({ children }) => <MarkdownBlockquote>{children}</MarkdownBlockquote>,
    hr: () => <MarkdownRule />,
    pre: ({ children }) => <MarkdownPre>{children}</MarkdownPre>,
    table: ({ children }) => <MarkdownTable>{children}</MarkdownTable>,
    code: ({ children, className }) => {
      // Fenced blocks get a language class; leave those alone.
      if (className) {
        return <code className={className}>{children}</code>;
      }
      const text = plainTextFromChildren(children).trim();
      const cfi = normalizeEpubCfi(text);
      if (cfi) return jumpButton(cfi);
      return <code>{children}</code>;
    },
    a: ({ href, children }) => {
      const label = plainTextFromChildren(children);
      const source = resolveEveSource(opts.sources, { href, label });
      if (source?.cfi) {
        const rawCfiLabel =
          /epubcfi\(/i.test(label) && extractEpubCfiFromLabel(label) === label.trim();
        const display =
          source.title?.trim() || (rawCfiLabel ? opts.passageLabel : null) || children;
        return jumpButton(source.cfi, display);
      }
      // Relative/file/workspace hrefs must not become target=_blank — that opens a
      // non-Tauri browser window and crashes settings sync on getCurrentWindow().
      if (!isExternalHttpHref(href)) {
        return <span>{children}</span>;
      }
      return (
        <button
          type='button'
          className={clsx(
            'text-base-content underline decoration-from-font underline-offset-2',
            'hover:text-base-content/80',
            focusRing,
          )}
          onClick={(e) => {
            e.preventDefault();
            openExternalUrl(href!);
          }}
        >
          {children}
        </button>
      );
    },
  };
}

function extractEpubCfiFromLabel(text: string): string | null {
  const m = text.match(/epubcfi\([^)]+\)/i);
  return m ? m[0] : null;
}

/**
 * Assistant prose: app UI face (not the book face), 16px floor for iOS inputs nearby,
 * ~1.65 leading for mixed CJK/EN, measure capped when the panel is wide.
 */
const messageTypeClass = 'font-sans text-base leading-[1.65]';
const markdownBodyClass = clsx(
  'break-words [&_a]:break-all',
  // Inline code chip; fenced `pre code` resets below so the shell stays clean.
  '[&_code]:rounded [&_code]:bg-base-200/70 [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.9em]',
  '[&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:font-mono [&_pre_code]:text-[0.875em] [&_pre_code]:leading-relaxed',
  // Headings: descending scale, tighter leading, section gap above (not only below).
  '[&_h1]:mt-[1.15em] [&_h1]:mb-[0.4em] [&_h1]:text-balance [&_h1]:text-[1.2em] [&_h1]:leading-[1.25] [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:first:mt-0',
  '[&_h2]:mt-[1.05em] [&_h2]:mb-[0.35em] [&_h2]:text-balance [&_h2]:text-[1.1em] [&_h2]:leading-[1.3] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:first:mt-0',
  '[&_h3]:mt-[0.95em] [&_h3]:mb-[0.3em] [&_h3]:text-balance [&_h3]:text-[1.02em] [&_h3]:leading-[1.35] [&_h3]:font-semibold [&_h3]:first:mt-0',
  '[&_h4]:mt-[0.85em] [&_h4]:mb-[0.25em] [&_h4]:text-balance [&_h4]:text-[1em] [&_h4]:leading-[1.4] [&_h4]:font-semibold [&_h4]:first:mt-0',
  // Body rhythm: tighter than 0.9em so short AI paragraphs don't feel sparse.
  '[&_p]:my-[0.7em] [&_p]:text-pretty [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_strong]:font-semibold [&_em]:italic',
  // Lists denser than paragraphs; wrap at ≥1.4.
  '[&_ul]:my-[0.7em] [&_ul]:list-disc [&_ul]:ps-5',
  '[&_ol]:my-[0.7em] [&_ol]:list-decimal [&_ol]:ps-5',
  '[&_li]:my-[0.28em] [&_li]:ps-0.5 [&_li]:leading-[1.55]',
  '[&_ul_ul]:my-[0.25em] [&_ol_ol]:my-[0.25em] [&_ul_ol]:my-[0.25em] [&_ol_ul]:my-[0.25em]',
  // Tables
  '[&_th]:border-base-content/15 [&_th]:border-b [&_th]:bg-base-200/40 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-start [&_th]:font-semibold [&_th]:leading-snug',
  '[&_td]:border-base-content/10 [&_td]:border-b [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:leading-[1.45]',
  '[&_tr:last-child_td]:border-b-0',
);

/** T3: always-visible summary + Details expands params. */
function ToolTrace({ tools }: { tools: EveToolTrace[] }) {
  const _ = useTranslation();
  const [open, setOpen] = useState(false);
  if (!tools.length) return null;
  const summary = summarizeToolTrace(tools);
  return (
    <div className='text-base-content/60 mt-2 flex flex-col gap-1 font-sans text-[0.85em] leading-snug select-none'>
      <div className='flex items-baseline gap-1.5'>
        <span>{summary ? _(summary) : _('Tool activity')}</span>
        <button
          type='button'
          className={clsx('underline decoration-from-font underline-offset-2', focusRing)}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? _('Collapse') : _('Details')}
        </button>
      </div>
      {open ? (
        <div className='border-base-content/25 text-base-content/80 space-y-0.5 break-words border-s-2 ps-2 font-mono'>
          {tools.map((t) => (
            <div key={t.id}>
              <span className='font-semibold'>{t.name}</span>
              {t.args ? (
                <span className='text-base-content/60'> {JSON.stringify(t.args)}</span>
              ) : null}
              {t.result &&
              typeof t.result === 'object' &&
              t.result !== null &&
              'path' in t.result &&
              (t.result as { ok?: boolean }).ok ? (
                <span className='text-success'> → {(t.result as { path: string }).path}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** B1: stacked left-rule quotes inside the user bubble. */
function QuoteStack({ quotes }: { quotes: EveMessageQuote[] }) {
  if (!quotes.length) return null;
  return (
    <div className='mb-1.5 flex flex-col gap-1 pb-0.5'>
      {quotes.map((q) => {
        const chapter = q.chapterTitle?.trim();
        const full = chapter ? `${q.text} — 《${chapter}》` : q.text;
        return (
          <div
            key={`${chapter ?? ''}:${q.text}`}
            title={full}
            className='border-base-content/25 text-base-content/70 line-clamp-2 border-s-2 ps-1.5 text-[0.85em] leading-snug'
          >
            {q.text}
            {chapter ? <span className='text-base-content/50'> — 《{chapter}》</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/** Quiet wait cue while the assistant has no visible reply yet. */
function PendingReplyDots({ lookingUp }: { lookingUp: boolean }) {
  const _ = useTranslation();
  const label = lookingUp ? _('Looking up…') : _('Thinking…');
  return (
    <div
      className={clsx(
        messageTypeClass,
        'text-base-content/55 me-1 flex items-center gap-2 px-0.5 py-0.5',
      )}
      role='status'
    >
      <span className='font-sans text-[0.85em] leading-none'>{label}</span>
      <span className='assistant-pending-dots inline-flex items-center gap-1' aria-hidden='true'>
        <span className='bg-base-content size-1 rounded-full' />
        <span className='bg-base-content size-1 rounded-full' />
        <span className='bg-base-content size-1 rounded-full' />
      </span>
    </div>
  );
}

function ReasoningBlock({ reasoning }: { reasoning: string }) {
  const _ = useTranslation();
  const [open, setOpen] = useState(true);
  if (!reasoning.trim()) return null;
  return (
    <details
      className='group border-base-content/10 mb-3.5 border-s ps-3'
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary
        className={clsx(
          'text-base-content/50 hover:text-base-content/75 font-sans text-[0.8em] leading-none',
          'cursor-pointer list-none select-none',
          '[&::-webkit-details-marker]:hidden',
          focusRing,
        )}
      >
        {_('Thinking')}
      </summary>
      <pre
        className={clsx(
          'text-base-content/55 mt-2.5 max-h-56 overflow-y-auto overscroll-contain',
          'whitespace-pre-wrap font-sans text-[0.9em] leading-[1.6]',
        )}
      >
        {reasoning}
      </pre>
    </details>
  );
}

function CopyMessageButton({ content, workedMs }: { content: string; workedMs?: number }) {
  const _ = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await writeTextToClipboard(stripAssistantCfiCitations(content));
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const duration = workedMs != null && workedMs > 0 ? formatWorkDuration(workedMs) : null;

  return (
    <div className='text-base-content/40 mt-2 flex items-center gap-1.5 font-sans text-[0.8em] leading-none select-none'>
      <button
        type='button'
        className={clsx(
          'hover:text-base-content relative inline-flex size-6 items-center justify-center',
          'after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2',
          'transition-colors',
          focusRing,
        )}
        aria-label={copied ? _('Copied') : _('Copy')}
        onClick={() => {
          void handleCopy();
        }}
      >
        {copied ? (
          <CheckIcon size={12} aria-hidden='true' />
        ) : (
          <CopyIcon size={12} aria-hidden='true' />
        )}
      </button>
      {duration ? (
        <>
          <span className='text-base-content/25' aria-hidden='true'>
            ·
          </span>
          <span className='tabular-nums tracking-wide'>{duration}</span>
        </>
      ) : null}
    </div>
  );
}

function assistantWorkedMs(
  messages: EveMessage[],
  index: number,
  opts: { live: boolean },
): number | undefined {
  const msg = messages[index];
  if (!msg || msg.role !== 'assistant') return undefined;
  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = messages[i];
    if (prev?.role !== 'user') continue;
    const end = opts.live ? Date.now() : msg.createdAt;
    const ms = end - prev.createdAt;
    return ms > 0 ? ms : undefined;
  }
  return undefined;
}

function PendingQuoteBar({
  quotes,
  onRemove,
  onClear,
}: {
  quotes: PendingQuote[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const _ = useTranslation();
  if (!quotes.length) return null;
  return (
    <div className='border-base-200/70 flex shrink-0 flex-col gap-2 border-b px-3 py-2.5'>
      <div className='text-base-content/45 flex items-center justify-between text-[0.8em] leading-none select-none'>
        <span>
          {_('Pending quotes')} <span className='tabular-nums'>({quotes.length})</span>
        </span>
        <button
          type='button'
          className={clsx(
            'hover:text-base-content rounded-md px-1.5 py-1 hover:bg-base-200/60',
            focusRing,
          )}
          onClick={onClear}
        >
          {_('Clear all')}
        </button>
      </div>
      <ul className='flex flex-col gap-1.5'>
        {quotes.map((q) => {
          const full = q.chapterTitle ? `${q.text} · 《${q.chapterTitle}》` : q.text;
          return (
            <li
              key={q.id}
              className={clsx(
                'bg-base-100/55 eink-bordered border-base-200/70 flex items-start gap-1 rounded-md border',
                'py-1.5 ps-2 pe-1',
              )}
            >
              <span
                className='border-base-content/25 text-base-content/40 mt-px shrink-0 border-s-2 ps-2 select-none'
                aria-hidden='true'
              >
                ❝
              </span>
              <span
                className='text-base-content/80 line-clamp-2 min-w-0 flex-1 text-[0.85em] leading-snug select-text'
                title={full}
              >
                {q.text}
                {q.chapterTitle ? (
                  <span className='text-base-content/45'> · 《{q.chapterTitle}》</span>
                ) : null}
              </span>
              <button
                type='button'
                className={clsx(
                  'text-base-content/40 hover:text-base-content hover:bg-base-200/80',
                  'relative flex size-6 shrink-0 items-center justify-center rounded-full',
                  'after:absolute after:top-1/2 after:left-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2',
                  focusRing,
                )}
                aria-label={_('Remove quote')}
                onClick={() => onRemove(q.id)}
              >
                <XIcon size={13} aria-hidden='true' />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const ReadingAssistantChat = ({
  bookKey,
  bookId,
  bookTitle,
  isActive = true,
}: {
  bookKey: string;
  bookId: string;
  bookTitle: string;
  isActive?: boolean;
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const activeSessionId = useReadingAssistantStore((s) => s.activeSessionId);
  const activeBookId = useReadingAssistantStore((s) => s.activeBookId);
  const pendingQuotes = useReadingAssistantStore((s) => s.pendingQuotes);
  const setActiveSession = useReadingAssistantStore((s) => s.setActiveSession);
  const removePendingQuote = useReadingAssistantStore((s) => s.removePendingQuote);
  const clearPendingQuotes = useReadingAssistantStore((s) => s.clearPendingQuotes);
  const restorePendingQuotes = useReadingAssistantStore((s) => s.restorePendingQuotes);

  const sessionId = activeBookId === bookId ? activeSessionId : null;

  const modelConfig = mergeModelConfig(settings.modelConfig);
  const activeProfile = getActiveProfile(modelConfig);
  const thinkingMode = settings.thinkingMode === 'think' ? 'think' : 'fast';

  const agent = useEveAgent({
    bookId,
    bookTitle,
    sessionId,
    thinkingMode,
    getReaderState: () => {
      const progress = useReaderStore.getState().getProgress(bookKey);
      if (!progress?.location && !progress?.sectionLabel) return null;
      const sectionIndex =
        typeof progress.index === 'number' && Number.isFinite(progress.index) && progress.index >= 0
          ? Math.floor(progress.index)
          : undefined;
      return {
        ...(progress.sectionLabel ? { chapter: progress.sectionLabel } : {}),
        ...(progress.location ? { cfi: progress.location } : {}),
        ...(sectionIndex !== undefined ? { sectionIndex } : {}),
      };
    },
  });

  const [skills, setSkills] = useState<EveSkillSummary[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillsError, setSkillsError] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const slashQuery = getComposerSlashQuery(agent.composer);
  const slashOpen = slashQuery !== null && !slashDismissed;
  const slashMatches = slashOpen ? filterSkillsForSlash(skills, slashQuery) : [];
  const activeSlashIndex =
    slashMatches.length === 0 ? 0 : Math.min(slashIndex, slashMatches.length - 1);

  useEffect(() => {
    if (!isActive) return;
    composerRef.current?.focus({ preventScroll: true });
  }, [isActive]);

  useEffect(() => {
    if (!slashOpen) return;
    let cancelled = false;
    setSkillsLoaded(false);
    setSkillsError(false);
    void listEveSkills()
      .then((rows) => {
        if (cancelled) return;
        setSkills(rows);
        setSlashIndex(0);
        setSkillsError(false);
        setSkillsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSkills([]);
        setSlashIndex(0);
        setSkillsError(true);
        setSkillsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slashOpen]);

  const selectSlashSkill = useCallback(
    (skillId: string) => {
      agent.setComposer(applySlashSkillSelection(agent.composer, skillId));
      setSlashIndex(0);
    },
    [agent],
  );

  const prevAgentSessionIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const previousAgentSessionId = prevAgentSessionIdRef.current;
    prevAgentSessionIdRef.current = agent.sessionId;
    if (
      shouldPushAgentSessionToStore({
        agentSessionId: agent.sessionId,
        previousAgentSessionId,
        storeSessionId: activeSessionId,
        storeBookId: activeBookId,
        bookId,
      })
    ) {
      setActiveSession(agent.sessionId, bookId);
    }
  }, [agent.sessionId, activeSessionId, activeBookId, bookId, setActiveSession]);

  // Book switch while quotes remain from another book (panel may keep store alive).
  useEffect(() => {
    const state = useReadingAssistantStore.getState();
    if (state.pendingQuotes.length > 0 && state.activeBookId && state.activeBookId !== bookId) {
      state.clearPendingQuotes();
    }
  }, [bookId]);

  const busy = agent.status === 'submitted' || agent.status === 'streaming';
  const canSend = Boolean(agent.composer.trim()) && !busy;
  const showPendingReply = shouldShowPendingReply(busy, agent.messages);
  const lookingUp = showPendingReply && agent.inFlightTools.length > 0;

  const handleSend = useCallback(() => {
    if (!agent.composer.trim() || busy) return;
    const quotes = useReadingAssistantStore.getState().pendingQuotes;
    clearPendingQuotes();
    void agent.send({
      quotes,
      onSendFailed: restorePendingQuotes,
    });
  }, [agent, busy, clearPendingQuotes, restorePendingQuotes]);

  const handleSelectThinkingMode = useCallback(
    (mode: 'think' | 'fast') => {
      if (mode === thinkingMode) return;
      void saveSysSettings(envConfig, 'thinkingMode', mode);
    },
    [envConfig, thinkingMode],
  );

  const handleSelectProfile = useCallback(
    async (profileId: string) => {
      if (busy) return;
      const previousActiveId = modelConfig.activeProfileId;
      const next = setActiveProfile(modelConfig, profileId);
      if (next === modelConfig) return;

      const updated = { ...settings, modelConfig: next };
      setSettings(updated);
      await saveSettings(envConfig, updated);

      if (
        shouldHotReloadEve({
          previousActiveId,
          nextActiveId: next.activeProfileId,
          editedProfileId: null,
        })
      ) {
        const active = getActiveProfile(next);
        if (active) {
          const apiKey = await getModelApiKey(active.id);
          const payload = toSidecarModelPayload(next);
          if (payload) {
            await reloadEveSidecar({ ...payload, apiKey });
          }
        } else {
          await reloadEveSidecar({ enabled: next.enabled });
        }
      }
      await useEveConnectionStore.getState().refresh();
    },
    [busy, envConfig, modelConfig, saveSettings, setSettings, settings],
  );

  return (
    <div className='flex h-full min-h-0 flex-col overscroll-contain'>
      <PendingQuoteBar
        quotes={pendingQuotes}
        onRemove={removePendingQuote}
        onClear={clearPendingQuotes}
      />
      <div className='min-h-0 flex-1 space-y-8 overflow-y-auto overscroll-contain px-4 py-5 touch-pan-y'>
        {agent.messages.length === 0 && !showPendingReply && !agent.error ? (
          <div className='text-base-content/60 flex h-full min-h-40 flex-col justify-center gap-1.5 py-6 text-pretty leading-relaxed'>
            <p className='text-base-content/80 font-medium'>{_('Ask about this book')}</p>
            <p className='text-[0.92em]'>
              {_('Select a passage and choose Ask, or type a question below.')}
            </p>
          </div>
        ) : null}
        {agent.messages.map((msg, index) => {
          const isLiveAssistant =
            busy && msg.role === 'assistant' && index === agent.messages.length - 1;
          const workedMs =
            msg.role === 'assistant' && (msg.content.trim() || msg.reasoning?.trim())
              ? assistantWorkedMs(agent.messages, index, { live: isLiveAssistant })
              : undefined;
          return (
            <div
              key={msg.id}
              className={clsx(
                messageTypeClass,
                msg.role === 'user'
                  ? 'bg-base-100/70 ms-5 select-text rounded-xl px-3.5 py-3 break-words whitespace-pre-wrap'
                  : 'me-1 max-w-[65ch] select-text px-0.5 py-0.5',
              )}
            >
              {msg.role === 'user' && msg.quotes?.length ? (
                <QuoteStack quotes={msg.quotes} />
              ) : null}
              {msg.role === 'assistant' ? (
                <div className={markdownBodyClass}>
                  {msg.reasoning?.trim() ? <ReasoningBlock reasoning={msg.reasoning} /> : null}
                  {msg.content.trim() ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={createAssistantMarkdownComponents({
                        bookKey,
                        sources: msg.sources,
                        passageLabel: _('Passage'),
                      })}
                    >
                      {linkifyBareEpubCfi(msg.content, msg.sources, _('Passage'))}
                    </ReactMarkdown>
                  ) : null}
                </div>
              ) : (
                <div>{msg.content}</div>
              )}
              {msg.role === 'assistant' && msg.tools?.length ? (
                <ToolTrace tools={msg.tools} />
              ) : null}
              {msg.role === 'assistant' && msg.content.trim() ? (
                <CopyMessageButton content={msg.content} workedMs={workedMs} />
              ) : null}
            </div>
          );
        })}
        {showPendingReply ? <PendingReplyDots lookingUp={lookingUp} /> : null}
        {agent.error ? (
          <p className={clsx('text-error select-text text-pretty', messageTypeClass)} role='alert'>
            {agent.error.message}
          </p>
        ) : null}
      </div>
      <form
        className='shrink-0 px-2.5 pb-2.5 pt-1'
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <div className='bg-base-100 eink-bordered focus-within:ring-base-content/15 relative flex flex-col rounded-xl focus-within:ring-2'>
          {slashOpen ? (
            <div
              className={clsx(
                'border-base-200/70 bg-base-100 absolute inset-x-0 bottom-full z-10 mb-1 overflow-hidden',
                'eink-bordered rounded-[10px] border p-1 shadow-[0_1px_2px_oklch(0_0_0/0.06),0_4px_14px_oklch(0_0_0/0.08)]',
              )}
              role='listbox'
              aria-label={_('Skills')}
            >
              {!skillsLoaded ? (
                <div className='text-base-content/45 flex items-center gap-2 px-2 py-1.5 font-sans text-[0.85em]'>
                  <Loader2Icon size={14} className='animate-spin opacity-60' aria-hidden='true' />
                  {_('Loading skills…')}
                </div>
              ) : skillsError ? (
                <div className='text-base-content/45 px-2 py-1.5 font-sans text-[0.85em]'>
                  {_('Could not load skills')}
                </div>
              ) : skills.length === 0 ? (
                <div className='text-base-content/45 px-2 py-1.5 font-sans text-[0.85em]'>
                  {_('No skills yet')}
                </div>
              ) : slashMatches.length === 0 ? (
                <div className='text-base-content/45 px-2 py-1.5 font-sans text-[0.85em]'>
                  {_('No matching skills')}
                </div>
              ) : (
                <ul className='max-h-48 overflow-y-auto overscroll-contain'>
                  {slashMatches.map((skill, index) => {
                    const active = index === activeSlashIndex;
                    return (
                      <li
                        key={skill.id}
                        role='option'
                        aria-selected={active}
                        tabIndex={0}
                        className={clsx(
                          composerSelectItem,
                          focusRing,
                          active && composerSelectItemActive,
                        )}
                        onMouseEnter={() => setSlashIndex(index)}
                        onClick={() => selectSlashSkill(skill.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            selectSlashSkill(skill.id);
                          }
                        }}
                      >
                        <span className='min-w-0 flex-1 text-start'>
                          <span className='text-base-content block truncate font-medium'>
                            {`/${SKILL_SLASH_PREFIX}${skill.id}`}
                          </span>
                          <span className='text-base-content/50 block truncate text-[0.85em] leading-snug'>
                            {skill.description || skill.name}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
          <textarea
            ref={composerRef}
            name='assistant-message'
            aria-label={_('Message')}
            autoComplete='off'
            spellCheck
            className={clsx(
              'min-h-[48px] w-full resize-none bg-transparent px-3.5 py-2.5 outline-none',
              messageTypeClass,
            )}
            value={agent.composer}
            onChange={(e) => {
              setSlashDismissed(false);
              setSlashIndex(0);
              agent.setComposer(e.target.value);
            }}
            rows={2}
            onKeyDown={(e) => {
              if (slashOpen) {
                if (!skillsLoaded) {
                  if (
                    (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) ||
                    e.key === 'Tab' ||
                    e.key === 'ArrowDown' ||
                    e.key === 'ArrowUp'
                  ) {
                    e.preventDefault();
                    return;
                  }
                } else if (slashMatches.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSlashIndex((i) => (i + 1) % slashMatches.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
                    return;
                  }
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    const skill = slashMatches[activeSlashIndex];
                    if (skill) selectSlashSkill(skill.id);
                    return;
                  }
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    const skill = slashMatches[activeSlashIndex];
                    if (skill) selectSlashSkill(skill.id);
                    return;
                  }
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setSlashDismissed(true);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                // Busy: keep typing (soft keyboard stays open); only block submit.
                if (busy) return;
                handleSend();
              }
            }}
          />
          <div className='flex items-center gap-0.5 px-2 pb-2 pt-0.5 font-sans text-sm select-none touch-manipulation'>
            <div
              className={clsx('dropdown dropdown-top', busy && 'pointer-events-none opacity-50')}
            >
              <button
                type='button'
                tabIndex={0}
                className={clsx(composerSelectTrigger, 'max-w-[9.5rem]', focusRing)}
                disabled={busy}
                aria-label={_('Model')}
                aria-haspopup='listbox'
                onClick={(e) => e.currentTarget.focus()}
              >
                <span className='truncate' translate='no'>
                  {activeProfile?.modelId ?? _('Model')}
                </span>
                <ChevronUpIcon size={12} className='shrink-0 opacity-40' aria-hidden='true' />
              </button>
              <ul
                tabIndex={0}
                role='listbox'
                className={clsx(composerSelectMenu, 'max-h-48 min-w-[10rem]')}
              >
                {modelConfig.profiles.map((profile) => {
                  const isActive = profile.id === modelConfig.activeProfileId;
                  return (
                    <li
                      key={profile.id}
                      role='option'
                      aria-selected={isActive}
                      tabIndex={0}
                      className={clsx(
                        composerSelectItem,
                        focusRing,
                        isActive && composerSelectItemActive,
                      )}
                      onClick={() => {
                        void handleSelectProfile(profile.id);
                        (document.activeElement as HTMLElement | null)?.blur();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void handleSelectProfile(profile.id);
                          (document.activeElement as HTMLElement | null)?.blur();
                        }
                      }}
                    >
                      <ComposerSelectCheck active={isActive} />
                      <span className='min-w-0 flex-1 truncate' translate='no'>
                        {profile.modelId}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div
              className={clsx('dropdown dropdown-top', busy && 'pointer-events-none opacity-50')}
            >
              <button
                type='button'
                tabIndex={0}
                className={clsx(composerSelectTrigger, focusRing)}
                disabled={busy}
                aria-label={thinkingMode === 'think' ? _('Think') : _('Fast')}
                aria-haspopup='listbox'
                onClick={(e) => e.currentTarget.focus()}
              >
                <span className='truncate'>
                  {thinkingMode === 'think' ? _('Think') : _('Fast')}
                </span>
                <ChevronUpIcon size={12} className='shrink-0 opacity-40' aria-hidden='true' />
              </button>
              <ul
                tabIndex={0}
                role='listbox'
                className={clsx(composerSelectMenu, 'min-w-[7.5rem]')}
              >
                {(
                  [
                    { id: 'think' as const, label: _('Think') },
                    { id: 'fast' as const, label: _('Fast') },
                  ] as const
                ).map((option) => {
                  const isActive = option.id === thinkingMode;
                  return (
                    <li
                      key={option.id}
                      role='option'
                      aria-selected={isActive}
                      tabIndex={0}
                      className={clsx(
                        composerSelectItem,
                        focusRing,
                        isActive && composerSelectItemActive,
                      )}
                      onClick={() => {
                        handleSelectThinkingMode(option.id);
                        (document.activeElement as HTMLElement | null)?.blur();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelectThinkingMode(option.id);
                          (document.activeElement as HTMLElement | null)?.blur();
                        }
                      }}
                    >
                      <ComposerSelectCheck active={isActive} />
                      <span className='min-w-0 flex-1 truncate'>{option.label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <button
              type={busy ? 'button' : 'submit'}
              className={clsx(
                composerPrimaryBtn,
                busy || canSend ? composerPrimaryBtnLive : composerPrimaryBtnIdle,
                focusRing,
              )}
              aria-label={busy ? _('Stop') : _('Send')}
              disabled={!busy && !canSend}
              onClick={
                busy
                  ? (e) => {
                      e.preventDefault();
                      agent.stop();
                    }
                  : undefined
              }
            >
              {busy ? (
                <span className='bg-base-100 block size-[9px] rounded-[2px]' aria-hidden='true' />
              ) : (
                <ArrowUpIcon size={14} strokeWidth={2.25} aria-hidden='true' />
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

const AIAssistant = ({ bookKey, isActive = true }: AIAssistantProps) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings, setSettingsDialogBookKey, setSettingsDialogOpen, setActiveSettingsItemId } =
    useSettingsStore();
  const { getBookData } = useBookDataStore();
  const bookData = getBookData(bookKey);
  const ready = useEveConnectionStore((s) => s.ready);
  // Saving a key reloads the sidecar and refreshes this store; re-check keychain then.
  const info = useEveConnectionStore((s) => s.info);
  const [hasKey, setHasKey] = useState(false);

  const modelConfig = settings?.modelConfig;
  const activeProfileId = modelConfig
    ? (getActiveProfile(mergeModelConfig(modelConfig))?.id ?? null)
    : null;

  useEffect(() => {
    let cancelled = false;
    if (!appService || !activeProfileId) {
      setHasKey(false);
      return;
    }
    void getModelApiKey(activeProfileId).then((key) => {
      if (!cancelled) setHasKey(Boolean(key?.trim()));
    });
    return () => {
      cancelled = true;
    };
  }, [appService, activeProfileId, ready, info]);

  const available = isReadingAssistantAvailable({
    modelEnabled: modelConfig?.enabled ?? false,
    sidecarReady: ready,
    hasActiveProfile: Boolean(activeProfileId),
    hasApiKey: hasKey,
  });

  const bookId = bookData?.book?.hash || '';
  const bookTitle = bookData?.book?.title || '';

  const openAISettings = useCallback(() => {
    setSettingsDialogBookKey(bookKey);
    setActiveSettingsItemId('settings.ai.enableAssistant');
    setSettingsDialogOpen(true);
  }, [bookKey, setActiveSettingsItemId, setSettingsDialogBookKey, setSettingsDialogOpen]);

  if (!available) {
    return (
      <div className='text-base-content/70 flex h-full flex-col items-center justify-center gap-3 p-4 text-center leading-relaxed'>
        {!ready ? (
          <Loader2Icon
            className='animate-spin select-none motion-reduce:animate-none'
            size={20}
            aria-hidden='true'
          />
        ) : null}
        <p className='select-text text-pretty' aria-live='polite'>
          {ready
            ? _('Enable Reading Assistant in Settings and add an API key.')
            : _('Starting the local Reading Assistant…')}
        </p>
        {ready ? (
          <button
            type='button'
            className={clsx(
              'btn btn-contrast h-9 min-h-0 rounded-lg px-4 text-sm font-medium',
              focusRing,
            )}
            onClick={openAISettings}
          >
            {_('Open AI settings')}
          </button>
        ) : null}
      </div>
    );
  }

  if (!bookId) {
    return (
      <div className='text-base-content/70 flex h-full items-center justify-center p-4 select-text text-pretty leading-relaxed'>
        {_('Open a book to chat with the Reading Assistant.')}
      </div>
    );
  }

  // Key only on bookId — not activeSessionId. First send creates a session and
  // writes it to the store; a sessionId key remount would drop the in-flight stream.
  // Session switches (History / New chat) are handled by useEveAgent's load effect.
  return (
    <ReadingAssistantChat
      key={bookId}
      bookKey={bookKey}
      bookId={bookId}
      bookTitle={bookTitle}
      isActive={isActive}
    />
  );
};

export default AIAssistant;
