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
  MODEL_API_KEY_SECURE_ITEM,
  mergeModelConfig,
  resetDeepSeekDefaults,
  type ModelConfig,
} from './modelConfig';
export { parseEveListenUrl } from './eveListen';
export { testModelConnection } from './testModelConnection';
export { getModelApiKey, setModelApiKey } from './modelApiKey';
export { getEveSidecarInfo, reloadEveSidecar, type EveSidecarInfo } from './eveSidecar';
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
