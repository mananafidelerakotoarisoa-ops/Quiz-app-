/**
 * srs.js — Phase 8 (Spaced Repetition)
 *
 * A self-contained SM-2-style scheduler layered on top of the existing
 * question pools. It does not touch state.js or the JSON datasets — it
 * only needs a question's `id` to track it.
 *
 * Storage shape (one localStorage key, mirrors the analytics.js pattern):
 *   mext_srs_cards = {
 *     [questionId]: {
 *       reps:     number,   // successful reps in a row (resets to 0 on quality < 3)
 *       ef:       number,   // "easiness factor", SM-2 style, floor 1.3
 *       interval:  number,  // days until next due date
 *       due:      number,   // epoch ms, midnight-aligned
 *       lastSeen: number,   // epoch ms of last response
 *     }
 *   }
 *
 * Quality scale (0–5), same convention as SuperMemo SM-2:
 *   0–2  fail / hard miss   → reps reset, shortest interval
 *   3    correct but shaky  → reps continue, interval grows slowly
 *   4    correct, normal    → standard growth
 *   5    correct, easy/fast → fastest growth
 *
 * Usage:
 *   import { initSRS, recordSRSResponse, getDueQuestions, getSRSStats } from './srs.js';
 *   initSRS();                                   // call once at boot
 *   recordSRSResponse(question.id, quality);      // call once per graded answer
 *   const due = getDueQuestions(pool, 10, 20);    // due cards first, padded from pool
 */

const KEY = 'mext_srs_cards';

/** @type {Object<string, {reps:number, ef:number, interval:number, due:number, lastSeen:number}>} */
let _cards = {};

/** Batches writes so a burst of answers (end of a quiz) only flushes once. */
let _flushPending = false;

function _load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function _scheduleFlush() {
  if (_flushPending) return;
  _flushPending = true;
  queueMicrotask(() => {
    _flushPending = false;
    try {
      localStorage.setItem(KEY, JSON.stringify(_cards));
    } catch (err) {
      console.warn('[SRS] Failed to persist cards:', err);
    }
  });
}

/**
 * Midnight-aligned timestamp, `days` from today, in local time.
 * Using local midnight (rather than `Date.now() + days*86400000`) means
 * "due tomorrow" always means tomorrow regardless of what hour today's
 * study session happens at — no creep across sessions.
 * @param {number} days
 * @returns {number} epoch ms
 */
function _midnightTimestamp(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Must be called once before recordSRSResponse / getDueQuestions are used. */
export function initSRS() {
  _cards = _load();
}

/**
 * Updates (or creates) the SRS record for a question and reschedules it.
 *
 * Interval growth, intentionally compressed compared to vanilla SM-2 —
 * this app is built for steady short review cycles, not multi-week gaps:
 *   rep 0–1 (just learned / just relapsed): 1 day
 *   rep 2                                : 2 days
 *   rep 3+                               : round(prevInterval × EF × 0.5), capped at 3 days
 * A struggling card (EF near the 1.3 floor) stays pinned to a 1-day
 * rotation since round(2 × 1.3 × 0.5) === 1 — it never escapes review
 * until accuracy actually improves.
 *
 * @param {string} id        Question id
 * @param {number} quality   0–5 (see scale above)
 */
export function recordSRSResponse(id, quality) {
  const q = Math.max(0, Math.min(5, quality));
  const now = Date.now();

  const prev = _cards[id] || { reps: 0, ef: 2.5, interval: 0, due: now, lastSeen: 0 };

  let ef = prev.ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ef < 1.3) ef = 1.3;

  let reps = prev.reps;
  let interval;

  if (q < 3) {
    // Fail: back to square one, but EF is retained (not reset) so a card
    // that was previously easy doesn't get punished as hard long-term.
    reps = 0;
    interval = 1;
  } else {
    reps += 1;
    if (reps <= 1) interval = 1;
    else if (reps === 2) interval = 2;
    else interval = Math.min(3, Math.round(prev.interval * ef * 0.5) || 1);
  }

  _cards[id] = {
    reps,
    ef: Math.round(ef * 100) / 100,
    interval,
    due: _midnightTimestamp(interval),
    lastSeen: now,
  };

  _scheduleFlush();
}

/**
 * Derives a 0–5 quality score from raw answer signals.
 * Exposed so quiz.js doesn't need to know the SM-2 scale's internals.
 *
 * @param {{ correct: boolean, hintUsed?: boolean, answerTimeMs?: number }} signal
 * @returns {number} 0–5
 */
export function deriveQuality({ correct, hintUsed = false, answerTimeMs = null }) {
  if (!correct) return hintUsed ? 0 : 1;

  // Soft time budget — questions in this app are short MCQs, so 20s is
  // generous "thinking it through" territory; beyond that, treat it as
  // shaky recall even though the answer was right.
  const SOFT_BUDGET_MS = 20000;
  const slow = typeof answerTimeMs === 'number' && answerTimeMs > SOFT_BUDGET_MS;

  if (hintUsed) return 3;
  if (slow) return 3;
  if (typeof answerTimeMs === 'number' && answerTimeMs < SOFT_BUDGET_MS * 0.35) return 5;
  return 4;
}

/**
 * @param {string} id
 * @returns {boolean} true if the card has never been seen, or its due date has passed
 */
export function isDue(id) {
  const card = _cards[id];
  if (!card) return true; // never studied → treat as due
  return card.due <= Date.now();
}

/** @param {string} id @returns {object|null} */
export function getCard(id) {
  return _cards[id] || null;
}

/**
 * Builds a review pool prioritizing due cards, padded out with
 * never-seen or not-yet-due questions so the session still hits `size`.
 *
 * @param {Array<Object>} sourcePool   Full question pool to pull from (must have `.id`)
 * @param {number} minDue              Minimum due cards required to bother returning a pool (else [])
 * @param {number} size                Target session size
 * @returns {Array<Object>} questions, due cards shuffled to the front
 */
export function getDueQuestions(sourcePool, minDue = 1, size = 20) {
  const due = [];
  const notDue = [];

  for (const q of sourcePool) {
    if (isDue(q.id)) due.push(q); else notDue.push(q);
  }

  if (due.length < minDue) return [];

  shuffle(due);
  shuffle(notDue);

  return due.concat(notDue).slice(0, size);
}

/**
 * @param {Array<Object>} sourcePool
 * @returns {{ dueCount: number, totalTracked: number, newCount: number }}
 */
export function getSRSStats(sourcePool) {
  let dueCount = 0;
  let newCount = 0;
  for (const q of sourcePool) {
    if (!_cards[q.id]) newCount++;
    else if (isDue(q.id)) dueCount++;
  }
  return {
    dueCount,
    newCount,
    totalTracked: Object.keys(_cards).length,
  };
}

/** Wipes all SRS scheduling data (kept separate from analytics.clearAll). */
export function clearSRS() {
  _cards = {};
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
