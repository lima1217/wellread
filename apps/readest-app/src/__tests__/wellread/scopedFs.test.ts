import { describe, expect, it } from 'vitest';
import {
  authorizeRead,
  authorizeWrite,
  normalizeAbsolute,
  type RealpathLookup,
  workspaceToHost,
} from '@/services/wellread/scopedFs';

/** In-memory FS facts for realpath walks. */
function lookupFrom(map: Record<string, 'file' | 'dir' | { symlink: string }>): RealpathLookup {
  return (absoluteHostPath) => {
    const entry = map[normalizeAbsolute(absoluteHostPath)];
    if (!entry) return { kind: 'missing' };
    if (typeof entry === 'object' && 'symlink' in entry) {
      return { kind: 'symlink', target: entry.symlink };
    }
    return { kind: entry };
  };
}

const BOOKS = '/Books';

describe('scopedFs', () => {
  it('maps /workspace to the Books root', () => {
    const mapped = workspaceToHost('/workspace', BOOKS);
    expect(mapped.ok).toBe(true);
    if (mapped.ok) expect(mapped.hostPath).toBe(BOOKS);
  });

  it('denies paths that normalize outside /workspace before host mapping', () => {
    const result = authorizeRead(
      '/workspace/fiction/../../../../tmp/secret.txt',
      BOOKS,
      lookupFrom({}),
    );
    expect(result.ok).toBe(false);
  });

  it('allows reading a book file under Books', () => {
    const host = `${BOOKS}/fiction/moby.epub`;
    const result = authorizeRead(
      '/workspace/fiction/moby.epub',
      BOOKS,
      lookupFrom({
        [BOOKS]: 'dir',
        [`${BOOKS}/fiction`]: 'dir',
        [host]: 'file',
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.realPath).toBe(host);
  });

  it('denies writing a book file outside .wellread', () => {
    const host = `${BOOKS}/fiction/moby.epub`;
    const result = authorizeWrite(
      '/workspace/fiction/moby.epub',
      BOOKS,
      lookupFrom({
        [BOOKS]: 'dir',
        [`${BOOKS}/fiction`]: 'dir',
        [host]: 'file',
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('allows writing under /workspace/.wellread/', () => {
    const host = `${BOOKS}/.wellread/notes/summary.md`;
    const result = authorizeWrite(
      '/workspace/.wellread/notes/summary.md',
      BOOKS,
      lookupFrom({
        [BOOKS]: 'dir',
        [`${BOOKS}/.wellread`]: 'dir',
        [`${BOOKS}/.wellread/notes`]: 'dir',
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.realPath).toBe(host);
  });

  it('denies reading a symlink that escapes Books', () => {
    const result = authorizeRead(
      '/workspace/leak',
      BOOKS,
      lookupFrom({
        [BOOKS]: 'dir',
        [`${BOOKS}/leak`]: { symlink: '/tmp/secret.txt' },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('denies writing through a .wellread symlink that lands on a book file', () => {
    const book = `${BOOKS}/fiction/moby.epub`;
    const result = authorizeWrite(
      '/workspace/.wellread/trap',
      BOOKS,
      lookupFrom({
        [BOOKS]: 'dir',
        [`${BOOKS}/.wellread`]: 'dir',
        [`${BOOKS}/.wellread/trap`]: { symlink: book },
        [`${BOOKS}/fiction`]: 'dir',
        [book]: 'file',
      }),
    );
    expect(result.ok).toBe(false);
  });
});
