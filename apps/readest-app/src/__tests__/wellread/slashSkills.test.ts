import { describe, expect, it } from 'vitest';
import type { EveSkillSummary } from '@/services/wellread/assistant/eveClient';
import {
  applySlashSkillSelection,
  filterSkillsForSlash,
  getComposerSlashQuery,
} from '@/services/wellread/assistant/helpers';

const skills: EveSkillSummary[] = [
  {
    id: 'summarize',
    name: 'Summarize',
    description: 'Make a chapter summary',
    path: '/workspace/skills/summarize/SKILL.md',
    source: 'user',
  },
  {
    id: 'translate',
    name: 'Translate',
    description: 'Translate a passage',
    path: '/workspace/skills/translate/SKILL.md',
    source: 'user',
  },
];

describe('getComposerSlashQuery', () => {
  it('returns the token while typing a leading slash command', () => {
    expect(getComposerSlashQuery('/')).toBe('');
    expect(getComposerSlashQuery('/sum')).toBe('sum');
  });

  it('closes once args or non-slash text appear', () => {
    expect(getComposerSlashQuery('/summarize ')).toBeNull();
    expect(getComposerSlashQuery('hello')).toBeNull();
    expect(getComposerSlashQuery(' /sum')).toBeNull();
  });
});

describe('filterSkillsForSlash', () => {
  it('filters by id prefix and name/description substring', () => {
    expect(filterSkillsForSlash(skills, '').map((s) => s.id)).toEqual(['summarize', 'translate']);
    expect(filterSkillsForSlash(skills, 'sum').map((s) => s.id)).toEqual(['summarize']);
    expect(filterSkillsForSlash(skills, 'passage').map((s) => s.id)).toEqual(['translate']);
  });
});

describe('applySlashSkillSelection', () => {
  it('replaces the leading token and leaves a trailing space', () => {
    expect(applySlashSkillSelection('/sum', 'summarize')).toBe('/summarize ');
    expect(applySlashSkillSelection('/summarize extra', 'summarize')).toBe('/summarize extra');
  });
});
