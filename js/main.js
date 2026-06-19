/**
 * main.js — Phase 5 + Phase 7 entry point
 *
 * This is the ONLY <script type="module"> tag in index.html.
 *
 * Responsibilities:
 *  1. Theme init (read from analytics, apply dark class)
 *  2. Load question data (Phase 1 fetch pattern, Phase 5 module)
 *  3. Restore bookmarks and combo best from analytics
 *  4. Initialise the welcome screen
 *  5. Expose a `window.App` bridge so all onclick="" attributes in
 *     index.html keep working without any HTML changes (Phase 5)
 *  6. Register the Service Worker for offline caching (Phase 7)
 */

import { state }               from './state.js';
import { analytics }           from './analytics.js';
import { loadSystemDatabases } from './loader.js';
import { initSRS }             from './srs.js';
import {
  selectSystem,
  selectMode,
  setFocus,
  setJapaneseFocus,
  setDifficulty,
  startQuiz,
  nextQuestion,
  toggleHint,
  toggleFlagCurrent,
  updatePoolVal,
  updateBookmarkIndicator,
  startBookmarkedQuiz,
  startSRSReviewQuiz,
  restartQuiz,
  restartComboModeOnly,
  backToWelcome,
  clearHistory,
  loadPerformanceAnalysis,
  updateSystemPoolIndicator,
  restartGodspeedMode,
  godspeedRenderNext,
  setGodspeedLives,
  setGodspeedFocus,
  setGodspeedSeconds,
} from './quiz.js';

// ── 1. Theme ──────────────────────────────────────────────────────────────────

function initTheme() {
  const saved = analytics.getTheme();
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = saved === 'dark' || (saved === null && prefersDark);

  if (isDark) {
    document.documentElement.classList.add('dark');
    document.getElementById('theme-icon').className = 'fa-solid fa-sun';
  } else {
    document.documentElement.classList.remove('dark');
    document.getElementById('theme-icon').className = 'fa-solid fa-moon';
  }
}

function toggleTheme() {
  document.documentElement.classList.toggle('dark');
  const isDark = document.documentElement.classList.contains('dark');
  analytics.setTheme(isDark ? 'dark' : 'light');
  document.getElementById('theme-icon').className = isDark
    ? 'fa-solid fa-sun'
    : 'fa-solid fa-moon';
}

// ── 2–4. Boot ─────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  initSRS();

  // Restore bookmarks
  state.bookmarkedQuestionIds = analytics.getBookmarks();

  // Restore combo best
  state.comboBest = analytics.getBestCombo();

  // Fetch question data
  try {
    await loadSystemDatabases();
  } catch (err) {
    console.error('[MEXT] Data load error:', err);
    const card = document.getElementById('welcome-card');
    if (card) {
      const notice = document.createElement('div');
      notice.className =
        'mt-4 p-4 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 ' +
        'rounded-2xl text-rose-700 dark:text-rose-300 text-sm font-medium text-center';
      notice.innerHTML =
        '<i class="fa-solid fa-triangle-exclamation mr-2"></i>' +
        'Could not load question data. Please ensure the <code>data/</code> folder is present and reload.';
      card.prepend(notice);
    }
    return;
  }

  // Initialise welcome screen for Japanese (default)
  selectSystem('japanese');
  updateBookmarkIndicator();
});

// ── Godspeed Dynamic Island UI helpers ────────────────────────────────────────

let _gsIslandOpen = false;

function toggleGodspeedIsland(e) {
  // Always select Godspeed mode
  selectMode('godspeed');

  // Toggle the island panel
  _gsIslandOpen = !_gsIslandOpen;
  const panel    = document.getElementById('gs-island-settings');
  const chevron  = document.getElementById('gs-island-chevron');
  const card     = document.getElementById('mode-godspeed-card');

  if (_gsIslandOpen) {
    panel.classList.add('open');
    if (chevron) chevron.style.transform = 'rotate(180deg)';
    card.classList.add('island-open');
    // Also close the normal desc panel when island opens
    const desc = document.getElementById('mode-godspeed-desc');
    if (desc) desc.classList.remove('open');
  } else {
    panel.classList.remove('open');
    if (chevron) chevron.style.transform = '';
    card.classList.remove('island-open');
  }

  // Sync focus picker with current system
  _syncGsFociVisibility();
}

function _syncGsFociVisibility() {
  const isJa = document.getElementById('system-ja-btn')?.className.includes('shadow-md');
  const enDiv = document.getElementById('gs-foci-english');
  const jaDiv = document.getElementById('gs-foci-japanese');
  if (enDiv) enDiv.classList.toggle('hidden', isJa);
  if (jaDiv) jaDiv.classList.toggle('hidden', !isJa);
}

function _setGodspeedLivesUI(n, e) {
  if (e) e.stopPropagation();
  setGodspeedLives(n);
  // Update button states
  document.querySelectorAll('.gs-lives-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.lives) === n);
  });
  const label = document.getElementById('gs-lives-label');
  if (label) label.textContent = `${n} ${n === 1 ? 'life' : 'lives'}`;
}

function _setGodspeedSecondsUI(val, e) {
  if (e) e.stopPropagation();
  const n = parseInt(val, 10) || 5;
  setGodspeedSeconds(n);
  const label = document.getElementById('gs-seconds-label');
  if (label) label.textContent = `${n}s`;
}

function setGodspeedFocusChip(focus, e) {
  if (e) e.stopPropagation();
  setGodspeedFocus(focus);
  // Update chip states in both focus groups
  document.querySelectorAll('.gs-focus-chip').forEach(chip => {
    const chipFocus = chip.getAttribute('onclick').match(/'([^']+)'/)?.[1] || 'all';
    chip.classList.toggle('active', chipFocus === focus);
  });
}


//
// All onclick="" attributes in index.html call window.App.*
// This avoids touching any HTML while still using ES modules.
// Add toggleTheme here too since it's defined in this file.

window.App = {
  // Theme
  toggleTheme,

  // System & mode selectors
  selectSystem,
  selectMode,
  setFocus,
  setJapaneseFocus,
  setDifficulty,

  // Pool slider
  updatePoolVal,

  // Quiz flow
  startQuiz,
  nextQuestion,
  toggleHint,
  toggleFlagCurrent,
  startBookmarkedQuiz,
  startSRSReviewQuiz,
  restartQuiz,
  restartComboModeOnly,
  backToWelcome,

  // Analytics
  clearHistory,
  loadPerformanceAnalysis,

  // Godspeed Mode
  restartGodspeedMode,
  setGodspeedLives: _setGodspeedLivesUI,
  setGodspeedFocus,
  setGodspeedFocusChip,
  setGodspeedSeconds: _setGodspeedSecondsUI,
  toggleGodspeedIsland,

  // Internal: called by godspeed.js to advance quiz-card to next question
  _godspeedRenderNext: godspeedRenderNext,
};

// ── 6. Service Worker (Phase 7) ───────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(reg => console.log('[SW] Registered, scope:', reg.scope))
      .catch(err => console.warn('[SW] Registration failed:', err));
  });
}
