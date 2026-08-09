import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canonicalBundledSkillRel,
  isBundledOnlySkillRel,
  normalizeSkillRel,
  preferBundledSkillRel,
} from './index.mjs';

describe('skill-contract bundled-only paths', () => {
  it('normalizes separators and case', () => {
    assert.equal(normalizeSkillRel('PACKAGE.md'), 'package.md');
    assert.equal(normalizeSkillRel('Tools\\\\x'), 'tools/x');
  });

  it('pins PACKAGE.md / AGENTS.md / tools/* case-insensitively', () => {
    assert.equal(isBundledOnlySkillRel('package.md'), true);
    assert.equal(isBundledOnlySkillRel('AGENTS.md'), true);
    assert.equal(isBundledOnlySkillRel('tools/validate.py'), true);
    assert.equal(isBundledOnlySkillRel('SKILL.md'), false);
    assert.equal(preferBundledSkillRel('PACKAGE.md'), true);
  });

  it('canonicalizes bundled-only names for on-disk bundled reads', () => {
    assert.equal(canonicalBundledSkillRel('package.md'), 'PACKAGE.md');
    assert.equal(canonicalBundledSkillRel('Agents.md'), 'AGENTS.md');
    assert.equal(canonicalBundledSkillRel('Tools/x'), 'tools/x');
  });
});
