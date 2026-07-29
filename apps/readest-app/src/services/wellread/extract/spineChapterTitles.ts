import type { BookDoc } from '@/libs/document';
import { collectAllTocItems } from '@/services/nav/grouping';
import { buildHrefToSpineIndex, resolveTocHrefToSpineIndex } from '@/services/nav/tocSpine';

/**
 * Build a lookup from spine sectionIndex → first TOC label that points at that spine.
 * Spines with no TOC entry return null (caller falls back to `Section N`).
 */
export function buildSpineChapterTitleLookup(
  bookDoc: BookDoc,
): (sectionIndex: number) => string | null {
  const titles = new Map<number, string>();
  const hrefToSpine = buildHrefToSpineIndex(bookDoc);
  for (const item of collectAllTocItems(bookDoc.toc ?? [])) {
    if (!item.href) continue;
    const label = item.label?.trim();
    if (!label) continue;
    const spineIdx = resolveTocHrefToSpineIndex(bookDoc, item.href, hrefToSpine);
    if (spineIdx < 0 || titles.has(spineIdx)) continue;
    titles.set(spineIdx, label);
  }
  return (sectionIndex: number) => titles.get(sectionIndex) ?? null;
}
