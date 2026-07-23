import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
  SKILLS_DIR,
  discoverSkills,
  invalidateSkillsCache,
  isValidSkillId,
  parseSkillMd,
} from './discover.mjs';

afterEach(() => {
  invalidateSkillsCache();
});

describe('isValidSkillId', () => {
  it('accepts simple slash tokens', () => {
    assert.equal(isValidSkillId('summarize'), true);
    assert.equal(isValidSkillId('okf-wiki'), true);
    assert.equal(isValidSkillId('translate_zh'), true);
  });

  it('rejects spaces, slashes, and leading dots', () => {
    assert.equal(isValidSkillId('bad id'), false);
    assert.equal(isValidSkillId('a/b'), false);
    assert.equal(isValidSkillId('.hidden'), false);
    assert.equal(isValidSkillId(''), false);
  });
});

describe('parseSkillMd', () => {
  it('reads name and description from YAML frontmatter', () => {
    const parsed = parseSkillMd(
      [
        '---',
        'name: summarize',
        'description: "Summarize the current chapter."',
        '---',
        '',
        'Use extract tools when needed.',
        '',
      ].join('\n'),
    );
    assert.deepEqual(parsed, {
      name: 'summarize',
      description: 'Summarize the current chapter.',
      instructions: 'Use extract tools when needed.',
    });
  });

  it('returns null when frontmatter or required fields are missing', () => {
    assert.equal(parseSkillMd('# no frontmatter\n'), null);
    assert.equal(parseSkillMd('---\nname: only\n---\nbody\n'), null);
    assert.equal(parseSkillMd('---\ndescription: only\n---\nbody\n'), null);
  });
});

describe('discoverSkills', () => {
  it('SKILLS_DIR is skills under Books root', () => {
    assert.equal(SKILLS_DIR, 'skills');
  });

  it('returns empty list when skills root is missing', () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-skills-')));
    try {
      assert.deepEqual(discoverSkills({ booksRoot }), []);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('lists valid packages under Books/skills sorted by id', () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-skills-')));
    try {
      const skillsRoot = join(booksRoot, 'skills');
      mkdirSync(join(skillsRoot, 'zeta'), { recursive: true });
      mkdirSync(join(skillsRoot, 'alpha'), { recursive: true });
      writeFileSync(
        join(skillsRoot, 'zeta', 'SKILL.md'),
        '---\nname: Zeta\ndescription: Last\n---\nBody Z\n',
      );
      writeFileSync(
        join(skillsRoot, 'alpha', 'SKILL.md'),
        '---\nname: Alpha\ndescription: First\n---\nBody A\n',
      );

      assert.deepEqual(discoverSkills({ booksRoot }), [
        {
          id: 'alpha',
          name: 'Alpha',
          description: 'First',
          path: '/workspace/skills/alpha/SKILL.md',
          source: 'user',
        },
        {
          id: 'zeta',
          name: 'Zeta',
          description: 'Last',
          path: '/workspace/skills/zeta/SKILL.md',
          source: 'user',
        },
      ]);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('skips invalid ids, missing SKILL.md, and broken frontmatter', () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-skills-')));
    try {
      const skillsRoot = join(booksRoot, 'skills');
      mkdirSync(join(skillsRoot, 'good'), { recursive: true });
      mkdirSync(join(skillsRoot, '.dot'), { recursive: true });
      mkdirSync(join(skillsRoot, 'bad id'), { recursive: true });
      mkdirSync(join(skillsRoot, 'empty'), { recursive: true });
      mkdirSync(join(skillsRoot, 'broken'), { recursive: true });
      writeFileSync(
        join(skillsRoot, 'good', 'SKILL.md'),
        '---\nname: Good\ndescription: Ok\n---\nHi\n',
      );
      writeFileSync(
        join(skillsRoot, '.dot', 'SKILL.md'),
        '---\nname: Dot\ndescription: Hidden\n---\nNo\n',
      );
      writeFileSync(
        join(skillsRoot, 'bad id', 'SKILL.md'),
        '---\nname: Bad\ndescription: Space\n---\nNo\n',
      );
      writeFileSync(join(skillsRoot, 'broken', 'SKILL.md'), '# not a skill\n');

      assert.deepEqual(discoverSkills({ booksRoot }), [
        {
          id: 'good',
          name: 'Good',
          description: 'Ok',
          path: '/workspace/skills/good/SKILL.md',
          source: 'user',
        },
      ]);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('skips package dir symlinks and SKILL.md file symlinks', () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-skills-')));
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-skills-out-')));
    try {
      const skillsRoot = join(booksRoot, 'skills');
      mkdirSync(skillsRoot, { recursive: true });

      mkdirSync(join(outside, 'evil'), { recursive: true });
      writeFileSync(
        join(outside, 'evil', 'SKILL.md'),
        '---\nname: Evil\ndescription: Leak\n---\nSECRET\n',
      );
      symlinkSync(join(outside, 'evil'), join(skillsRoot, 'evil'));

      mkdirSync(join(skillsRoot, 'linked'), { recursive: true });
      writeFileSync(
        join(outside, 'file.md'),
        '---\nname: File\ndescription: Via link\n---\nFILESECRET\n',
      );
      symlinkSync(join(outside, 'file.md'), join(skillsRoot, 'linked', 'SKILL.md'));

      mkdirSync(join(skillsRoot, 'good'), { recursive: true });
      writeFileSync(
        join(skillsRoot, 'good', 'SKILL.md'),
        '---\nname: Good\ndescription: Ok\n---\nHi\n',
      );

      assert.deepEqual(discoverSkills({ booksRoot }), [
        {
          id: 'good',
          name: 'Good',
          description: 'Ok',
          path: '/workspace/skills/good/SKILL.md',
          source: 'user',
        },
      ]);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('invalidates when SKILL.md mtime changes, package add, or invalidateSkillsCache', () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-skills-')));
    try {
      const skillsRoot = join(booksRoot, 'skills');
      const alphaMd = join(skillsRoot, 'alpha', 'SKILL.md');
      mkdirSync(join(skillsRoot, 'alpha'), { recursive: true });
      writeFileSync(alphaMd, '---\nname: Alpha\ndescription: First\n---\nA\n');

      assert.equal(discoverSkills({ booksRoot })[0]?.description, 'First');

      // In-place edit: stamp includes SKILL.md mtime → auto refresh.
      writeFileSync(alphaMd, '---\nname: Alpha\ndescription: Edited\n---\nA\n');
      const later = new Date(Date.now() + 2000);
      utimesSync(alphaMd, later, later);
      assert.equal(discoverSkills({ booksRoot })[0]?.description, 'Edited');

      // Same content + same stamp stays cached until explicit invalidate.
      const before = discoverSkills({ booksRoot });
      assert.equal(before[0]?.description, 'Edited');
      invalidateSkillsCache(booksRoot);
      assert.equal(discoverSkills({ booksRoot })[0]?.description, 'Edited');

      // Import-like package add → auto refresh.
      mkdirSync(join(skillsRoot, 'beta'), { recursive: true });
      writeFileSync(
        join(skillsRoot, 'beta', 'SKILL.md'),
        '---\nname: Beta\ndescription: Second\n---\nB\n',
      );
      const withBeta = discoverSkills({ booksRoot });
      assert.equal(withBeta.length, 2);
      assert.equal(withBeta.some((s) => s.id === 'beta'), true);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });
});
