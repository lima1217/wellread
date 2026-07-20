/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { createBooksFsSession } from '@/services/wellread/booksFsSession';

const SANDBOX = path.join(process.cwd(), '.test-sandbox-wellread-fs');

describe('createBooksFsSession', () => {
  let booksRoot: string;
  let session: ReturnType<typeof createBooksFsSession>;

  beforeEach(async () => {
    await fsp.mkdir(SANDBOX, { recursive: true });
    booksRoot = await fsp.mkdtemp(path.join(SANDBOX, 'books-'));
    await fsp.mkdir(path.join(booksRoot, 'fiction'), { recursive: true });
    await fsp.writeFile(path.join(booksRoot, 'fiction', 'moby.epub'), 'epub-bytes');
    await fsp.mkdir(path.join(booksRoot, '.wellread', 'notes'), { recursive: true });
    session = createBooksFsSession({ getBooksRoot: () => booksRoot });
  });

  afterEach(async () => {
    await fsp.rm(booksRoot, { recursive: true, force: true });
  });

  it('reads a book file under /workspace', async () => {
    const bytes = await session.readFile({ path: '/workspace/fiction/moby.epub' });
    expect(bytes).not.toBeNull();
    expect(Buffer.from(bytes!).toString('utf8')).toBe('epub-bytes');
  });

  it('rejects .. escape reads', async () => {
    await expect(
      session.readFile({ path: '/workspace/fiction/../../../../etc/passwd' }),
    ).rejects.toThrow();
  });

  it('writes under .wellread and rejects writing book files', async () => {
    await session.writeFile({
      path: '/workspace/.wellread/notes/summary.md',
      content: new TextEncoder().encode('hello'),
    });
    const written = await fsp.readFile(
      path.join(booksRoot, '.wellread', 'notes', 'summary.md'),
      'utf8',
    );
    expect(written).toBe('hello');

    await expect(
      session.writeFile({
        path: '/workspace/fiction/moby.epub',
        content: new TextEncoder().encode('nope'),
      }),
    ).rejects.toThrow(/writes only under/);
  });

  it('rejects symlink escape reads', async () => {
    const secret = path.join(booksRoot, '..', `secret-${path.basename(booksRoot)}.txt`);
    await fsp.writeFile(secret, 'ssn');
    await fsp.symlink(secret, path.join(booksRoot, 'leak'));
    await expect(session.readFile({ path: '/workspace/leak' })).rejects.toThrow(/escaped/);
    await fsp.rm(secret, { force: true });
  });

  it('creates nested .wellread paths that do not exist yet', async () => {
    await session.writeFile({
      path: '/workspace/.wellread/extract/bk1/meta.json',
      content: new TextEncoder().encode('{"ok":true}'),
    });
    const written = await fsp.readFile(
      path.join(booksRoot, '.wellread', 'extract', 'bk1', 'meta.json'),
      'utf8',
    );
    expect(written).toBe('{"ok":true}');
  });

  it('rejects spawn and run', async () => {
    await expect(session.spawn()).rejects.toThrow(/spawn disabled/);
    await expect(session.run()).rejects.toThrow(/run disabled/);
    await expect(session.setNetworkPolicy({})).resolves.toBeUndefined();
  });
});
