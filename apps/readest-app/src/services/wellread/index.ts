export {
  WORKSPACE_ROOT,
  WRITABLE_DIR,
  authorizeRead,
  authorizeWrite,
  authorizeWellreadSearch,
} from './scopedFs';
export { createBooksFsSession } from './booksFsSession';
export { wellreadBooksBackend } from './booksBackend';
export { globWellread, grepWellread } from './search/wellreadSearch';
export { ensureBookExtract } from './extract/ensureBookExtract';
export { ensureExtractForOpenedBook } from './extract/ensureExtractForOpenedBook';
export {
  DEFAULT_MODEL_CONFIG,
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_NAME,
  LEGACY_MODEL_API_KEY_SECURE_ITEM,
  createDefaultProfile,
  getActiveProfile,
  mergeModelConfig,
  modelApiKeySecureItem,
  normalizeModelApiMode,
  addProfile,
  removeProfile,
  renameProfile,
  resetDeepSeekDefaults,
  setActiveProfile,
  shouldHotReloadEve,
  toSidecarModelPayload,
  updateProfile,
  type ModelApiMode,
  type ModelConfig,
  type ModelProfile,
} from './modelConfig';
export { parseEveListenUrl } from './eveListen';
export { testModelConnection } from './testModelConnection';
export { clearModelApiKey, getModelApiKey, setModelApiKey } from './modelApiKey';
export { getEveSidecarInfo, reloadEveSidecar, type EveSidecarInfo } from './eveSidecar';
export { syncEveSidecarApiKey } from './syncEveSidecarApiKey';
export { useEveConnectionStore } from './eveConnectionStore';
export {
  isReadingAssistantAvailable,
  formatAskAboutDraft,
  buildReadingAssistantSystemPrompt,
  extractSourcesFromChunkMarkdown,
  summarizeToolTrace,
} from './assistant/helpers';
export { useReadingAssistantStore } from './assistant/readingAssistantStore';
export { useEveAgent } from './assistant/useEveAgent';
