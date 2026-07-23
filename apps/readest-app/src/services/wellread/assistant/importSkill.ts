/**
 * Import a Reading Assistant skill package from a local folder into Books/skills/<id>/.
 * Package shape matches eve-sidecar discover/invoke (Agent Skills frontmatter + SKILL.md).
 */

import type { AppService, BaseDir, FileItem } from '@/types/system';
import { getFilename } from '@/utils/path';

export const SKILLS_DIR = 'skills';
export const SKILL_FILE = 'SKILL.md';

/** Slash token: letter/digit start; then alnum, underscore, hyphen. */
export function isValidSkillId(id: string): boolean {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id);
}

export function skillFolderBasename(folderPath: string): string {
  const trimmed = folderPath.replace(/[/\\]+$/, '');
  return getFilename(trimmed) || trimmed.split(/[/\\]/).filter(Boolean).pop() || '';
}

export function toBooksRelPath(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * @returns parsed skill or null when frontmatter / required fields are missing
 */
export function parseSkillMd(raw: string): {
  name: string;
  description: string;
  instructions: string;
} | null {
  if (typeof raw !== 'string') return null;
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);
  if (!match) return null;

  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    fields[m[1]!] = unquoteYamlScalar(m[2]!.trim());
  }

  const name = (fields['name'] || '').trim();
  const description = (fields['description'] || '').trim();
  if (!name || !description) return null;

  return {
    name,
    description,
    instructions: (match[2] || '').trim(),
  };
}

export type SkillImportPlan =
  | {
      ok: true;
      id: string;
      name: string;
      description: string;
      files: string[];
    }
  | { ok: false; error: string };

/**
 * Pure validation for a picked skill folder (no FS I/O).
 */
export function planSkillImportFromFolder(input: {
  folderPath: string;
  relativePaths: string[];
  skillMd: string | null;
}): SkillImportPlan {
  const id = skillFolderBasename(input.folderPath);
  if (!isValidSkillId(id)) {
    return {
      ok: false,
      error: `Invalid skill id "${id}". Rename the folder to letters, digits, _ or - (e.g. summarize).`,
    };
  }

  const files: string[] = [];
  for (const raw of input.relativePaths) {
    const rel = toBooksRelPath(raw).replace(/^\/+/, '');
    if (!rel || rel.endsWith('/')) continue;
    if (rel.split('/').includes('..')) {
      return { ok: false, error: 'Skill package paths must not contain "..".' };
    }
    files.push(rel);
  }

  if (!files.includes(SKILL_FILE)) {
    return {
      ok: false,
      error: `Folder must contain ${SKILL_FILE} at the package root.`,
    };
  }

  if (input.skillMd == null) {
    return { ok: false, error: `Could not read ${SKILL_FILE}.` };
  }

  const parsed = parseSkillMd(input.skillMd);
  if (!parsed) {
    return {
      ok: false,
      error: `${SKILL_FILE} needs YAML frontmatter with name and description.`,
    };
  }

  return {
    ok: true,
    id,
    name: parsed.name,
    description: parsed.description,
    files,
  };
}

export type SkillImportFs = {
  readDirectory(path: string, base: BaseDir): Promise<FileItem[]>;
  readFile(path: string, base: BaseDir, mode: 'text' | 'binary'): Promise<string | ArrayBuffer>;
  exists(path: string, base: BaseDir): Promise<boolean>;
  createDir(path: string, base: BaseDir, recursive?: boolean): Promise<void>;
  deleteDir(path: string, base: BaseDir, recursive?: boolean): Promise<void>;
  copyFile(srcPath: string, srcBase: BaseDir, dstPath: string, dstBase: BaseDir): Promise<void>;
  joinPath?(...parts: string[]): Promise<string> | string;
};

export type SkillImportResult =
  | { ok: true; id: string; name: string; description: string; replaced: boolean }
  | { ok: false; error: string };

/**
 * Copy a validated skill folder into Books/skills/<id>/ (overwrites existing id).
 */
export async function importSkillFromFolder(
  fs: SkillImportFs,
  folderPath: string,
): Promise<SkillImportResult> {
  const trimmed = folderPath.replace(/[/\\]+$/, '');
  if (!trimmed) {
    return { ok: false, error: 'No folder selected.' };
  }

  let entries: FileItem[];
  try {
    entries = await fs.readDirectory(trimmed, 'None');
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to read skill folder.',
    };
  }

  const relativePaths = entries.map((e) => e.path);
  const skillMdPath = await joinHostPath(fs, trimmed, SKILL_FILE);
  let skillMd: string | null = null;
  try {
    const raw = await fs.readFile(skillMdPath, 'None', 'text');
    skillMd = typeof raw === 'string' ? raw : null;
  } catch {
    skillMd = null;
  }

  const plan = planSkillImportFromFolder({
    folderPath: trimmed,
    relativePaths,
    skillMd,
  });
  if (!plan.ok) return plan;

  const destRoot = `${SKILLS_DIR}/${plan.id}`;
  const replaced = await fs.exists(destRoot, 'Books');
  if (replaced) {
    await fs.deleteDir(destRoot, 'Books', true);
  }
  await fs.createDir(destRoot, 'Books', true);

  for (const rel of plan.files) {
    const src = await joinHostPath(fs, trimmed, ...rel.split('/'));
    const dst = `${destRoot}/${rel}`;
    await fs.copyFile(src, 'None', dst, 'Books');
  }

  return {
    ok: true,
    id: plan.id,
    name: plan.name,
    description: plan.description,
    replaced,
  };
}

export type SkillDeleteResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Remove Books/skills/<id>/ after id validation.
 */
export async function deleteSkillPackage(
  fs: Pick<SkillImportFs, 'exists' | 'deleteDir'>,
  id: string,
): Promise<SkillDeleteResult> {
  if (!isValidSkillId(id)) {
    return { ok: false, error: `Invalid skill id "${id}".` };
  }
  const destRoot = `${SKILLS_DIR}/${id}`;
  if (!(await fs.exists(destRoot, 'Books'))) {
    return { ok: false, error: `Skill "${id}" is not installed.` };
  }
  await fs.deleteDir(destRoot, 'Books', true);
  return { ok: true, id };
}

/** Thin AppService adapter for {@link importSkillFromFolder}. */
export function createAppServiceSkillImportFs(appService: AppService): SkillImportFs {
  return {
    readDirectory: (path, base) => appService.readDirectory(path, base),
    readFile: (path, base, mode) => appService.readFile(path, base, mode),
    exists: (path, base) => appService.exists(path, base),
    createDir: (path, base, recursive = true) => appService.createDir(path, base, recursive),
    deleteDir: (path, base, recursive = true) => appService.deleteDir(path, base, recursive),
    copyFile: (srcPath, srcBase, dstPath, dstBase) =>
      appService.copyFile(srcPath, srcBase, dstPath, dstBase),
  };
}

async function joinHostPath(fs: SkillImportFs, root: string, ...parts: string[]): Promise<string> {
  if (fs.joinPath) {
    return await fs.joinPath(root, ...parts);
  }
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return [root, ...parts].join(sep);
}

function unquoteYamlScalar(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    const inner = value.slice(1, -1);
    if (value.startsWith('"')) {
      try {
        return JSON.parse(value) as string;
      } catch {
        return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
    }
    return inner.replace(/''/g, "'");
  }
  return value;
}
