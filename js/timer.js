/**
 * timer.js — Phase 3
 * Owns the exam-countdown interval.  Nothing outside this module
 * should call clearInterval() directly; use stopTimer() instead.
 *
 * This fixes the bug where triggerComboTerminalSequence() called
 * clearInterval(examTimerInterval) but examTimerInterval was never
 * set in Combo mode, making the call a silent no-op and leaving the
 * interval reference stale.
 *
 * Usage:
 *   import { startTimer, stopTimer } from './timer.js';
 */

import { state } from './state.js';

// Module-private handle — not exposed to the rest of the app.
let _intervalHandle = null;

/**
 * Starts a 60-minute countdown.
 *
 * @param {Function} onTick  Called every second with (minutesStr, secondsStr).
 * @param {Function} onExpire  Called once when the timer reaches 0.
 */
export function startTimer(onTick, onExpire) {
  stopTimer();                        // Always clear any lingering timer first.
  state.secondsRemaining = 3600;

  _intervalHandle = setInterval(() => {
    state.secondsRemaining--;

    if (state.secondsRemaining <= 0) {
      stopTimer();
      onExpire();
    } else {
      const mins = String(Math.floor(state.secondsRemaining / 60)).padStart(2, '0');
      const secs = String(state.secondsRemaining % 60).padStart(2, '0');
      onTick(mins, secs);
    }
  }, 1000);

  // Store on state so external code can read whether a timer is running,
  // but actual clearing MUST go through stopTimer().
  state.examTimerInterval = _intervalHandle;
}

/**
 * Safely stops the timer regardless of whether one is running.
 * Safe to call in Combo mode (where no timer was started) — it is a no-op.
 */
export function stopTimer() {
  if (_intervalHandle !== null) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
  state.examTimerInterval = null;
}

/**
 * Returns true if a countdown is currently running.
 * @returns {boolean}
 */
export function isTimerRunning() {
  return _intervalHandle !== null;
}
