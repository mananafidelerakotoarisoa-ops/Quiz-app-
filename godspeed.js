/**
 * godspeed.js — Godspeed Mode ⚡
 *
 * Fully self-contained module. Owns:
 *  • Web Audio synthesis  (ticking clock + correct-answer chime)
 *  • 5-second countdown bar (CSS animation via JS)
 *  • Weighted point table  (JLPT/MEXT difficulty × subCategory)
 *  • Streak multiplier engine
 *  • Game-over screen logic
 *
 * Imported by quiz.js and exposed via window.App in main.js.
 */

import { state }    from './state.js';
import { analytics } from './analytics.js';

// ── DOM shorthand ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }

// ── Point table ───────────────────────────────────────────────────────────────
// [system][subCategory][difficulty] = base points
const POINT_TABLE = {
  japanese: {
    vocabulary:    { easy: 2,  medium: 4,  hard: 8  },
    grammar:       { easy: 3,  medium: 6,  hard: 12 },
    keigo:         { easy: 5,  medium: 10, hard: 20 },
    onomatopoeia:  { easy: 7,  medium: 14, hard: 28 },
  },
  english: {
    idiom:                { easy: 3,  medium: 6,  hard: 12 },
    preposition:          { easy: 2,  medium: 4,  hard: 8  },
    'dependent preposition': { easy: 2, medium: 4, hard: 8 },
    'preposition-verb':   { easy: 2,  medium: 4,  hard: 8  },
    'sv-agreement':       { easy: 2,  medium: 4,  hard: 8  },
    'error-correction':   { easy: 4,  medium: 8,  hard: 16 },
  },
};

/**
 * Returns the base points for a question.
 * Falls back to 2 pts if the subCategory is not in the table.
 * @param {Object} question
 * @param {'english'|'japanese'} system
 * @returns {number}
 */
export function getBasePoints(question, system) {
  const subKey  = question.subCategory.toLowerCase();
  const diffKey = (question.difficulty || 'easy').toLowerCase();
  const catTable = POINT_TABLE[system]?.[subKey];
  return catTable?.[diffKey] ?? 2;
}

// ── Streak multiplier ─────────────────────────────────────────────────────────
/**
 * Computes the multiplier for a given consecutive-correct streak count.
 *   0–2   → 1.0×
 *   3–5   → 1.5×
 *   6–9   → 2.0×
 *   10–19 → 3.0×
 *   20+   → 6.0×  (and continues scaling: every 10 above 20 adds 1×, uncapped)
 * @param {number} streak
 * @returns {number}
 */
export function getMultiplier(streak) {
  if (streak >= 20) return 6.0 + Math.floor((streak - 20) / 10);
  if (streak >= 10) return 3.0;
  if (streak >= 6)  return 2.0;
  if (streak >= 3)  return 1.5;
  return 1.0;
}

// ── Audio engine (Web Audio API, zero external files) ─────────────────────────
let _audioCtx = null;

function getAudioCtx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Safari / mobile browsers suspend the context until a user gesture.
  // All audio calls come from click handlers, so this resume is safe.
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

/**
 * Plays a single metronome-style tick.
 * Short sine burst at 880 Hz, fast decay — neutral and sharp.
 */
export function playTick() {
  const ctx  = getAudioCtx();
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type      = 'sine';
  osc.frequency.setValueAtTime(880, ctx.currentTime);

  gain.gain.setValueAtTime(0.18, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.07);
}

/**
 * Plays an escalating tension pulse as the clock gets critical (≤2 s).
 * Higher pitch + slightly louder to communicate danger.
 */
export function playUrgentTick() {
  const ctx  = getAudioCtx();
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = 'square';
  osc.frequency.setValueAtTime(1200, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.05);

  gain.gain.setValueAtTime(0.12, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.09);
}

/**
 * Plays a satisfying three-note ascending chime on correct answer.
 * C5 → E5 → G5, each 80 ms apart, triangle wave for a soft sparkle.
 */
