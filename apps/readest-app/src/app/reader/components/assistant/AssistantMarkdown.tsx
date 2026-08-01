'use client';

import { isValidElement, type ReactElement, type ReactNode } from 'react';
import clsx from 'clsx';
import type { Components } from 'react-markdown';

import { useReaderStore } from '@/store/readerStore';
import { eventDispatcher } from '@/utils/event';
import type { SessionSource } from '@wellread/eve-message';
import {
  isExternalHttpHref,
  normalizeEpubCfi,
  resolveEveSource,
} from '@/services/wellread/assistant/cfiLinks';
import { openExternalUrl } from '@/utils/open';

export const focusRing =
  'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2';

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

function MarkdownRule() {
  return <div className='my-[0.75em]' aria-hidden='true' />;
}

function languageFromClassName(className?: string): string | null {
  if (!className) return null;
  const m = /(?:^|\s)language-([\w#+.-]+)/.exec(className);
  return m?.[1] ?? null;
}

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

export function createAssistantMarkdownComponents(opts: {
  bookKey: string;
  sources?: SessionSource[];
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
      if (className) return <code className={className}>{children}</code>;
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
      if (!isExternalHttpHref(href)) return <span>{children}</span>;
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

export const messageTypeClass = 'font-sans text-base leading-[1.65]';
export const markdownBodyClass = clsx(
  'break-words [&_a]:break-all',
  '[&_code]:rounded [&_code]:bg-base-200/70 [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.9em]',
  '[&_pre_code]:rounded-none [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:font-mono [&_pre_code]:text-[0.875em] [&_pre_code]:leading-relaxed',
  '[&_h1]:mt-[1.15em] [&_h1]:mb-[0.4em] [&_h1]:text-balance [&_h1]:text-[1.2em] [&_h1]:leading-[1.25] [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:first:mt-0',
  '[&_h2]:mt-[1.05em] [&_h2]:mb-[0.35em] [&_h2]:text-balance [&_h2]:text-[1.1em] [&_h2]:leading-[1.3] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:first:mt-0',
  '[&_h3]:mt-[0.95em] [&_h3]:mb-[0.3em] [&_h3]:text-balance [&_h3]:text-[1.02em] [&_h3]:leading-[1.35] [&_h3]:font-semibold [&_h3]:tracking-tight [&_h3]:first:mt-0',
  '[&_h4]:mt-[0.85em] [&_h4]:mb-[0.25em] [&_h4]:text-balance [&_h4]:text-[1em] [&_h4]:leading-[1.4] [&_h4]:font-semibold [&_h4]:first:mt-0',
  '[&_p]:my-[0.7em] [&_p]:text-pretty [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_strong]:font-semibold [&_em]:italic',
  '[&_ul]:my-[0.7em] [&_ul]:list-disc [&_ul]:ps-5',
  '[&_ol]:my-[0.7em] [&_ol]:list-decimal [&_ol]:ps-5',
  '[&_li]:my-[0.28em] [&_li]:ps-0.5 [&_li]:leading-[1.55]',
  '[&_ul_ul]:my-[0.25em] [&_ol_ol]:my-[0.25em] [&_ul_ol]:my-[0.25em] [&_ol_ul]:my-[0.25em]',
  '[&_th]:border-base-content/15 [&_th]:border-b [&_th]:bg-base-200/40 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-start [&_th]:font-semibold [&_th]:leading-snug',
  '[&_td]:border-base-content/10 [&_td]:border-b [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:leading-[1.45]',
  '[&_tr:last-child_td]:border-b-0',
);
