'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { CheckIcon, Loader2Icon } from 'lucide-react';
import clsx from 'clsx';

import { useTranslation } from '@/hooks/useTranslation';
import { listEveSkills, type EveSkillSummary } from '@/services/wellread/assistant/eveClient';
import {
  applySlashSkillSelection,
  filterSkillsForSlash,
  getComposerSlashQuery,
  SKILL_SLASH_PREFIX,
} from '@/services/wellread/assistant/slashSkills';
import { focusRing } from './AssistantMarkdown';

/** Composer toolbar selects: flat ghost, not filled pills. */
export const composerSelectTrigger = clsx(
  'text-base-content/55 hover:text-base-content hover:bg-base-200/70',
  'flex h-7 items-center gap-0.5 rounded-md ps-2 pe-1.5 text-[0.85em] leading-tight whitespace-nowrap',
  'transition-colors duration-150',
);
export const composerSelectMenu = clsx(
  'dropdown-content no-triangle border-base-200 bg-base-100 eink-bordered',
  'z-20 mb-1.5 overflow-y-auto overscroll-contain !rounded-[10px] border !p-1 font-sans',
  '!shadow-[0_1px_2px_oklch(0_0_0/0.06),0_4px_14px_oklch(0_0_0/0.08)]',
);
export const composerSelectItem = clsx(
  'hover:bg-base-200/80 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5',
  'text-start text-[0.85em] leading-snug transition-colors duration-150',
);
export const composerSelectItemActive = 'bg-base-200/70 text-base-content hover:bg-base-200/80';

export function ComposerSelectCheck({ active }: { active: boolean }) {
  return (
    <span className='flex size-3.5 shrink-0 items-center justify-center' aria-hidden='true'>
      {active ? <CheckIcon size={14} strokeWidth={2.25} className='text-base-content/55' /> : null}
    </span>
  );
}

export type ComposerSlashState = {
  composerRef: RefObject<HTMLTextAreaElement | null>;
  slashOpen: boolean;
  slashMatches: EveSkillSummary[];
  activeSlashIndex: number;
  skills: EveSkillSummary[];
  skillsLoaded: boolean;
  skillsError: boolean;
  setSlashIndex: (index: number | ((index: number) => number)) => void;
  selectSlashSkill: (skillId: string) => void;
  handleComposerChange: (value: string) => void;
  handleComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
};

export function useComposerSlash({
  composer,
  setComposer,
  busy,
  onSubmit,
}: {
  composer: string;
  setComposer: (value: string) => void;
  busy: boolean;
  onSubmit: () => void;
}): ComposerSlashState {
  const [skills, setSkills] = useState<EveSkillSummary[]>([]);
  const [skillsLoaded, setSkillsLoaded] = useState(false);
  const [skillsError, setSkillsError] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const slashQuery = getComposerSlashQuery(composer);
  const slashOpen = slashQuery !== null && !slashDismissed;
  const slashMatches = slashOpen ? filterSkillsForSlash(skills, slashQuery) : [];
  const activeSlashIndex =
    slashMatches.length === 0 ? 0 : Math.min(slashIndex, slashMatches.length - 1);

  useEffect(() => {
    if (!slashOpen) return;
    let cancelled = false;
    setSkillsLoaded(false);
    setSkillsError(false);
    void listEveSkills()
      .then((rows) => {
        if (cancelled) return;
        setSkills(rows);
        setSlashIndex(0);
        setSkillsError(false);
        setSkillsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSkills([]);
        setSlashIndex(0);
        setSkillsError(true);
        setSkillsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [slashOpen]);

  const selectSlashSkill = useCallback(
    (skillId: string) => {
      setComposer(applySlashSkillSelection(composer, skillId));
      setSlashIndex(0);
    },
    [composer, setComposer],
  );

  const handleComposerChange = useCallback(
    (value: string) => {
      setSlashDismissed(false);
      setSlashIndex(0);
      setComposer(value);
    },
    [setComposer],
  );

  const handleComposerKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (slashOpen) {
        if (!skillsLoaded) {
          if (
            (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) ||
            e.key === 'Tab' ||
            e.key === 'ArrowDown' ||
            e.key === 'ArrowUp'
          ) {
            e.preventDefault();
            return;
          }
        } else if (slashMatches.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSlashIndex((i) => (i + 1) % slashMatches.length);
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            const skill = slashMatches[activeSlashIndex];
            if (skill) selectSlashSkill(skill.id);
            return;
          }
          if (e.key === 'Tab') {
            e.preventDefault();
            const skill = slashMatches[activeSlashIndex];
            if (skill) selectSlashSkill(skill.id);
            return;
          }
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setSlashDismissed(true);
          return;
        }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (busy) return;
        onSubmit();
      }
    },
    [activeSlashIndex, busy, onSubmit, selectSlashSkill, slashMatches, slashOpen, skillsLoaded],
  );

  return {
    composerRef,
    slashOpen,
    slashMatches,
    activeSlashIndex,
    skills,
    skillsLoaded,
    skillsError,
    setSlashIndex,
    selectSlashSkill,
    handleComposerChange,
    handleComposerKeyDown,
  };
}

