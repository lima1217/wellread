import { describe, expect, it } from 'vitest';
import { describeToolStep } from '@/services/wellread/assistant/displayParts';

describe('describeToolStep for reader actions', () => {
  it('names the highlighted passage and whether it carries a note', () => {
    expect(
      describeToolStep({
        name: 'highlight',
        args: { text: 'Call me Ishmael.', note: 'narrator' },
        result: { ok: true },
      }),
    ).toEqual({ kind: 'annotate', detail: 'Call me Ishmael.' });
    expect(
      describeToolStep({
        name: 'highlight',
        args: { text: 'Call me Ishmael.' },
        result: { ok: true },
      }),
    ).toEqual({ kind: 'highlight', detail: 'Call me Ishmael.' });
  });

  it('shortens long passages', () => {
    const text = 'a'.repeat(80);
    expect(describeToolStep({ name: 'highlight', args: { text } }).detail).toBe(
      `${'a'.repeat(40)}…`,
    );
  });

  it('names where the reader was taken', () => {
    expect(
      describeToolStep({
        name: 'open_in_reader',
        args: { text: 'The whale' },
        result: { ok: true, position: { chapter: 'Epilogue' } },
      }),
    ).toEqual({ kind: 'open_passage', detail: 'Epilogue' });
    expect(describeToolStep({ name: 'open_in_reader', args: { text: 'The whale' } })).toEqual({
      kind: 'open_passage',
      detail: 'The whale',
    });
    expect(describeToolStep({ name: 'turn_page', args: { direction: 'prev', pages: 2 } })).toEqual({
      kind: 'turn_page',
      count: 2,
    });
  });

  it('covers bookmarks and annotation management', () => {
    expect(describeToolStep({ name: 'add_bookmark', args: {} })).toEqual({ kind: 'bookmark' });
    expect(
      describeToolStep({ name: 'list_annotations', args: {}, result: { ok: true, total: 3 } }),
    ).toEqual({ kind: 'read_annotations' });
    expect(describeToolStep({ name: 'update_annotation', args: { id: 'n1' } })).toEqual({
      kind: 'edit_annotation',
    });
    expect(describeToolStep({ name: 'delete_annotation', args: { id: 'n1' } })).toEqual({
      kind: 'delete_annotation',
    });
  });

  it('flags a reader action that did not go through', () => {
    expect(
      describeToolStep({
        name: 'highlight',
        args: { text: 'Queequeg' },
        result: { ok: false, error: 'not_found' },
      }),
    ).toEqual({ kind: 'highlight', detail: 'Queequeg', failed: true });
  });
});
