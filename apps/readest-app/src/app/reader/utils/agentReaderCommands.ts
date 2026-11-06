/**
 * Run reader commands sent by an external agent over MCP (see
 * apps/eve-sidecar/src/server/readerCommands.mjs). Each command does what the
 * reader's own action does: highlights / notes / bookmarks are ordinary
 * BookNote records saved through the book config, so they show on the page,
 * in the notes list, in exports and sync exactly like the reader's.
 */

import * as CFI from 'foliate-js/epubcfi.js';
import type { BookNote, HighlightColor, HighlightStyle } from '@/types/book';
import type { FoliateView } from '@/types/view';
import { getIndexFromCfi } from '@/utils/cfi';
import { uniqueId } from '@/utils/misc';
import { locatePassage } from '@/services/wellread/agent/locatePassage';
import { removeBookNoteOverlays } from './annotatorUtil';
import { removeGlobalAnnotationOverlays } from './globalAnnotations';

export type AgentReaderCommand = { id: string; type: string; args: Record<string, unknown> };
export type AgentReaderResult = { ok: boolean } & Record<string, unknown>;

type ReaderView = Pick<
  FoliateView,
  | 'getCFI'
  | 'resolveCFI'
  | 'goTo'
  | 'next'
  | 'prev'
  | 'book'
  | 'renderer'
  | 'lastLocation'
  | 'isFixedLayout'
  | 'addAnnotation'
>;

export interface AgentReaderDeps {
  view: ReaderView;
  /** Every open view of this book (split panes), for overlay cleanup. */
  views: () => Array<FoliateView | null>;
  getBooknotes: () => BookNote[];
  /** Persist through updateBooknotes + saveConfig; the Annotator redraws from it. */
  saveBooknotes: (notes: BookNote[]) => void;
  /** The reader's default style and its color. */
  highlightDefaults: (style?: HighlightStyle) => { style: HighlightStyle; color: HighlightColor };
  chapterTitle: (sectionIndex: number) => string | null;
  now?: () => number;
}

const fail = (error: string, message: string): AgentReaderResult => ({ ok: false, error, message });

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);

function chapterOf(deps: AgentReaderDeps, cfi: string | undefined) {
  const index = cfi ? getIndexFromCfi(cfi) : null;
  return index === null ? null : deps.chapterTitle(index);
}

function position(deps: AgentReaderDeps) {
  const cfi = deps.view.lastLocation?.cfi;
  return { cfi: cfi ?? null, chapter: chapterOf(deps, cfi) };
}

async function sectionDoc(view: ReaderView, index: number): Promise<Document | null> {
  const rendered = view.renderer.getContents().find((c) => c.index === index)?.doc;
  if (rendered) return rendered;
  return (await view.book.sections[index]?.createDocument()) ?? null;
}

type Passage = { cfi: string; text: string; sectionIndex: number };

/**
 * Locate quoted text: in sectionIndex, else the section holding `cfi`, else
 * the current section and then the rest of the book.
 */
async function resolvePassage(
  deps: AgentReaderDeps,
  args: Record<string, unknown>,
): Promise<Passage | AgentReaderResult> {
  const { view } = deps;
  const text = str(args['text'])!;
  if (view.isFixedLayout) {
    return fail(
      'unsupported_format',
      'Finding text is not supported in fixed-layout books (PDF, comics).',
    );
  }
  const anchorCfi = str(args['cfi']);
  let anchor: ((doc: Document) => Range) | null = null;
  let pinned = int(args['sectionIndex']);
  if (pinned === undefined && anchorCfi) {
    try {
      const resolved = view.resolveCFI(anchorCfi);
      pinned = resolved.index;
      anchor = resolved.anchor;
    } catch {
      return fail('invalid_cfi', `Could not resolve cfi ${anchorCfi}`);
    }
  }
  const current = getIndexFromCfi(view.lastLocation?.cfi ?? '') ?? view.renderer.primaryIndex ?? 0;
  const order =
    pinned !== undefined
      ? [pinned]
      : [current, ...view.book.sections.map((_, i) => i).filter((i) => i !== current)];

  for (const index of order) {
    const doc = await sectionDoc(view, index);
    if (!doc) continue;
    let anchorRange: Range | null = null;
    try {
      anchorRange = anchor ? anchor(doc) : null;
    } catch {
      anchorRange = null;
    }
    const range = locatePassage(doc, text, anchorRange);
    if (range)
      return { cfi: view.getCFI(index, range), text: range.toString(), sectionIndex: index };
  }
  return fail(
    'not_found',
    pinned !== undefined
      ? 'That passage is not in the given section. Quote it exactly as the book prints it.'
      : 'That passage is not in this book. Quote it exactly as the book prints it.',
  );
}

const isFailure = (r: Passage | AgentReaderResult): r is AgentReaderResult => 'ok' in r;

