/**
 * Prepare one user wire message for session storage vs model input.
 * Owns peel → skill expand → strip order so runTurn does not.
 */

import {
  parsePendingQuotesFromWire,
  stripLeadingQuoteBlocks,
} from './prompt.mjs';
import { expandSkillCommand } from './skills/invoke.mjs';

/**
 * @param {string} userMessage
 * @param {() => string} getBooksRoot
 * @returns {{
 *   sessionContent: string,
 *   modelContent: string,
 *   quotes: Array<{ text: string, chapterTitle?: string | null }>,
 * }}
 */
export function prepareUserTurn(userMessage, getBooksRoot) {
  const { quotes } = parsePendingQuotesFromWire(userMessage);
  // Session / UI keep the slash form; only the model turn is expanded (Pi-style).
  // Quotes move into <reading_context>; model user text is quote-free.
  let modelContent = userMessage;
  try {
    modelContent = expandSkillCommand(userMessage, getBooksRoot()).modelMessage;
  } catch {
    // Missing books root or FS errors: send the original slash text.
  }
  // Empty is intentional when the turn is quote-only — quotes live in the envelope.
  modelContent = stripLeadingQuoteBlocks(modelContent);
  return {
    sessionContent: userMessage,
    modelContent,
    quotes,
  };
}
