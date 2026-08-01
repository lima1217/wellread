import { describe, expect, it } from 'vitest';
import type { EveSkillSummary } from '@/services/wellread/assistant/eveClient';
import {
  applySlashSkillSelection,
  filterSkillsForSlash,
  getComposerSlashQuery,
} from '@/services/wellread/assistant/slashSkills';

const skills: EveSkillSummary[] = [
  {
    id: 'summarize',
    name: 'Summarize',
    description: 'Make a chapter summary',
    path: '/workspace/skills/summarize/SKILL.md',
    source: 'user',
    enabled: true,
  },
  {
    id: 'translate',
    name: 'Translate',
    description: 'Translate a passage',
    path: '/workspace/skills/translate/SKILL.md',
    source: 'user',
    enabled: true,
  },
];

describe('getComposerSlashQuery', () => {
  it('returns the filter while typing a leading slash command', () => {
    expect(getComposerSlashQuery('/')).toBe('');
    expect(getComposerSlashQuery('/sum')).toBe('sum');
    expect(getComposerSlashQuery('/skill:')).toBe('');
    expect(getComposerSlashQuery('/skill:sum')).toBe('sum');
  });

  it('closes once args or non-slash text appear', () => {
    expect(getComposerSlashQuery('/skill:summarize ')).toBeNull();
    expect(getComposerSlashQuery('hello')).toBeNull();
    expect(getComposerSlashQuery(' /skill:sum')).toBeNull();
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
  it('replaces the leading token with /skill:<id> and leaves a trailing space', () => {
    expect(applySlashSkillSelection('/sum', 'summarize')).toBe('/skill:summarize ');
    expect(applySlashSkillSelection('/skill:sum', 'summarize')).toBe('/skill:summarize ');
    expect(applySlashSkillSelection('/skill:summarize extra', 'summarize')).toBe(
      '/skill:summarize extra',
    );
  });
});
