/**
 * Availability gate for Reading Assistant UI.
 */

export type ReadingAssistantGate = {
  modelEnabled: boolean;
  sidecarReady: boolean;
  /** Valid `activeProfileId` that resolves to a profile row. */
  hasActiveProfile: boolean;
  /** Non-empty keychain apiKey for the active profile. */
  hasApiKey: boolean;
};

/** AI available = enabled + sidecar ready + valid active profile + that profile's key. */
export function isReadingAssistantAvailable(gate: ReadingAssistantGate): boolean {
  return gate.modelEnabled && gate.sidecarReady && gate.hasActiveProfile && gate.hasApiKey;
}
