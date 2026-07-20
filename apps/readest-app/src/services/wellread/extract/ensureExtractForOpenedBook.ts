import type { AppService, FileSystem } from '@/types/system';
import type { Book } from '@/types/book';
import type { BookDoc } from '@/libs/document';
import { getLocalBookFilename } from '@/utils/book';
import { ensureBookExtract, type BooksExtractFs } from './ensureBookExtract';

export function createAppServiceExtractFs(appService: AppService): BooksExtractFs {
  return {
    async exists(path) {
      return appService.exists(path, 'Books');
    },
    async readText(path) {
      if (!(await appService.exists(path, 'Books'))) return null;
      const content = await appService.readFile(path, 'Books', 'text');
      return typeof content === 'string' ? content : null;
    },
    async writeText(path, content) {
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      if (dir) {
        await appService.createDir(dir, 'Books', true);
      }
      await appService.writeFile(path, 'Books', content);
    },
    async removeDir(path) {
      if (await appService.exists(path, 'Books')) {
        await appService.deleteDir(path, 'Books', true);
      }
    },
  };
}

async function resolveSourceMtimeMs(appService: AppService, book: Book): Promise<number | null> {
  const fs = (appService as AppService & { fs?: FileSystem }).fs;
  if (!fs?.stats) return book.updatedAt ?? null;
  try {
    const rel = getLocalBookFilename(book);
    if (await appService.exists(rel, 'Books')) {
      const info = await fs.stats(rel, 'Books');
      return info.mtime?.getTime() ?? book.updatedAt ?? null;
    }
  } catch {
    // fall through
  }
  return book.updatedAt ?? null;
}

/**
 * Host hook: build/refresh extract tree for an opened book.
 * Non-EPUB formats skip chunking (no precise cfi anchors yet — SPEC §8).
 *
 * Invalidation = book.hash (content) + source file mtime when available.
 */
export async function ensureExtractForOpenedBook(input: {
  appService: AppService;
  book: Book;
  bookDoc: BookDoc;
}): Promise<void> {
  const { appService, book, bookDoc } = input;
  const sourceMtimeMs = await resolveSourceMtimeMs(appService, book);
  await ensureBookExtract({
    bookId: book.hash,
    bookDoc,
    format: book.format,
    sourceHash: book.hash,
    sourceMtimeMs,
    fs: createAppServiceExtractFs(appService),
    skipChunking: book.format !== 'EPUB',
  });
}