export function ComposerSlashMenu({
  open,
  skills,
  skillsLoaded,
  skillsError,
  slashMatches,
  activeSlashIndex,
  onSetIndex,
  onSelect,
}: {
  open: boolean;
  skills: EveSkillSummary[];
  skillsLoaded: boolean;
  skillsError: boolean;
  slashMatches: EveSkillSummary[];
  activeSlashIndex: number;
  onSetIndex: (index: number) => void;
  onSelect: (skillId: string) => void;
}) {
  const _ = useTranslation();
  if (!open) return null;
  return (
    <div
      className={clsx(
        'border-base-200/70 bg-base-100 absolute inset-x-0 bottom-full z-10 mb-1 overflow-hidden',
        'eink-bordered rounded-[10px] border p-1 shadow-[0_1px_2px_oklch(0_0_0/0.06),0_4px_14px_oklch(0_0_0/0.08)]',
      )}
      role='listbox'
      aria-label={_('Skills')}
    >
      {!skillsLoaded ? (
        <div className='text-base-content/45 flex items-center gap-2 px-2 py-1.5 font-sans text-[0.85em]'>
          <Loader2Icon size={14} className='animate-spin opacity-60' aria-hidden='true' />
          {_('Loading skills…')}
        </div>
      ) : skillsError ? (
        <div className='text-base-content/45 px-2 py-1.5 font-sans text-[0.85em]'>
          {_('Could not load skills')}
        </div>
      ) : skills.length === 0 ? (
        <div className='text-base-content/45 px-2 py-1.5 font-sans text-[0.85em]'>
          {_('No skills yet')}
        </div>
      ) : slashMatches.length === 0 ? (
        <div className='text-base-content/45 px-2 py-1.5 font-sans text-[0.85em]'>
          {_('No matching skills')}
        </div>
      ) : (
        <ul className='max-h-48 overflow-y-auto overscroll-contain'>
          {slashMatches.map((skill, index) => {
            const active = index === activeSlashIndex;
            return (
              <li
                key={skill.id}
                role='option'
                aria-selected={active}
                tabIndex={0}
                className={clsx(composerSelectItem, focusRing, active && composerSelectItemActive)}
                onMouseEnter={() => onSetIndex(index)}
                onClick={() => onSelect(skill.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(skill.id);
                  }
                }}
              >
                <span className='min-w-0 flex-1 text-start'>
                  <span className='text-base-content block truncate font-medium'>
                    {`/${SKILL_SLASH_PREFIX}${skill.id}`}
                  </span>
                  <span className='text-base-content/50 block truncate text-[0.85em] leading-snug'>
                    {skill.description || skill.name}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
