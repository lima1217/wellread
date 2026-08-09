import { describe, expect, it } from 'vitest';
import type { BaseDir, FileItem } from '@/types/system';
import {
  DISABLED_BUNDLED_SKILLS_REL,
  deleteSkillPackage,
  hideBundledSkill,
  importSkillFromFolder,
  isValidSkillId,
  parseSkillMd,
  planSkillImportFromFolder,
  skillFolderBasename,
  unhideBundledSkill,
  type SkillImportFs,
} from '@/services/wellread/assistant/importSkill';

describe('isValidSkillId', () => {
  it('accepts Agent Skills slash tokens', () => {
    expect(isValidSkillId('summarize')).toBe(true);
    expect(isValidSkillId('okf-wiki')).toBe(true);
    expect(isValidSkillId('translate_zh')).toBe(true);
  });

  it('rejects spaces, slashes, and leading dots', () => {
    expect(isValidSkillId('bad id')).toBe(false);
    expect(isValidSkillId('a/b')).toBe(false);
    expect(isValidSkillId('.hidden')).toBe(false);
    expect(isValidSkillId('')).toBe(false);
  });
});

describe('parseSkillMd', () => {
  it('reads name and description from YAML frontmatter', () => {
    expect(
      parseSkillMd(
        [
          '---',
          'name: summarize',
          'description: "Summarize the current chapter."',
          '---',
          '',
          'Body.',
          '',
        ].join('\n'),
      ),
    ).toEqual({
      name: 'summarize',
      description: 'Summarize the current chapter.',
      instructions: 'Body.',
    });
  });

  it('returns null when frontmatter or required fields are missing', () => {
    expect(parseSkillMd('# no frontmatter\n')).toBeNull();
    expect(parseSkillMd('---\nname: only\n---\nbody\n')).toBeNull();
    expect(parseSkillMd('---\ndescription: only\n---\nbody\n')).toBeNull();
  });
});

describe('skillFolderBasename', () => {
  it('strips trailing separators and returns the last segment', () => {
    expect(skillFolderBasename('/Users/me/skills/summarize/')).toBe('summarize');
    expect(skillFolderBasename('C:\\skills\\translate')).toBe('translate');
  });
});

