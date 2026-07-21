/** Per-session mutex for POST /turns — busy sessions get 409, no queue. */

export const TURN_IN_FLIGHT_BODY = Object.freeze({ error: 'turn_in_flight' });

export function createTurnInFlightGate() {
  /** @type {Set<string>} */
  const busy = new Set();
  return {
    tryAcquire(sessionId) {
      if (busy.has(sessionId)) return false;
      busy.add(sessionId);
      return true;
    },
    release(sessionId) {
      busy.delete(sessionId);
    },
  };
}
