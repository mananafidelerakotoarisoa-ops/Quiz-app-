/**
 * state.js — Phase 2
 * Single module that owns every mutable runtime variable.
 * Import this everywhere instead of using globals.
 *
 * Usage:
 *   import { state, resetQuizState, resetComboState } from './state.js';
 */

export const state = {
  // ── Data ──────────────────────────────────────────────────────────────────
  /** @type {Array<Object>} Full English question pool loaded from JSON */
  baselineQuizData: [],
  /** @type {Array<Object>} Full Japanese question pool loaded from JSON */
  japaneseQuizData: [],

  // ── Session config ────────────────────────────────────────────────────────
  /** @type {'english'|'japanese'} Active language system */
  currentSystem: 'japanese',
  /** @type {'practice'|'exam'|'combo'|'godspeed'} Selected quiz mode */
  selectedMode: 'practice',
  /** @type {'all'|'preposition'|'sv-agreement'|'idiom'|'error-correction'} */
  configFocus: 'all',
  /** @type {'all'|'grammar'|'onomatopoeia'|'vocabulary'|'keigo'} */
  configJapaneseFocus: 'all',
  /** @type {'any'|'easy'|'medium'|'hard'} */
  configDifficulty: 'any',

  // ── Quiz runtime ──────────────────────────────────────────────────────────
  /** @type {Array<Object>} Filtered + shuffled pool for the current session */
  activeQuizPool: [],
  currentQuestionIndex: 0,
  score: 0,
  /** @type {number|null} Index of the option the user has selected */
  selectedOption: null,
  /** @type {Array<{question:Object, selected:number|null, correct:boolean, hintUsed?:boolean, answerTimeMs?:number}>} */
  userAnswers: [],

  // ── SRS per-question timing (Phase 8) ──────────────────────────────────────
  /** @type {number|null} Date.now() when the current question was rendered */
  questionRenderedAt: null,
  /** @type {boolean} Whether the hint was opened for the current question */
  hintUsedCurrent: false,

  // ── Bookmarks ─────────────────────────────────────────────────────────────
  /** @type {Set<string>} Question IDs the user has starred */
  bookmarkedQuestionIds: new Set(),

  // ── Combo mode ────────────────────────────────────────────────────────────
  comboActive: false,
  comboStreak: 0,
  comboBest: 0,

  // ── Godspeed config ───────────────────────────────────────────────────────
  /** @type {1|2|3|4|5} Number of lives the player chose for Godspeed */
  godspeedLives: 3,
  /** @type {'all'|string} Focus filter for Godspeed mode */
  godspeedFocus: 'all',
  /** @type {number} Per-question countdown duration (seconds) for Godspeed mode */
  godspeedSeconds: 5,

  // ── Exam timer ────────────────────────────────────────────────────────────
  /** @type {number|null} setInterval handle — always clear this via timer.js */
  examTimerInterval: null,
  secondsRemaining: 3600,

  // ── Per-session sub-category accumulators (for the results screen) ────────
  categoryScores: { preps: 0, sv: 0, idioms: 0, err: 0 },
  japaneseCategoryScores: { grammar: 0, onomatopoeia: 0, vocabulary: 0, keigo: 0 },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resets all fields that are specific to a single quiz run.
 * Call this at the top of startQuiz() before building the new pool.
 */
export function resetQuizState() {
  state.currentQuestionIndex = 0;
  state.score = 0;
  state.selectedOption = null;
  state.userAnswers = [];
  state.questionRenderedAt = null;
  state.hintUsedCurrent = false;
  state.categoryScores = { preps: 0, sv: 0, idioms: 0, err: 0 };
  state.japaneseCategoryScores = { grammar: 0, onomatopoeia: 0, vocabulary: 0, keigo: 0 };
}

/**
 * Resets combo-specific counters (streak but not the all-time best).
 * Call this at the start of every new combo run.
 */
export function resetComboState() {
  state.comboStreak = 0;
  state.comboActive = false;
}
