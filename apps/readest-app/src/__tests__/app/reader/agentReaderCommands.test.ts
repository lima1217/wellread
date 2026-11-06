import { describe, expect, it, vi } from 'vitest';
import type { BookNote } from '@/types/book';
import type { FoliateView } from '@/types/view';
import {
  runAgentReaderCommand,
  type AgentReaderDeps,
} from '@/app/reader/utils/agentReaderCommands';

function sectionDoc(html: string): Document {
  return new DOMParser().parseFromString(`<html><body>${html}</body></html>`, 'text/html');
}

function setup(initial: BookNote[] = []) {
  const docs = [
    sectionDoc('<p>Call me <em>Ishmael</em>. Some years ago.</p>'),
    sectionDoc('<p>The whale sinks the ship.</p><p>Only Ishmael survives.</p>'),
  ];
  let notes = initial;
  const view = {
    isFixedLayout: false,
    lastLocation: { cfi: 'epubcfi(/6/2!/4/2/1:0)' },
    book: { sections: docs.map((d) => ({ createDocument: async () => d })) },
    // Section 0 is on screen; section 1 is only reachable via createDocument.
    renderer: { primaryIndex: 0, getContents: () => [{ doc: docs[0]!, index: 0 }] },
    getCFI: (index: number, range: Range) => `epubcfi(/6/${(index + 1) * 2}!${range.toString()})`,
    resolveCFI: (cfi: string) => ({
      index: cfi.startsWith('epubcfi(/6/4') ? 1 : 0,
      anchor: (doc: Document) => {
        const r = doc.createRange();
        r.setStart(doc.body, 0);
        return r;
      },
    }),
    goTo: vi.fn(async () => {}),
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    addAnnotation: vi.fn(() => ({ index: 0, label: '' })),
  };
  const deps: AgentReaderDeps = {
    view: view as unknown as AgentReaderDeps['view'],
    views: () => [view as unknown as FoliateView],
    getBooknotes: () => notes,
    saveBooknotes: (next) => {
      notes = next;
    },
    highlightDefaults: (style) => ({ style: style ?? 'highlight', color: 'yellow' }),
    chapterTitle: (i) => ['Loomings', 'Epilogue'][i] ?? null,
    now: () => 1000,
  };
  const run = (type: string, args: Record<string, unknown> = {}) =>
    runAgentReaderCommand(deps, { id: 'c1', type, args });
  return { view, run, notes: () => notes };
}

describe('runAgentReaderCommand', () => {
  it('highlights a passage with a note as an ordinary annotation', async () => {
    const t = setup();
    const res = await t.run('highlight', {
      text: 'me Ishmael. Some',
      note: 'narrator',
      color: 'blue',
    });
    expect(res.ok).toBe(true);
    expect(t.notes()).toHaveLength(1);
    expect(t.notes()[0]).toMatchObject({
      type: 'annotation',
      cfi: 'epubcfi(/6/2!me Ishmael. Some)',
      text: 'me Ishmael. Some',
      note: 'narrator',
      color: 'blue',
      style: 'highlight',
    });
    expect(res['annotation']).toMatchObject({ chapter: 'Loomings', note: 'narrator' });
  });

  it('searches the rest of the book when the passage is not on the current section', async () => {
    const t = setup();
    const res = await t.run('highlight', { text: 'Only Ishmael survives' });
    expect(res.ok).toBe(true);
    expect(t.notes()[0]!.cfi).toBe('epubcfi(/6/4!Only Ishmael survives)');
  });

  it('restricts the search to the section of a given cfi and reports misses', async () => {
    const t = setup();
    const miss = await t.run('highlight', { text: 'Call me', cfi: 'epubcfi(/6/4!/4/2)' });
    expect(miss).toMatchObject({ ok: false, error: 'not_found' });
    expect(t.notes()).toHaveLength(0);
  });

  it('re-notes an existing highlight on the same passage instead of duplicating it', async () => {
    const t = setup();
    await t.run('highlight', { text: 'Ishmael' });
    const again = await t.run('highlight', { text: 'Ishmael', note: 'second look' });
    expect(again['updatedExisting']).toBe(true);
    expect(t.notes()).toHaveLength(1);
    expect(t.notes()[0]!.note).toBe('second look');
  });

  it('lists, updates and deletes annotations by id', async () => {
    const t = setup();
    await t.run('highlight', { text: 'Only Ishmael survives' });
    await t.run('highlight', { text: 'Call me' });
    const list = await t.run('list_annotations');
    const items = list['annotations'] as Array<{ id: string; text: string }>;
    expect(items.map((a) => a.text)).toEqual(['Call me', 'Only Ishmael survives']); // book order

    const id = items[0]!.id;
    const upd = await t.run('update_annotation', { id, note: 'opening line', color: 'red' });
    expect(upd.ok).toBe(true);
    expect(t.notes().find((n) => n.id === id)).toMatchObject({
      note: 'opening line',
      color: 'red',
    });

    const del = await t.run('delete_annotation', { id });
    expect(del.ok).toBe(true);
    expect(t.notes().find((n) => n.id === id)?.deletedAt).toBe(1000);
    expect(t.view.addAnnotation).toHaveBeenCalled(); // old overlays torn down
    expect((await t.run('list_annotations'))['total']).toBe(1);
    expect(await t.run('delete_annotation', { id })).toMatchObject({ error: 'not_found' });
  });

  it('bookmarks the current page or a passage', async () => {
    const t = setup();
    const here = await t.run('add_bookmark');
    expect(here.ok).toBe(true);
    const there = await t.run('add_bookmark', { text: 'The whale' });
    expect(there.ok).toBe(true);
    expect(t.notes().map((n) => [n.type, n.cfi])).toEqual([
      ['bookmark', 'epubcfi(/6/2!/4/2/1:0)'],
      ['bookmark', 'epubcfi(/6/4!The whale)'],
    ]);
  });

  it('navigates to a passage, a cfi or a section and turns pages', async () => {
    const t = setup();
    const opened = await t.run('open_in_reader', { text: 'The whale sinks' });
    expect(opened.ok).toBe(true);
    expect(t.view.goTo).toHaveBeenLastCalledWith('epubcfi(/6/4!The whale sinks)');
    await t.run('open_in_reader', { sectionIndex: 1 });
    expect(t.view.goTo).toHaveBeenLastCalledWith(1);
    expect(await t.run('open_in_reader', { sectionIndex: 9 })).toMatchObject({
      error: 'not_found',
    });

    await t.run('turn_page', { direction: 'prev', pages: 3 });
    expect(t.view.prev).toHaveBeenCalledTimes(3);
    const turned = await t.run('turn_page', { direction: 'next' });
    expect(turned['position']).toEqual({ cfi: 'epubcfi(/6/2!/4/2/1:0)', chapter: 'Loomings' });
  });

  it('refuses text lookups in fixed-layout books and unknown commands', async () => {
    const t = setup();
    t.view.isFixedLayout = true;
    expect(await t.run('highlight', { text: 'Ishmael' })).toMatchObject({
      error: 'unsupported_format',
    });
    expect(await t.run('rm_rf')).toMatchObject({ error: 'unknown_command' });
  });
});