export function playCorrectChime() {
  const ctx    = getAudioCtx();
  const notes  = [523.25, 659.25, 783.99]; // C5, E5, G5
  const offset = 0.0;

  notes.forEach((freq, i) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    const t = ctx.currentTime + offset + i * 0.08;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);

    osc.start(t);
    osc.stop(t + 0.25);
  });
}

/**
 * Plays a harsh low-frequency buzz on timeout / game over.
 */
export function playGameOverBuzz() {
  const ctx  = getAudioCtx();
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(110, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(55, ctx.currentTime + 0.4);

  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.55);
}

/**
 * Plays a softer "life lost" sound — distinct from full game-over buzz.
 * Lower pitch than game-over but clearly negative.
 */
function _playLoseLifeSound() {
  const ctx  = getAudioCtx();
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = 'square';
  osc.frequency.setValueAtTime(220, ctx.currentTime);
  osc.frequency.linearRampToValueAtTime(160, ctx.currentTime + 0.2);

  gain.gain.setValueAtTime(0.18, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.3);
}


export const gs = {
  active:          false,
  totalScore:      0,
  streak:          0,        // consecutive correct answers
  bestScore:       0,        // loaded from analytics on boot
  /** @type {number} Lives remaining this run */
  livesRemaining:  3,
  /** @type {number|null} setInterval handle for the per-question countdown */
  _countdownHandle: null,
  _secondsLeft:    5,
};

/** Resets per-run state (not bestScore). */
export function resetGodspeedState() {
  gs.active         = false;
  gs.totalScore     = 0;
  gs.streak         = 0;
  gs.livesRemaining = state.godspeedLives;
  _clearCountdown();
}

function _clearCountdown() {
  if (gs._countdownHandle !== null) {
    clearInterval(gs._countdownHandle);
    gs._countdownHandle = null;
  }
}

// ── Countdown bar ─────────────────────────────────────────────────────────────
/**
 * Starts the per-question countdown bar for the current question.
 * Duration comes from state.godspeedSeconds (set via the island's Speed
 * slider), falling back to 5s if unset.
 * On expiry, triggers game over.
 */
export function startGodspeedCountdown() {
  _clearCountdown();
  const total = state.godspeedSeconds || 5;
  gs._secondsLeft = total;

  // Reset the CSS bar immediately to full width
  const bar = $('godspeed-countdown-bar');
  if (bar) {
    // Reset instantly to full, then re-enable transition for subsequent ticks
    bar.style.transition = 'none';
    bar.style.width      = '100%';
    bar.offsetWidth;                        // force reflow
    bar.style.transition = 'width 1s linear';
    // Do NOT set a smaller width here — first interval tick handles the N→N-1 step
  }

  // Update the text counter
  _updateCountdownText(gs._secondsLeft);

  gs._countdownHandle = setInterval(() => {
    gs._secondsLeft--;

    _updateCountdownText(gs._secondsLeft);

    // Play audio cue
    if (gs._secondsLeft <= 2 && gs._secondsLeft > 0) {
      playUrgentTick();
    } else if (gs._secondsLeft > 2) {
      playTick();
    }

    // Move bar
    if (bar) {
      const pct = Math.max(0, (gs._secondsLeft / total) * 100);
      bar.style.width = `${pct}%`;
    }

    if (gs._secondsLeft <= 0) {
      _clearCountdown();
      gs.streak = 0;       // timeout resets streak like a wrong answer
      gs.livesRemaining--;
      _updateGodspeedHUD();
      _updateLivesDisplay();

      if (gs.livesRemaining <= 0) {
        playGameOverBuzz();
        triggerGodspeedGameOver('timeout');
      } else {
        _playLoseLifeSound();
        // Brief pause so user sees the lost life, then continue
        gs.active = false;
        setTimeout(() => {
          state.currentQuestionIndex++;
          window.App._godspeedRenderNext();
        }, 700);
      }
    }
  }, 1000);
}

