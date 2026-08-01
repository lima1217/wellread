/**
 * Reading Assistant helpers barrel — prefer importing from themed modules directly.
 * Theme map: gate / quoteWire / displayParts / cfiLinks / slashSkills / sessionUi.
 */

export {
  isReadingAssistantAvailable,
  type ReadingAssistantGate,
} from './gate';

export {
  formatPendingQuotesForTurn,
  parsePendingQuotesFromWire,
  type PendingQuoteForTurn,
} from '@wellread/quote-wire';

export {
  hydrateEveMessagesForDisplay,
  type HydrateableEveMessage,
} from './quoteWire';

export {
  summarizeToolTrace,
  coalesceAssistantParts,
  assistantPartInputsFromMessage,
  type ToolTraceEntry,
  type ToolTraceSummaryLabel,
  type ToolTraceSummary,
  type AssistantToolTrace,
  type AssistantPartInput,
  type AssistantDisplaySegment,
} from './displayParts';

export {
  isAssistantSourceHref,
  isExternalHttpHref,
  normalizeEpubCfi,
  resolveEveSource,
  formatEveSourceLabel,
  linkifyBareEpubCfi,
  stripAssistantCfiCitations,
  type EveSourceLike,
} from './cfiLinks';

export {
  shouldShowPendingReply,
  formatWorkDuration,
  shouldPushAgentSessionToStore,
} from './sessionUi';

export {
  SKILL_SLASH_PREFIX,
  getComposerSlashQuery,
  filterSkillsForSlash,
  applySlashSkillSelection,
} from './slashSkills';
