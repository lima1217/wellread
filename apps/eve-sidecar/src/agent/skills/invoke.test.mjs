import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  appendActiveSkillPrompt,
  loadSkillPackage,
  parseSlashInvocation,
  resolveSkillForMessage,
} from './invoke.mjs';

describe('parseSlashInvocation', () => {
  it('parses /id and optional rest', () => {
    assert.deepEqual(parseSlashInvocation('/summarize'), {
      skillId: 'summarize',
      rest: '',
    });
    assert.deepEqual(parseSlashInvocation('  /summarize  this chapter  '), {
      skillId: 'summarize',
      rest: 'this chapter',
    });
  });

  it('reads the slash command from the question after Pending Quote blocks', () => {
    assert.deepEqual(
      parseSlashInvocation('> Ahab\n> — 《Ch1》\n\n/summarize this'),
      { skillId: 'summarize', rest: 'this' },
    );
  });

  it('keeps /id when the question has blank lines after Pending Quotes', () => {
    assert.deepEqual(
      parseSlashInvocation('> Ahab\n> — 《Ch1》\n\n/summarize\n\nPlease be brief.'),
      { skillId: 'summarize', rest: 'Please be brief.' },
    );
  });

  it('returns null when not a slash command', () => {
    assert.equal(parseSlashInvocation('hello'), null);
    assert.equal(parseSlashInvocation('/'), null);
    assert.equal(parseSlashInvocation('say /summarize'), null);
  });
});

describe('loadSkillPackage / resolveSkillForMessage', () => {
  it('loads instructions from Books/skills/<id>/SKILL.md', () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-invoke-')));
    try {
      mkdirSync(join(booksRoot, 'skills', 'summarize'), { recursive: true });
      writeFileSync(
        join(booksRoot, 'skills', 'summarize', 'SKILL.md'),
        '---\nname: Summarize\ndescription: Make a summary\n---\nBe concise.\n',
      );
      const skill = loadSkillPackage(booksRoot, 'summarize');
      assert.equal(skill?.id, 'summarize');
      assert.equal(skill?.name, 'Summarize');
      assert.equal(skill?.instructions, 'Be concise.');
      assert.equal(skill?.path, '/workspace/skills/summarize/SKILL.md');

      assert.equal(resolveSkillForMessage('/missing', booksRoot), null);
      assert.equal(resolveSkillForMessage('/summarize please', booksRoot)?.id, 'summarize');
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('refuses package dir symlinks and SKILL.md file symlinks', () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-invoke-')));
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-invoke-out-')));
    try {
      mkdirSync(join(outside, 'evil'), { recursive: true });
      writeFileSync(
        join(outside, 'evil', 'SKILL.md'),
        '---\nname: Evil\ndescription: Leak\n---\nSECRET\n',
      );
      mkdirSync(join(booksRoot, 'skills'), { recursive: true });
      symlinkSync(join(outside, 'evil'), join(booksRoot, 'skills', 'evil'));

      mkdirSync(join(booksRoot, 'skills', 'linked'), { recursive: true });
      writeFileSync(
        join(outside, 'file.md'),
        '---\nname: File\ndescription: Via link\n---\nFILESECRET\n',
      );
      symlinkSync(join(outside, 'file.md'), join(booksRoot, 'skills', 'linked', 'SKILL.md'));

      assert.equal(loadSkillPackage(booksRoot, 'evil'), null);
      assert.equal(loadSkillPackage(booksRoot, 'linked'), null);
      assert.equal(resolveSkillForMessage('/evil', booksRoot), null);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('appendActiveSkillPrompt', () => {
  it('appends an Active skill section', () => {
    const out = appendActiveSkillPrompt('Base system.', {
      id: 'summarize',
      name: 'Summarize',
      instructions: 'Be concise.',
    });
    assert.match(out, /^Base system\.\n\n## Active skill \/summarize \(Summarize\)/);
    assert.match(out, /Be concise\./);
    assert.match(out, /\/summarize/);
  });
});