function describe(deps: AgentReaderDeps, note: BookNote) {
  return {
    id: note.id,
    type: note.type,
    cfi: note.cfi,
    chapter: chapterOf(deps, note.cfi),
    ...(note.text ? { text: note.text } : {}),
    ...(note.note ? { note: note.note } : {}),
    ...(note.style ? { style: note.style, color: note.color } : {}),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function compareCfi(a: string, b: string): number {
  try {
    return CFI.compare(a, b);
  } catch {
    return a.localeCompare(b);
  }
}

function clearOverlays(deps: AgentReaderDeps, note: BookNote) {
  for (const v of deps.views()) {
    removeBookNoteOverlays(v, note);
    if (note.global && v) removeGlobalAnnotationOverlays(v, note);
  }
}

export async function runAgentReaderCommand(
  deps: AgentReaderDeps,
  command: AgentReaderCommand,
): Promise<AgentReaderResult> {
  const { view, args } = { view: deps.view, args: command.args ?? {} };
  const now = deps.now ?? Date.now;
  const live = () => deps.getBooknotes().filter((n) => !n.deletedAt);

  switch (command.type) {
    case 'open_in_reader': {
      let target: string | number | undefined;
      let passage: Passage | undefined;
      if (str(args['text'])) {
        const found = await resolvePassage(deps, args);
        if (isFailure(found)) return found;
        passage = found;
        target = found.cfi;
      } else {
        target = str(args['cfi']) ?? int(args['sectionIndex']);
      }
      if (target === undefined) return fail('invalid_args', 'give text, cfi or sectionIndex');
      if (typeof target === 'number' && !view.book.sections[target]) {
        return fail('not_found', `No section ${target} in this book.`);
      }
      // FoliateView.goTo takes a cfi, href or section index.
      await view.goTo(target as string);
      return { ok: true, ...(passage ? { text: passage.text } : {}), position: position(deps) };
    }

    case 'turn_page': {
      const pages = int(args['pages']) ?? 1;
      for (let i = 0; i < pages; i++) {
        await (args['direction'] === 'prev' ? view.prev() : view.next());
      }
      return { ok: true, position: position(deps) };
    }

    case 'highlight': {
      const found = await resolvePassage(deps, args);
      if (isFailure(found)) return found;
      const defaults = deps.highlightDefaults(str(args['style']) as HighlightStyle | undefined);
      const style = (str(args['style']) as HighlightStyle | undefined) ?? defaults.style;
      const color = (str(args['color']) as HighlightColor | undefined) ?? defaults.color;
      const note = typeof args['note'] === 'string' ? args['note'] : undefined;
      const notes = deps.getBooknotes();
      const existing = notes.find(
        (n) => n.type === 'annotation' && !n.deletedAt && n.cfi === found.cfi,
      );
      if (existing) {
        // Same passage already marked: restyle / re-note it in place.
        clearOverlays(deps, existing);
        const updated: BookNote = {
          ...existing,
          style,
          color,
          ...(note !== undefined ? { note } : {}),
          updatedAt: now(),
        };
        deps.saveBooknotes(notes.map((n) => (n === existing ? updated : n)));
        return { ok: true, updatedExisting: true, annotation: describe(deps, updated) };
      }
      const created: BookNote = {
        id: uniqueId(),
        type: 'annotation',
        cfi: found.cfi,
        style,
        color,
        text: found.text,
        note: note ?? '',
        createdAt: now(),
        updatedAt: now(),
      };
      deps.saveBooknotes([...notes, created]);
      return { ok: true, annotation: describe(deps, created) };
    }

    case 'add_bookmark': {
      let cfi = view.lastLocation?.cfi;
      let text = view.lastLocation?.range?.toString().trim().slice(0, 128) ?? '';
      if (str(args['text'])) {
        const found = await resolvePassage(deps, args);
        if (isFailure(found)) return found;
        cfi = found.cfi;
        text = found.text.slice(0, 128);
      } else if (str(args['cfi'])) {
        cfi = str(args['cfi']);
        text = '';
      }
      if (!cfi) return fail('no_position', 'The reader has no position yet.');
      const notes = deps.getBooknotes();
      const existing = notes.find((n) => n.type === 'bookmark' && n.cfi === cfi);
      const bookmark: BookNote = existing
        ? { ...existing, deletedAt: null, updatedAt: now() }
        : {
            id: uniqueId(),
            type: 'bookmark',
            cfi,
            text,
            note: '',
            createdAt: now(),
            updatedAt: now(),
          };
      deps.saveBooknotes(
        existing ? notes.map((n) => (n === existing ? bookmark : n)) : [...notes, bookmark],
      );
      return { ok: true, bookmark: describe(deps, bookmark) };
    }

    case 'list_annotations': {
      const type = str(args['type']);
      const limit = int(args['limit']) ?? 200;
      const all = live()
        .filter((n) => !type || n.type === type)
        .sort((a, b) => compareCfi(a.cfi, b.cfi));
      return {
        ok: true,
        total: all.length,
        annotations: all.slice(0, limit).map((n) => describe(deps, n)),
      };
    }

    case 'update_annotation': {
      const notes = deps.getBooknotes();
      const target = notes.find((n) => n.id === args['id'] && !n.deletedAt);
      if (!target)
        return fail('not_found', `No highlight, note or bookmark with id ${String(args['id'])}.`);
      clearOverlays(deps, target);
      const updated: BookNote = {
        ...target,
        ...(typeof args['note'] === 'string' ? { note: args['note'] } : {}),
        ...(target.type === 'annotation' && str(args['style'])
          ? { style: args['style'] as HighlightStyle }
          : {}),
        ...(target.type === 'annotation' && str(args['color'])
          ? { color: args['color'] as HighlightColor }
          : {}),
        updatedAt: now(),
      };
      deps.saveBooknotes(notes.map((n) => (n === target ? updated : n)));
      return { ok: true, annotation: describe(deps, updated) };
    }

    case 'delete_annotation': {
      const notes = deps.getBooknotes();
      const target = notes.find((n) => n.id === args['id'] && !n.deletedAt);
      if (!target)
        return fail('not_found', `No highlight, note or bookmark with id ${String(args['id'])}.`);
      clearOverlays(deps, target);
      deps.saveBooknotes(
        notes.map((n) => (n === target ? { ...n, deletedAt: now(), updatedAt: now() } : n)),
      );
      return { ok: true, deleted: describe(deps, target) };
    }

    default:
      return fail('unknown_command', `Unknown reader command ${command.type}`);
  }
}
