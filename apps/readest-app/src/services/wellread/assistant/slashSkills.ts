/**
 * Composer `/skill:<id>` slash helpers.
 */

/** Pi-style skill slash namespace: `/skill:<id>`. */
export const SKILL_SLASH_PREFIX = 'skill:';

/**
 * While the composer is typing a leading `/…` skill token (no args yet), return
 * the filter query. `/skill:sum` → `sum`; bare `/sum` still filters. Once a
 * space (or newline) appears, the menu closes.
 */
export function getComposerSlashQuery(composer: string): string | null {
  if (!composer.startsWith('/')) return null;
  const after = composer.slice(1);
  if (/[\s\n]/.test(after)) return null;
  const lower = after.toLowerCase();
  if (lower.startsWith(SKILL_SLASH_PREFIX)) {
    return after.slice(SKILL_SLASH_PREFIX.length);
  }
  return after;
}

/** Filter catalog by id/name/description prefix or substring (case-insensitive). */
export function filterSkillsForSlash<T extends { id: string; name: string; description: string }>(
  skills: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...skills];
  return skills.filter((s) => {
    const id = s.id.toLowerCase();
    const name = s.name.toLowerCase();
    const description = s.description.toLowerCase();
    return id.startsWith(q) || name.includes(q) || description.includes(q);
  });
}

/** Replace a leading `/partial` with `/skill:<id> ` (trailing space for optional args). */
export function applySlashSkillSelection(composer: string, skillId: string): string {
  const inserted = `/${SKILL_SLASH_PREFIX}${skillId}`;
  if (!composer.startsWith('/')) return `${inserted} `;
  const after = composer.slice(1);
  const space = after.search(/\s/);
  if (space < 0) return `${inserted} `;
  return `${inserted}${after.slice(space)}`;
}