describe('planSkillImportFromFolder', () => {
  const skillMd = [
    '---',
    'name: Summarize',
    'description: Chapter summary',
    '---',
    'Be brief.',
  ].join('\n');

  it('accepts a folder whose basename is a valid id and contains root SKILL.md', () => {
    expect(
      planSkillImportFromFolder({
        folderPath: '/tmp/summarize',
        relativePaths: ['SKILL.md', 'refs/notes.md'],
        skillMd,
      }),
    ).toEqual({
      ok: true,
      id: 'summarize',
      name: 'Summarize',
      description: 'Chapter summary',
      files: ['SKILL.md', 'refs/notes.md'],
    });
  });

  it('rejects when SKILL.md is missing at package root', () => {
    const plan = planSkillImportFromFolder({
      folderPath: '/tmp/summarize',
      relativePaths: ['refs/SKILL.md'],
      skillMd: null,
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/SKILL\.md/i);
  });

  it('rejects invalid folder names as skill ids', () => {
    const plan = planSkillImportFromFolder({
      folderPath: '/tmp/My Skill',
      relativePaths: ['SKILL.md'],
      skillMd,
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/id/i);
  });

  it('rejects path escape attempts', () => {
    const plan = planSkillImportFromFolder({
      folderPath: '/tmp/summarize',
      relativePaths: ['SKILL.md', '../evil.md'],
      skillMd,
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/\.\./);
  });

  it('rejects PACKAGE.md / AGENTS.md / tools/ (bundled-only surfaces)', () => {
    for (const rel of ['PACKAGE.md', 'package.md', 'AGENTS.md', 'tools/validate.py']) {
      const plan = planSkillImportFromFolder({
        folderPath: '/tmp/summarize',
        relativePaths: ['SKILL.md', rel],
        skillMd,
      });
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.error).toMatch(/bundled-only/i);
    }
  });

  it('rejects invalid SKILL.md content', () => {
    const plan = planSkillImportFromFolder({
      folderPath: '/tmp/summarize',
      relativePaths: ['SKILL.md'],
      skillMd: '# no frontmatter\n',
    });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toMatch(/frontmatter|name|description/i);
  });
});

describe('importSkillFromFolder', () => {
  const skillMd = [
    '---',
    'name: Summarize',
    'description: Chapter summary',
    '---',
    'Be brief.',
  ].join('\n');

  function createMemoryFs(opts: {
    files: Record<string, string>;
    existingBooks?: Set<string>;
  }): SkillImportFs & { books: Map<string, string> } {
    const books = new Map<string, string>();
    const existing = opts.existingBooks ?? new Set<string>();
    return {
      books,
      async readDirectory(path: string, base: BaseDir): Promise<FileItem[]> {
        const prefix = path.replace(/\/+$/, '') + '/';
        if (base === 'Books') {
          return [...books.keys()]
            .filter((p) => p.startsWith(prefix))
            .map((p) => ({ path: p.slice(prefix.length), size: books.get(p)!.length }));
        }
        if (base !== 'None') return [];
        return Object.keys(opts.files)
          .filter((p) => p.startsWith(prefix))
          .map((p) => ({ path: p.slice(prefix.length), size: opts.files[p]!.length }));
      },
      async readFile(path: string, base: BaseDir) {
        if (base === 'None') {
          const raw = opts.files[path];
          if (raw == null) throw new Error('missing');
          return raw;
        }
        const raw = books.get(path);
        if (raw == null) throw new Error('missing');
        return raw;
      },
      async exists(path: string, base: BaseDir) {
        if (base === 'Books')
          return (
            existing.has(path) ||
            [...books.keys()].some((k) => k === path || k.startsWith(`${path}/`))
          );
        return path in opts.files;
      },
      async createDir(path: string, base: BaseDir) {
        if (base === 'Books') existing.add(path);
      },
      async deleteDir(path: string, base: BaseDir) {
        if (base !== 'Books') return;
        for (const key of [...books.keys()]) {
          if (key === path || key.startsWith(`${path}/`)) books.delete(key);
        }
        existing.delete(path);
      },
      async copyFile(srcPath: string, srcBase: BaseDir, dstPath: string, dstBase: BaseDir) {
        if (dstBase !== 'Books') throw new Error('unexpected bases');
        if (srcBase === 'None') {
          const raw = opts.files[srcPath];
          if (raw == null) throw new Error(`missing src ${srcPath}`);
          books.set(dstPath, raw);
          return;
        }
        if (srcBase === 'Books') {
          const raw = books.get(srcPath);
          if (raw == null) throw new Error(`missing src ${srcPath}`);
          books.set(dstPath, raw);
          return;
        }
        throw new Error('unexpected bases');
      },
      joinPath(...parts: string[]) {
        return parts.join('/');
      },
    };
  }

  it('copies the package under Books/skills/<id>/', async () => {
    const fs = createMemoryFs({
      files: {
        '/tmp/summarize/SKILL.md': skillMd,
        '/tmp/summarize/refs/notes.md': 'note',
      },
    });
    const result = await importSkillFromFolder(fs, '/tmp/summarize');
    expect(result).toEqual({
      ok: true,
      id: 'summarize',
      name: 'Summarize',
      description: 'Chapter summary',
      replaced: false,
    });
    expect(fs.books.get('skills/summarize/SKILL.md')).toBe(skillMd);
    expect(fs.books.get('skills/summarize/refs/notes.md')).toBe('note');
  });

  it('replaces an existing skill id', async () => {
    const fs = createMemoryFs({
      files: { '/tmp/summarize/SKILL.md': skillMd },
      existingBooks: new Set(['skills/summarize']),
    });
    fs.books.set('skills/summarize/SKILL.md', 'old');
    const result = await importSkillFromFolder(fs, '/tmp/summarize');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.replaced).toBe(true);
    expect(fs.books.get('skills/summarize/SKILL.md')).toBe(skillMd);
  });
});

describe('deleteSkillPackage', () => {
  it('removes Books/skills/<id>/ when present', async () => {
    const books = new Map<string, string>([
      ['skills/summarize/SKILL.md', 'x'],
      ['skills/summarize/refs/a.md', 'y'],
      ['skills/other/SKILL.md', 'z'],
    ]);
    const existing = new Set(['skills/summarize', 'skills/other']);
    const fs: SkillImportFs = {
      async readDirectory() {
        return [];
      },
      async readFile() {
        throw new Error('unused');
      },
      async exists(path, base) {
        return (
          base === 'Books' &&
          (existing.has(path) || [...books.keys()].some((k) => k.startsWith(`${path}/`)))
        );
      },
      async createDir() {},
      async deleteDir(path, base) {
        if (base !== 'Books') return;
        for (const key of [...books.keys()]) {
          if (key === path || key.startsWith(`${path}/`)) books.delete(key);
        }
        existing.delete(path);
      },
      async copyFile() {},
    };

    const result = await deleteSkillPackage(fs, 'summarize');
    expect(result).toEqual({ ok: true, id: 'summarize' });
    expect(books.has('skills/summarize/SKILL.md')).toBe(false);
    expect(books.has('skills/other/SKILL.md')).toBe(true);
  });

  it('rejects invalid ids and missing packages', async () => {
    const fs: SkillImportFs = {
      async readDirectory() {
        return [];
      },
      async readFile() {
        throw new Error('unused');
      },
      async exists() {
        return false;
      },
      async createDir() {},
      async deleteDir() {},
      async copyFile() {},
    };
    expect(await deleteSkillPackage(fs, 'bad id')).toMatchObject({ ok: false });
    expect(await deleteSkillPackage(fs, 'missing')).toMatchObject({ ok: false });
  });
});

describe('hideBundledSkill', () => {
  it('writes and merges Books/.wellread/disabled-bundled-skills.json', async () => {
    const books = new Map<string, string>();
    const existing = new Set<string>();
    const fs = {
      async readDirectory() {
        return [] as FileItem[];
      },
      async readFile(path: string, base: BaseDir) {
        if (base !== 'Books') throw new Error('unexpected base');
        const v = books.get(path);
        if (v == null) throw new Error('missing');
        return v;
      },
      async exists(path: string, base: BaseDir) {
        return base === 'Books' && (existing.has(path) || books.has(path));
      },
      async createDir(path: string, base: BaseDir) {
        if (base === 'Books') existing.add(path);
      },
      async deleteDir() {},
      async copyFile() {},
      async writeFile(path: string, base: BaseDir, content: string) {
        if (base !== 'Books') return;
        books.set(path, content);
        existing.add(path);
      },
    };

    expect(await hideBundledSkill(fs, 'translate')).toEqual({ ok: true, id: 'translate' });
    expect(JSON.parse(books.get(DISABLED_BUNDLED_SKILLS_REL)!)).toEqual(['translate']);

    expect(await hideBundledSkill(fs, 'explain')).toEqual({ ok: true, id: 'explain' });
    expect(JSON.parse(books.get(DISABLED_BUNDLED_SKILLS_REL)!)).toEqual(['explain', 'translate']);

    expect(await hideBundledSkill(fs, 'translate')).toEqual({ ok: true, id: 'translate' });
    expect(JSON.parse(books.get(DISABLED_BUNDLED_SKILLS_REL)!)).toEqual(['explain', 'translate']);
  });

  it('rejects invalid ids', async () => {
    const fs = {
      async readDirectory() {
        return [] as FileItem[];
      },
      async readFile() {
        throw new Error('unused');
      },
      async exists() {
        return false;
      },
      async createDir() {},
      async deleteDir() {},
      async copyFile() {},
      async writeFile() {},
    };
    expect(await hideBundledSkill(fs, 'bad id')).toMatchObject({ ok: false });
  });
});

describe('unhideBundledSkill', () => {
  it('removes an id from disabled-bundled-skills.json', async () => {
    const books = new Map<string, string>([
      [DISABLED_BUNDLED_SKILLS_REL, JSON.stringify(['explain', 'translate'], null, 2) + '\n'],
    ]);
    const existing = new Set<string>(['.wellread', DISABLED_BUNDLED_SKILLS_REL]);
    const fs = {
      async readDirectory() {
        return [] as FileItem[];
      },
      async readFile(path: string, base: BaseDir) {
        if (base !== 'Books') throw new Error('unexpected base');
        const v = books.get(path);
        if (v == null) throw new Error('missing');
        return v;
      },
      async exists(path: string, base: BaseDir) {
        return base === 'Books' && (existing.has(path) || books.has(path));
      },
      async createDir(path: string, base: BaseDir) {
        if (base === 'Books') existing.add(path);
      },
      async deleteDir() {},
      async copyFile() {},
      async writeFile(path: string, base: BaseDir, content: string) {
        if (base !== 'Books') return;
        books.set(path, content);
        existing.add(path);
      },
    };

    expect(await unhideBundledSkill(fs, 'translate')).toEqual({ ok: true, id: 'translate' });
    expect(JSON.parse(books.get(DISABLED_BUNDLED_SKILLS_REL)!)).toEqual(['explain']);

    expect(await unhideBundledSkill(fs, 'explain')).toEqual({ ok: true, id: 'explain' });
    expect(JSON.parse(books.get(DISABLED_BUNDLED_SKILLS_REL)!)).toEqual([]);
  });
});
