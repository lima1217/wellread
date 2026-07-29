import type { BookDoc } from '@/libs/document';

/**
 * Map spine section id/href → 0-based spine index.
 * Shared by extract chapter titles and mrexpt TOC↔spine resolution.
 */
export function buildHrefToSpineIndex(bookDoc: BookDoc): Map<string, number> {
  const map = new Map<string, number>();
  const sections = bookDoc.sections ?? [];
  sections.forEach((section, idx) => {
    if (section.id) map.set(section.id, idx);
    if (section.href) map.set(section.href, idx);
  });
  return map;
}

/**
 * Resolve a TOC href to its 0-based spine index.
 *
 * BookDoc.splitTOCHref returns [sectionId, fragmentId?] where sectionId is
 * the path-resolved manifest item href (matching SectionItem.id). Falls back
 * to basename match when some books store relative paths in TOC.
 */
export function resolveTocHrefToSpineIndex(
  bookDoc: BookDoc,
  href: string,
  hrefToSpine: Map<string, number> = buildHrefToSpineIndex(bookDoc),
): number {
  const [sectionId] = bookDoc.splitTOCHref(href) as [string | undefined];
  let spineIdx = -1;
  if (sectionId !== undefined) {
    spineIdx = hrefToSpine.get(sectionId) ?? -1;
  }
  if (spineIdx < 0) {
    const candidate = sectionId ?? href;
    const basename = candidate.split('/').pop() ?? candidate;
    spineIdx = (bookDoc.sections ?? []).findIndex((s) => {
      const sid = s.id || s.href || '';
      return sid.endsWith(`/${basename}`) || sid === basename;
    });
  }
  return spineIdx;
}