function _updateCountdownText(secs) {
  const el = $('godspeed-countdown-text');
  if (el) {
    el.innerText = Math.max(0, secs);
    // Flash red when ≤2 seconds
    el.className = secs <= 2
      ? 'text-rose-600 dark:text-rose-400 font-black text-lg tabular-nums'
      : 'text-amber-600 dark:text-amber-400 font-black text-lg tabular-nums';
  }
}

// ── Game over ─────────────────────────────────────────────────────────────────
function triggerGodspeedGameOver(reason) {
  _clearCountdown();
  gs.active = false;

  // Persist high score
  if (gs.totalScore > gs.bestScore) {
    gs.bestScore = gs.totalScore;
    analytics.setGodspeedBest(gs.bestScore);
  }

  // Populate game-over card
  hide('quiz-card');
  show('godspeed-game-over-card');

  $('gs-final-score').innerText   = gs.totalScore;
  $('gs-best-score').innerText    = gs.bestScore;
  $('gs-final-streak').innerText  = gs.streak;

  // Show lives used
  const livesUsedEl = $('gs-lives-used');
  if (livesUsedEl) {
    const used = state.godspeedLives - gs.livesRemaining;
    livesUsedEl.innerText = used;
  }
  const livesTotalEl = $('gs-lives-total');
  if (livesTotalEl) livesTotalEl.innerText = state.godspeedLives;

  const reasonEl = $('gs-termination-reason');
  if (reasonEl) {
    if (reason === 'timeout') {
      reasonEl.innerText = gs.livesRemaining <= 0
        ? '⏱ All lives exhausted by timeouts.'
        : '⏱ Time expired — you ran out of seconds.';
    } else {
      reasonEl.innerText = gs.livesRemaining <= 0
        ? '✕ All lives lost — run terminated.'
        : '✕ Wrong answer — one mistake ends the run.';
    }
  }
}

// ── Answer handler (called from quiz.js) ──────────────────────────────────────
/**
 * Process an answer tap in Godspeed mode.
 * @param {number} selectedIndex
 * @param {Object} question
 * @param {HTMLElement} buttonEl  The tapped option button element
 */
export function handleGodspeedAnswer(selectedIndex, question, buttonEl) {
  if (!gs.active) return;
  gs.active = false;    // lock immediately — prevents double-tap within 480ms delay
  _clearCountdown();

  const isCorrect = selectedIndex === question.correctIndex;

  if (isCorrect) {
    // ── Correct ──────────────────────────────────────────────────────────
    gs.streak++;
    const base       = getBasePoints(question, state.currentSystem);
    const multiplier = getMultiplier(gs.streak);
    const earned     = Math.round(base * multiplier);
    gs.totalScore   += earned;

    // Visual feedback on button
    buttonEl.className =
      'w-full text-left p-4 rounded-xl border-2 border-emerald-500 bg-emerald-50/50 ' +
      'dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 font-bold text-sm ' +
      'flex items-center justify-between';

    // Show floating +pts popup
    _showPointsPopup(earned, multiplier, buttonEl);

    // Update HUD
    _updateGodspeedHUD();

    playCorrectChime();

    // Advance to next question after a brief moment so user sees the chime feedback
    setTimeout(() => {
      state.currentQuestionIndex++;
      // Re-import lazily to avoid circular — quiz.js sets this on window.App
      window.App._godspeedRenderNext();
    }, 480);

  } else {
    // ── Wrong answer — lose a life ────────────────────────────────────────
    gs.streak = 0;  // reset streak on mistake
    gs.livesRemaining--;

    buttonEl.className =
      'w-full text-left p-4 rounded-xl border-2 border-rose-500 bg-rose-50/50 ' +
      'dark:bg-rose-950/30 text-rose-900 dark:text-rose-200 font-bold text-sm ' +
      'flex items-center justify-between';

    // Briefly flash the correct answer
    const container = document.getElementById('options-container');
    if (container && container.children[question.correctIndex]) {
      container.children[question.correctIndex].className =
        'w-full text-left p-4 rounded-xl border-2 border-emerald-500 bg-emerald-50/30 ' +
        'font-semibold text-sm flex items-center justify-between';
    }

    // Update HUD and lives display
    _updateGodspeedHUD();
    _updateLivesDisplay();

    if (gs.livesRemaining <= 0) {
      // All lives gone — game over
      playGameOverBuzz();
      setTimeout(() => {
        triggerGodspeedGameOver('wrong');
      }, 600);
    } else {
      // Still have lives — play softer sound and continue
      _playLoseLifeSound();
      setTimeout(() => {
        state.currentQuestionIndex++;
        window.App._godspeedRenderNext();
      }, 700);
    }
  }
}

