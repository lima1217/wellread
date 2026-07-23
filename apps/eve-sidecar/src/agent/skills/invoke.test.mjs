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
  expandSkillCommand,
  formatSkillInvocation,
  loadSkillPackage,
  parseSkillBlock,
  parseSlashInvocation,
  resolveSkillForMessage,
} from './invoke.mjs';

describe('parseSlashInvocation', () => {
  it('parses /skill:id and optional rest', () => {
    assert.deepEqual(parseSlashInvocation('/skill:summarize'), {
      skillId: 'summarize',
      rest: '',
    });
    assert.deepEqual(parseSlashInvocation('  /skill:summarize  this chapter  '), {
      skillId: 'summarize',
      rest: 'this chapter',
    });
  });

  it('reads the slash command from the question after Pending Quote blocks', () => {
    assert.deepEqual(
      parseSlashInvocation('> Ahab\n> — 《Ch1》\n\n/skill:summarize this'),
      { skillId: 'summarize', rest: 'this' },
    );
  });

  it('keeps /skill:id when the question has blank lines after Pending Quotes', () => {
    assert.deepEqual(
      parseSlashInvocation('> Ahab\n> — 《Ch1》\n\n/skill:summarize\n\nPlease be brief.'),
      { skillId: 'summarize', rest: 'Please be brief.' },
    );
  });

  it('returns null when not a /skill: command', () => {
    assert.equal(parseSlashInvocation('hello'), null);
    assert.equal(parseSlashInvocation('/'), null);
    assert.equal(parseSlashInvocation('/summarize'), null);
    assert.equal(parseSlashInvocation('say /skill:summarize'), null);
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
      assert.equal(resolveSkillForMessage('/skill:missing', booksRoot), null);
      assert.equal(resolveSkillForMessage('/summarize please', booksRoot), null);
      assert.equal(resolveSkillForMessage('/skill:summarize please', booksRoot)?.id, 'summarize');
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
      assert.equal(resolveSkillForMessage('/skill:evil', booksRoot), null);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('formatSkillInvocation / expandSkillCommand', () => {
  it('formats a Pi-style <skill> block with optional args', () => {
    const out = formatSkillInvocation(
      {
        id: 'summarize',
        path: '/workspace/skills/summarize/SKILL.md',
        instructions: 'Be concise.',
      },
      'this chapter',
    );
    assert.equal(
      out,
      [
        '<skill name="summarize" location="/workspace/skills/summarize/SKILL.md">',
        'References are relative to /workspace/skills/summarize.',
        '',
        'Be concise.',
        '</skill>',
        '',
        'this chapter',
      ].join('\n'),
    );
  });

  it('expands /skill:id into modelMessage and keeps displayMessage as slash form', () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-invoke-')));
    try {
      mkdirSync(join(booksRoot, 'skills', 'summarize'), { recursive: true });
      writeFileSync(
        join(booksRoot, 'skills', 'summarize', 'SKILL.md'),
        '---\nname: Summarize\ndescription: Make a summary\n---\nBe concise.\n',
      );
      const result = expandSkillCommand('/skill:summarize this chapter', booksRoot);
      assert.equal(result.displayMessage, '/skill:summarize this chapter');
      assert.equal(result.skill?.id, 'summarize');
      assert.match(result.modelMessage, /^<skill name="summarize"/);
      assert.match(result.modelMessage, /Be concise\./);
      assert.match(result.modelMessage, /\n\nthis chapter$/);
      assert.equal(parseSkillBlock(result.modelMessage)?.userMessage, 'this chapter');
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('preserves Pending Quote blocks when expanding the question', () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-invoke-')));
    try {
      mkdirSync(join(booksRoot, 'skills', 'summarize'), { recursive: true });
      writeFileSync(
        join(booksRoot, 'skills', 'summarize', 'SKILL.md'),
        '---\nname: Summarize\ndescription: Make a summary\n---\nBe concise.\n',
      );
      const wire = '> Ahab\n> — 《Ch1》\n\n/skill:summarize this';
      const result = expandSkillCommand(wire, booksRoot);
      assert.equal(result.displayMessage, wire);
      assert.match(result.modelMessage, /^> Ahab\n> — 《Ch1》\n\n<skill name="summarize"/);
      assert.match(result.modelMessage, /\n\nthis$/);
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });

  it('passes through unknown slash ids unchanged', () => {
    const booksRoot = realpathSync(mkdtempSync(join(tmpdir(), 'wellread-invoke-')));
    try {
      mkdirSync(join(booksRoot, 'skills'), { recursive: true });
      const result = expandSkillCommand('/skill:nope', booksRoot);
      assert.equal(result.skill, null);
      assert.equal(result.modelMessage, '/skill:nope');
      assert.equal(result.displayMessage, '/skill:nope');
    } finally {
      rmSync(booksRoot, { recursive: true, force: true });
    }
  });
});

describe('parseSkillBlock', () => {
  it('parses skill content and trailing user message', () => {
    const text = [
      '<skill name="summarize" location="/workspace/skills/summarize/SKILL.md">',
      'References are relative to /workspace/skills/summarize.',
      '',
      'Be concise.',
      '</skill>',
      '',
      'this chapter',
    ].join('\n');
    assert.deepEqual(parseSkillBlock(text), {
      name: 'summarize',
      location: '/workspace/skills/summarize/SKILL.md',
      content: 'References are relative to /workspace/skills/summarize.\n\nBe concise.',
      userMessage: 'this chapter',
    });
  });
});
