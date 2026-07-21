import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TURN_IN_FLIGHT_BODY,
  createTurnInFlightGate,
} from './turnInFlight.mjs';

describe('createTurnInFlightGate', () => {
  it('acquires a free session and rejects a second acquire', () => {
    const gate = createTurnInFlightGate();
    assert.equal(gate.tryAcquire('s1'), true);
    assert.equal(gate.tryAcquire('s1'), false);
    assert.equal(gate.tryAcquire('s2'), true);
  });

  it('allows re-acquire after release', () => {
    const gate = createTurnInFlightGate();
    assert.equal(gate.tryAcquire('s1'), true);
    gate.release('s1');
    assert.equal(gate.tryAcquire('s1'), true);
  });

  it('exposes the 409 conflict body contract', () => {
    assert.deepEqual(TURN_IN_FLIGHT_BODY, { error: 'turn_in_flight' });
  });
});