// ── Points popup ──────────────────────────────────────────────────────────────
function _showPointsPopup(pts, multiplier, anchorEl) {
  const popup = document.createElement('div');
  const multStr = multiplier > 1 ? ` ×${multiplier}` : '';
  popup.textContent = `+${pts}${multStr}`;
  popup.style.cssText = `
    position: fixed;
    font-size: 1.1rem;
    font-weight: 900;
    color: var(--accent);
    pointer-events: none;
    z-index: 9999;
    text-shadow: 0 1px 4px rgba(0,0,0,0.25);
    transition: transform 0.6s ease-out, opacity 0.6s ease-out;
  `;

  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = `${rect.right - 80}px`;
  popup.style.top  = `${rect.top - 4}px`;

  document.body.appendChild(popup);

  // Animate upward and fade
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      popup.style.transform = 'translateY(-40px)';
      popup.style.opacity   = '0';
    });
  });

  setTimeout(() => popup.remove(), 650);
}

// ── HUD update ────────────────────────────────────────────────────────────────
function _updateGodspeedHUD() {
  const scoreEl = $('godspeed-score-display');
  const multEl  = $('godspeed-multiplier-display');
  const streakEl = $('godspeed-streak-display');

  if (scoreEl)  scoreEl.innerText  = gs.totalScore;
  if (streakEl) streakEl.innerText = gs.streak;

  const mult = getMultiplier(gs.streak);
  if (multEl) {
    multEl.innerText = `${mult % 1 === 0 ? mult.toFixed(0) : mult}×`;
    multEl.className = mult >= 3
      ? 'font-black text-rose-500 dark:text-rose-400 tabular-nums text-sm'
      : mult >= 2
        ? 'font-black text-amber-500 dark:text-amber-400 tabular-nums text-sm'
        : mult >= 1.5
          ? 'font-black text-indigo-500 dark:text-indigo-400 tabular-nums text-sm'
          : 'font-black text-slate-400 dark:text-slate-500 tabular-nums text-sm';
  }
}

// ── Lives display ──────────────────────────────────────────────────────────────
function _updateLivesDisplay() {
  const el = $('godspeed-lives-display');
  if (!el) return;
  const total = state.godspeedLives;
  const remaining = gs.livesRemaining;
  let hearts = '';
  for (let i = 0; i < total; i++) {
    if (i < remaining) {
      hearts += '<i class="fa-solid fa-heart text-rose-500 text-xs"></i>';
    } else {
      hearts += '<i class="fa-regular fa-heart text-slate-400 dark:text-slate-600 text-xs"></i>';
    }
  }
  el.innerHTML = hearts;
}



/** Called by quiz.js startQuiz() when selectedMode === 'godspeed' */
export function startGodspeedMode() {
  resetGodspeedState();
  gs.active = true;
  gs.bestScore = analytics.getGodspeedBest();

  // Show Godspeed-specific header HUD
  show('godspeed-hud-container');
  hide('combo-streak-container');
  hide('exam-timer-container');

  _updateGodspeedHUD();
  _updateLivesDisplay();
}

/** Called by quiz.js after rendering a question in godspeed mode */
export function armCountdownForQuestion() {
  startGodspeedCountdown();
}

/** Called from the game-over card's "Try Again" button */
export function restartGodspeedMode() {
  hide('godspeed-game-over-card');
  // Re-trigger via window.App so quiz.js handles pool rebuild
  window.App.startQuiz();
}
