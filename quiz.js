/**
 * quiz.js — Phase 6
 * Pure quiz-logic module: builds the pool, renders questions,
 * handles answers, and compiles the results screen.
 *
 * This module imports state, timer, and analytics — it has NO direct
 * localStorage calls and NO globals.
 *
 * It exposes a window bridge at the bottom so that the existing
 * onclick="" attributes in index.html keep working without HTML edits.
 */

import { state, resetQuizState, resetComboState } from './state.js';
import { startTimer, stopTimer }                  from './timer.js';
import { analytics }                              from './analytics.js';
import { recordSRSResponse, deriveQuality, getDueQuestions, getSRSStats } from './srs.js';
import {
  gs,
  startGodspeedMode,
  armCountdownForQuestion,
  handleGodspeedAnswer,
  resetGodspeedState,
  restartGodspeedMode,
} from './godspeed.js';

// ── DOM helpers ───────────────────────────────────────────────────────────────

/** @param {string} id @returns {HTMLElement} */
const $ = id => document.getElementById(id);

// ── Randomisation helpers ─────────────────────────────────────────────────────

/**
 * Fisher-Yates shuffle — unbiased, in-place.
 * Replaces the weak `sort(() => Math.random() - 0.5)` pattern.
 * @template T
 * @param {T[]} arr
 * @returns {T[]} the same array, shuffled
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Returns a copy of the question with its options shuffled and
 * correctIndex updated to match the new position.
 * The original question object in the pool is NOT mutated.
 * @param {Object} q  Raw question from the pool
 * @returns {Object}  Question with shuffled options + updated correctIndex
 */
function questionWithShuffledOptions(q) {
  const correctAnswer = q.options[q.correctIndex];
  const shuffled = shuffleArray([...q.options]);
  return {
    ...q,
    options:      shuffled,
    correctIndex: shuffled.indexOf(correctAnswer),
  };
}

function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }

// ── Pool builder ──────────────────────────────────────────────────────────────

export function buildActivePool() {
  const rawPool = state.currentSystem === 'english'
    ? state.baselineQuizData
    : state.japaneseQuizData;

  let filtered = [...rawPool];

  if (state.selectedMode === 'practice') {
    if (state.configDifficulty !== 'any') {
      filtered = filtered.filter(q => q.difficulty === state.configDifficulty);
    }

    const focus = state.currentSystem === 'english'
      ? state.configFocus
      : state.configJapaneseFocus;

    if (focus !== 'all') {
      filtered = filtered.filter(
        q => q.subCategory.toLowerCase() === focus.toLowerCase()
      );
    } else if (state.currentSystem === 'japanese') {
      // Bias 40 % of "mixed" sessions toward the weakest category
      const jaStats = analytics.getJapaneseStats();
      let lowestAcc = 101;
      let weakest   = null;
      for (const [cat, { answered, correct }] of Object.entries(jaStats)) {
        if (answered > 0) {
          const acc = (correct / answered) * 100;
          if (acc < lowestAcc) { lowestAcc = acc; weakest = cat; }
        }
      }
      if (weakest && Math.random() < 0.4) {
        const weakPool = filtered.filter(
          q => q.subCategory.toLowerCase() === weakest
        );
        if (weakPool.length > 0) filtered = weakPool;
      }
    }
  }
  if (state.selectedMode === 'godspeed') {
    // Apply focus filter if set
    if (state.godspeedFocus !== 'all') {
      filtered = filtered.filter(
        q => q.subCategory.toLowerCase() === state.godspeedFocus.toLowerCase()
      );
    }
  }

  if (filtered.length === 0) return false;

  shuffleArray(filtered);

  let size = parseInt($('pool-range').value, 10);
  if (state.selectedMode === 'exam')       size = 60;
  if (state.selectedMode === 'combo')      size = filtered.length;
  if (state.selectedMode === 'godspeed')   size = filtered.length;

  state.activeQuizPool = filtered.slice(0, Math.min(size, filtered.length));
  return true;
}

// ── Quiz entry points ─────────────────────────────────────────────────────────

export function startQuiz() {
  resetQuizState();
  resetComboState();

  if (!buildActivePool()) {
    alert('No matching questions were found for the selected configuration.');
    return;
  }

  state.comboActive = (state.selectedMode === 'combo');

  hide('welcome-card');
  show('quiz-card');

  if (state.selectedMode === 'exam') {
    setupExamTimer();
  } else {
    hide('exam-timer-container');
  }

  if (state.comboActive) {
    show('combo-streak-container');
    $('combo-header-streak').innerText = state.comboStreak;
  } else {
    hide('combo-streak-container');
  }

  if (state.selectedMode === 'godspeed') {
    startGodspeedMode();
  } else {
    hide('godspeed-hud-container');
  }

  renderCurrentQuestion();
}

function setupExamTimer() {
  show('exam-timer-container');

  startTimer(
    (mins, secs) => {
      $('exam-timer').innerText = `${mins}:${secs}`;
    },
    () => {
      alert('Time limit reached! Submitting your exam now.');
      evaluateFinalAssessmentSheet();
    }
  );
}

// ── Question renderer ─────────────────────────────────────────────────────────

export function renderCurrentQuestion() {
  if (state.currentQuestionIndex >= state.activeQuizPool.length) {
    evaluateFinalAssessmentSheet();
    return;
  }

  // Shuffle answer options each render so no option slot is predictable.
  // questionWithShuffledOptions returns a shallow copy — the pool is not mutated.
  const q = questionWithShuffledOptions(state.activeQuizPool[state.currentQuestionIndex]);
  // Stash the shuffled copy so nextQuestion() can evaluate exam answers correctly.
  state._currentShuffledQuestion = q;
  state.selectedOption = null;
  state.questionRenderedAt = Date.now();
  state.hintUsedCurrent = false;

  const pct = (state.currentQuestionIndex / state.activeQuizPool.length) * 100;
  $('progress-bar').style.width = `${pct}%`;
  $('question-index-tag').innerText =
    `Q ${state.currentQuestionIndex + 1}/${state.activeQuizPool.length}`;
  $('category-tag').innerText =
    `${q.category.toUpperCase()} • ${q.subCategory.toUpperCase()} [${q.difficulty.toUpperCase()}]`;
  $('question-text').innerText = q.question;

  hide('hint-panel');
  hide('explanation-box');

  // Show Godspeed countdown bar only in Godspeed mode
  if (state.selectedMode === 'godspeed') {
    show('godspeed-countdown-wrapper');
    hide('hint-trigger-btn');
  } else {
    hide('godspeed-countdown-wrapper');
  }

  if (state.selectedMode === 'exam') {
    hide('hint-trigger-btn');
  } else if (state.selectedMode !== 'godspeed') {
    show('hint-trigger-btn');
  }

  // Exit button — inject once, skip if already present
  const actionsGroup = $('quiz-actions-group');
  if (!$('exit-quiz-btn')) {
    const exitBtn = document.createElement('button');
    exitBtn.id = 'exit-quiz-btn';
    exitBtn.className =
      'text-slate-400 dark:text-slate-500 text-xs font-medium flex items-center ' +
      'space-x-1.5 px-3 py-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 ' +
      'hover:text-rose-500 dark:hover:text-rose-400 fast-transition';
    exitBtn.innerHTML = '<i class="fa-solid fa-door-open"></i><span class="hidden sm:inline">Exit</span>';
    exitBtn.addEventListener('click', () => {
      if (confirm('Quit this session and return to the main menu?')) {
        backToWelcome();
      }
    });
    actionsGroup.appendChild(exitBtn);
  }

  // Build options with a DocumentFragment — one DOM insertion
  const frag = document.createDocumentFragment();
  q.options.forEach((opt, idx) => {
    const btn = document.createElement('button');
    btn.className =
      'w-full text-left p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 ' +
      'hover:border-indigo-500 dark:hover:border-indigo-400 hover:bg-slate-50 ' +
      'dark:hover:bg-slate-700/50 font-medium text-sm transition-all flex items-center ' +
      'justify-between group';
    btn.innerHTML =
      `<span>${opt}</span>` +
      `<span class="w-5 h-5 rounded-full border border-slate-300 dark:border-slate-600 ` +
      `flex items-center justify-center text-[10px] text-transparent font-black ` +
      `group-hover:border-indigo-500">✓</span>`;
    // Pass the full shuffled question so selectActiveOption uses the correct
    // correctIndex and options array for this render (not the unshuffled pool copy).
    btn.addEventListener('click', () => selectActiveOption(idx, btn, q));
    frag.appendChild(btn);
  });

  const container = $('options-container');
  container.innerHTML = '';
  container.appendChild(frag);

  const nextBtn = $('next-button');
  if (state.selectedMode === 'godspeed') {
    nextBtn.style.display = 'none';   // hidden — godspeed auto-advances
  } else {
    nextBtn.style.display = '';
    nextBtn.disabled = true;
    $('next-button-text').innerText =
      state.currentQuestionIndex === state.activeQuizPool.length - 1
        ? 'Finish Assessment'
        : 'Next Question';
  }

  // Bookmark icon
  $('flag-icon').className = state.bookmarkedQuestionIds.has(q.id)
    ? 'fa-solid fa-star text-amber-500'
    : 'fa-regular fa-star';

  if (state.selectedMode === 'godspeed') {
    // Show lives hearts inline in the quiz footer
    const livesHtml = Array.from({ length: state.godspeedLives }, (_, i) =>
      i < gs.livesRemaining
        ? '<i class="fa-solid fa-heart text-rose-500 text-xs"></i>'
        : '<i class="fa-regular fa-heart text-slate-300 dark:text-slate-600 text-xs"></i>'
    ).join(' ');
    $('current-score-text').innerHTML = `⚡ ${gs.totalScore} pts &nbsp;${livesHtml}`;
    armCountdownForQuestion();
  } else {
    $('current-score-text').innerText = `Score Tracker: ${state.score}`;
  }
}

// ── Answer handler ────────────────────────────────────────────────────────────

/**
 * @param {number}  index    Index of the clicked option in the *shuffled* options array
 * @param {Element} element  The button DOM element that was clicked
 * @param {Object}  q        The shuffled question object produced by renderCurrentQuestion
 *                           (has the remapped correctIndex for this render)
 */
function selectActiveOption(index, element, q) {
  // In practice mode: lock after first answer
  if (state.selectedOption !== null && state.selectedMode !== 'exam') return;

  // Godspeed mode: delegate entirely to godspeed.js (pass original pool item)
  if (state.selectedMode === 'godspeed') {
    handleGodspeedAnswer(index, q, element);
    return;
  }

  // Exam mode: highlight selection only, no reveal
  if (state.selectedMode === 'exam') {
    state.selectedOption = index;
    document.querySelectorAll('#options-container button').forEach((btn, i) => {
      btn.className = i === index
        ? 'w-full text-left p-4 rounded-xl border-2 border-indigo-600 dark:border-indigo-500 ' +
          'bg-indigo-50/50 dark:bg-indigo-900/20 font-semibold text-sm flex items-center justify-between'
        : 'w-full text-left p-4 rounded-xl border-2 border-slate-200 dark:border-slate-700 ' +
          'hover:border-indigo-500 font-medium text-sm flex items-center justify-between';
    });
    $('next-button').disabled = false;
    return;
  }

  state.selectedOption = index;
  // q.correctIndex already reflects the shuffled order for this render
  const isCorrect = (index === q.correctIndex);
  const answerTimeMs = state.questionRenderedAt ? Date.now() - state.questionRenderedAt : null;
  const hintUsed = state.hintUsedCurrent;
  state.userAnswers.push({ question: q, selected: index, correct: isCorrect, hintUsed, answerTimeMs });

  recordSRSResponse(q.id, deriveQuality({ correct: isCorrect, hintUsed, answerTimeMs }));

  if (isCorrect) {
    state.score++;
    element.className =
      'w-full text-left p-4 rounded-xl border-2 border-emerald-500 bg-emerald-50/50 ' +
      'dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 font-bold text-sm ' +
      'flex items-center justify-between';
    const check = element.querySelector('span:last-child');
    check.className =
      'w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center ' +
      'text-[10px] font-black border-none';
    check.innerText = '✓';

    if (state.comboActive) {
      state.comboStreak++;
      $('combo-header-streak').innerText = state.comboStreak;
      if (state.comboStreak > state.comboBest) {
        state.comboBest = state.comboStreak;
        analytics.setBestCombo(state.comboBest);
      }
    }
  } else {
    element.className =
      'w-full text-left p-4 rounded-xl border-2 border-rose-500 bg-rose-50/50 ' +
      'dark:bg-rose-950/30 text-rose-900 dark:text-rose-200 font-bold text-sm ' +
      'flex items-center justify-between';
    const cross = element.querySelector('span:last-child');
    cross.className =
      'w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center ' +
      'text-[10px] font-black border-none';
    cross.innerText = '✕';

    // Highlight the correct answer using the shuffled correctIndex
    const correctBtn = $('options-container').children[q.correctIndex];
    correctBtn.className =
      'w-full text-left p-4 rounded-xl border-2 border-emerald-500 bg-emerald-50/30 ' +
      'font-semibold text-sm flex items-center justify-between';

    if (state.comboActive) {
      triggerComboTerminalSequence();
      return;
    }
  }

  // Show explanation (practice mode)
  const expBox   = $('explanation-box');
  const expIcon  = $('explanation-icon');
  const expTitle = $('explanation-title');
  const expText  = $('explanation-text');

  show('explanation-box');

  if (isCorrect) {
    expBox.className =
      'mt-6 p-4 md:p-5 rounded-2xl border border-emerald-200 bg-emerald-50/20 ' +
      'dark:border-emerald-800/40 text-emerald-900 dark:text-emerald-300';
    expIcon.className =
      'flex items-center justify-center w-8 h-8 rounded-full bg-emerald-500 ' +
      'text-white shrink-0 fa-solid fa-circle-check';
    expTitle.innerText = 'Accurate Analysis';
  } else {
    expBox.className =
      'mt-6 p-4 md:p-5 rounded-2xl border border-rose-200 bg-rose-50/20 ' +
      'dark:border-rose-800/40 text-rose-900 dark:text-rose-300';
    expIcon.className =
      'flex items-center justify-center w-8 h-8 rounded-full bg-rose-500 ' +
      'text-white shrink-0 fa-solid fa-circle-xmark';
    expTitle.innerText = 'Correction Overview';
  }

  expText.innerText = q.explanation || q.rationale || '';
  $('next-button').disabled = false;
}

// ── Navigation ────────────────────────────────────────────────────────────────

export function nextQuestion() {
  if (state.selectedMode === 'exam') {
    // Use the shuffled question that was displayed — its correctIndex matches
    // the option positions the user actually saw and clicked.
    const q         = state._currentShuffledQuestion;
    const isCorrect = state.selectedOption === q.correctIndex;
    const answerTimeMs = state.questionRenderedAt ? Date.now() - state.questionRenderedAt : null;
    if (isCorrect) state.score++;
    state.userAnswers.push({ question: q, selected: state.selectedOption, correct: isCorrect, hintUsed: false, answerTimeMs });
    recordSRSResponse(q.id, deriveQuality({ correct: isCorrect, hintUsed: false, answerTimeMs }));
  }
  state.currentQuestionIndex++;
  renderCurrentQuestion();
}

export function toggleHint() {
  const panel = $('hint-panel');
  const q     = state.activeQuizPool[state.currentQuestionIndex];
  if (panel.classList.contains('hidden')) {
    $('hint-text').innerText = q.hint || 'Analyze structural mechanics parameters carefully.';
    show('hint-panel');
    state.hintUsedCurrent = true;
  } else {
    hide('hint-panel');
  }
}

// ── Combo terminal sequence ───────────────────────────────────────────────────

function triggerComboTerminalSequence() {
  stopTimer();   // Safe in Combo mode — no-op if no timer was running (Phase 3 fix)
  hide('quiz-card');
  show('combo-game-over-card');
  $('combo-final-streak').innerText = state.comboStreak;
  $('combo-best-streak').innerText  = state.comboBest;
  analytics.incrementTotals(0, 1);
}

export function restartComboModeOnly() {
  hide('combo-game-over-card');
  startQuiz();
}

// ── Results screen ────────────────────────────────────────────────────────────

export function evaluateFinalAssessmentSheet() {
  stopTimer();
  hide('quiz-card');
  show('results-card');

  $('final-score').innerText = state.score;
  $('final-total').innerText = state.activeQuizPool.length;

  const scaled = Math.round((state.score / state.activeQuizPool.length) * 100);

  if (state.selectedMode === 'exam') {
    show('exam-scaled-container');
    $('exam-scaled-score').innerText = scaled;
  } else {
    hide('exam-scaled-container');
  }

  const comment = $('performance-comment');
  if (scaled >= 90)      comment.innerText = 'Excellent Work! High-Level Performance Parameters Maintained.';
  else if (scaled >= 75) comment.innerText = 'Satisfactory Progress. Solid structural core established.';
  else                   comment.innerText = 'Targeted Core Diagnostics Recommended. Review structural weaknesses.';

  // Metrics bars
  const metricsContainer = $('metrics-display-container');
  metricsContainer.innerHTML = '';

  if (state.currentSystem === 'english') {
    metricsContainer.innerHTML =
      `<span class="text-xs font-bold uppercase text-slate-400 dark:text-slate-500 tracking-wider">English Mastery Metrics</span>` +
      createSubMetricBar('Prepositions',     compileSubAccuracy('preposition')) +
      createSubMetricBar('S-V Agreement',    compileSubAccuracy('sv-agreement')) +
      createSubMetricBar('Idioms & Phrases', compileSubAccuracy('idiom')) +
      createSubMetricBar('Check the Mistake',compileSubAccuracy('error-correction'));
  } else {
    metricsContainer.innerHTML =
      `<span class="text-xs font-bold uppercase text-slate-400 dark:text-slate-500 tracking-wider">Japanese Mastery Metrics</span>` +
      createSubMetricBar('Grammar (文法)',            compileSubAccuracy('grammar'),      'bg-indigo-500') +
      createSubMetricBar('Onomatopoeia (オノマトペ)', compileSubAccuracy('onomatopoeia'), 'bg-emerald-500') +
      createSubMetricBar('Vocabulary (語彙)',          compileSubAccuracy('vocabulary'),   'bg-amber-500') +
      createSubMetricBar('Keigo (敬語)',              compileSubAccuracy('keigo'),         'bg-sky-500');
  }

  // Correction sheet
  const logContainer = $('question-log');
  const frag = document.createDocumentFragment();

  state.userAnswers.forEach((ans, idx) => {
    const item = document.createElement('div');
    item.className = 'p-4 text-xs flex flex-col gap-1.5 transition-colors';

    const statusBadge = ans.correct
      ? `<span class="text-emerald-600 dark:text-emerald-400 font-extrabold flex items-center gap-1">
           <i class="fa-solid fa-circle-check"></i> CORRECT
         </span>`
      : `<span class="text-rose-600 dark:text-rose-400 font-extrabold flex items-center gap-1">
           <i class="fa-solid fa-circle-xmark"></i> INCORRECT
         </span>`;

    const chosenText = ans.selected !== null
      ? ans.question.options[ans.selected]
      : 'Unanswered';
    const correctText = ans.question.options[ans.question.correctIndex];

    item.innerHTML = `
      <div class="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-1">
        <span class="font-bold text-slate-400">Question ${idx + 1}</span>
        ${statusBadge}
      </div>
      <p class="font-medium text-slate-800 dark:text-slate-200 my-1">${ans.question.question}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1 font-mono text-[11px]">
        <div class="bg-slate-50 dark:bg-slate-900/40 p-2 rounded border dark:border-slate-800">
          Your choice: <strong class="${ans.correct ? 'text-emerald-500' : 'text-rose-500'}">${chosenText}</strong>
        </div>
        <div class="bg-slate-50 dark:bg-slate-900/40 p-2 rounded border dark:border-slate-800">
          Correct answer: <strong class="text-emerald-500">${correctText}</strong>
        </div>
      </div>`;

    frag.appendChild(item);

    // ── Smart analytics: record every answer ──────────────────────────────
    analytics.recordQuestionResult(ans.question, ans.correct);
    analytics.recordDiffBreakdown(state.currentSystem, ans.question.subCategory, ans.question.difficulty, ans.correct);
    if (state.currentSystem === 'japanese') {
      analytics.recordJapaneseAnswer(ans.question.subCategory, ans.correct);
    } else {
      analytics.recordEnglishAnswer(ans.question.subCategory, ans.correct);
    }
  });

  logContainer.innerHTML = '';
  logContainer.appendChild(frag);

  // Persist session history + global counters
  const focusedSubCat = state.currentSystem === 'japanese'
    ? state.configJapaneseFocus
    : state.configFocus;

  analytics.pushSession({
    system:         state.currentSystem,
    score:          state.score,
    total:          state.activeQuizPool.length,
    focusedSubCat,
    mode:           state.selectedMode,
  });

  if (state.currentSystem === 'english') {
    analytics.incrementTotals(state.activeQuizPool.length, state.score);
  } else {
    analytics.incrementQuizCount();
  }

  loadPerformanceAnalysis();
}

// ── Analytics helpers ─────────────────────────────────────────────────────────

function createSubMetricBar(label, stats, colorClass = 'bg-indigo-600') {
  const pct = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
  return `
    <div class="mt-2">
      <div class="flex justify-between text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
        <span>${label}</span>
        <span>${stats.correct} / ${stats.total} (${pct}%)</span>
      </div>
      <div class="h-2 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div class="h-full ${colorClass} transition-all duration-500" style="width:${pct}%"></div>
      </div>
    </div>`;
}

function compileSubAccuracy(subName) {
  let correct = 0, total = 0;
  state.userAnswers.forEach(ans => {
    if (ans.question.subCategory.toLowerCase() === subName.toLowerCase()) {
      total++;
      if (ans.correct) correct++;
    }
  });
  return { correct, total };
}

// ── Welcome-screen helpers ────────────────────────────────────────────────────

export function loadPerformanceAnalysis() {
  const totals    = analytics.getTotals();
  const comboBest = state.comboBest;

  $('stat-total-quizzes').innerText = totals.quizzes;
  $('stat-total-qs').innerText      = totals.qs;

  updateSRSIndicator();

  // ── Determine which system panel is active ──────────────────────────────
  const isJapanese = state.currentSystem === 'japanese';

  // ── English panel ────────────────────────────────────────────────────────
  const noMsg = $('no-history-msg');
  const stats = $('history-stats-container');

  if (totals.quizzes > 0 || comboBest > 0) {
    if (noMsg)  noMsg.classList.add('hidden');
    if (stats) stats.classList.remove('hidden');
    const accuracy = totals.qs > 0 ? Math.round((totals.correct / totals.qs) * 100) : 0;
    $('stat-overall-acc').innerText   = `${accuracy}%`;
    $('stat-alltime-combo').innerText = comboBest;
  } else {
    if (noMsg)  noMsg.classList.remove('hidden');
    if (stats) stats.classList.add('hidden');
  }

  // ── Japanese per-category stats (simple accuracy tiles) ─────────────────
  const jaStats = analytics.getJapaneseStats();
  let lowestAcc = 101, weakestCat = 'NONE';
  const catMap = {
    grammar:      'ja-stat-grammar-acc',
    onomatopoeia: 'ja-stat-onomato-acc',
    vocabulary:   'ja-stat-vocab-acc',
    keigo:        'ja-stat-keigo-acc',
  };
  for (const [cat, { answered, correct }] of Object.entries(jaStats)) {
    const el = $(catMap[cat]);
    if (answered > 0) {
      const acc = Math.round((correct / answered) * 100);
      if (el) el.innerText = `${acc}%`;
      if (acc < lowestAcc) { lowestAcc = acc; weakestCat = cat; }
    } else {
      if (el) el.innerText = '0%';
    }
  }
  $('ja-weakest-lbl').innerText = weakestCat.toUpperCase();

  // ── Smart panel: only render when there's enough data ───────────────────
  const smartPanel = $('smart-analytics-panel');
  if (!smartPanel) return;

  const system = state.currentSystem;
  const history = analytics.getSessionHistory().filter(s => s.system === system);
  const mostMissed = analytics.getMostMissed(5).filter(m => {
    // Filter to current system's questions by checking subCategory membership
    const jaCategories = ['grammar','onomatopoeia','vocabulary','keigo'];
    const isJa = jaCategories.includes(m.subCategory.toLowerCase());
    return system === 'japanese' ? isJa : !isJa;
  });
  const recommendation = analytics.getFocusRecommendation(system);
  const diffBreakdown  = analytics.getDiffBreakdown(system);

  if (history.length === 0 && mostMissed.length === 0) {
    smartPanel.innerHTML = `
      <div class="text-center py-4 text-slate-400 dark:text-slate-500 text-xs">
        <i class="fa-solid fa-chart-line text-2xl mb-2 block opacity-40"></i>
        Complete a quiz to unlock smart analysis.
      </div>`;
    return;
  }

  // ── 1. Focus Recommendation ──────────────────────────────────────────────
  const confColor = recommendation.confidence === 'high'   ? 'rose'
                  : recommendation.confidence === 'medium' ? 'amber'
                  : 'sky';
  const confIcon  = recommendation.confidence === 'high'   ? 'fa-triangle-exclamation'
                  : recommendation.confidence === 'medium' ? 'fa-circle-exclamation'
                  : 'fa-circle-info';

  let recommendHTML = '';
  if (recommendation.subCat) {
    recommendHTML = `
      <div class="bg-${confColor}-50 dark:bg-${confColor}-950/30 border border-${confColor}-200 dark:border-${confColor}-800/50 rounded-xl p-3 mb-3">
        <div class="flex items-start gap-2">
          <i class="fa-solid ${confIcon} text-${confColor}-500 mt-0.5 text-sm shrink-0"></i>
          <div>
            <p class="text-[11px] font-extrabold text-${confColor}-700 dark:text-${confColor}-300 uppercase tracking-wide mb-0.5">
              📌 Study Recommendation
            </p>
            <p class="text-[11px] text-${confColor}-800 dark:text-${confColor}-200 leading-snug">
              ${recommendation.reason}
            </p>
          </div>
        </div>
      </div>`;
  }

  // ── 2. Session Trend sparkline ───────────────────────────────────────────
  let trendHTML = '';
  if (history.length >= 2) {
    const points = history.slice(0, 8).reverse(); // oldest → newest, max 8
    const maxPct = 100;
    const barW   = Math.floor(100 / points.length);
    // Pull live theme tokens so the chart stays grayscale + single accent.
    const _sw = getComputedStyle(document.documentElement);
    const _INK = _sw.getPropertyValue('--ink').trim()    || '#111';
    const _MUT = _sw.getPropertyValue('--muted').trim()  || '#737373';
    const _ACC = _sw.getPropertyValue('--accent').trim() || '#e4002b';
    const bars   = points.map(s => {
      const pct   = Math.round((s.score / s.total) * 100);
      const color = pct >= 80 ? _INK : pct >= 60 ? _MUT : _ACC;
      const date  = new Date(s.ts).toLocaleDateString('en', { month: 'short', day: 'numeric' });
      return `<div class="flex flex-col items-center gap-1" style="width:${barW}%">
        <span class="text-[8px] font-bold" style="color:${color}">${pct}%</span>
        <div class="w-full rounded-t" style="height:${Math.max(4, Math.round((pct/maxPct)*36))}px;background:${color};min-height:4px"></div>
        <span class="text-[7px] text-slate-400 dark:text-slate-500 truncate w-full text-center">${date}</span>
      </div>`;
    }).join('');

    const first = Math.round((points[0].score / points[0].total) * 100);
    const last  = Math.round((points[points.length-1].score / points[points.length-1].total) * 100);
    const trendDir = last > first ? '↑ Improving' : last < first ? '↓ Declining' : '→ Stable';
    const trendColor = last > first ? 'text-emerald-500' : last < first ? 'text-rose-500' : 'text-slate-400';

    trendHTML = `
      <div class="mb-3">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            <i class="fa-solid fa-chart-column mr-1"></i>Recent Sessions
          </span>
          <span class="text-[10px] font-extrabold ${trendColor}">${trendDir}</span>
        </div>
        <div class="flex items-end gap-0.5 bg-slate-100 dark:bg-slate-900 rounded-xl px-2 pt-2 pb-1">
          ${bars}
        </div>
      </div>`;
  }

  // ── 3. Difficulty heatmap ────────────────────────────────────────────────
  let heatmapHTML = '';
  const diffKeys = ['easy', 'medium', 'hard'];
  const catEntries = Object.entries(diffBreakdown);
  if (catEntries.length > 0) {
    const rows = catEntries.map(([cat, diffs]) => {
      const cells = diffKeys.map(d => {
        const entry = diffs[d];
        if (!entry || entry.pct === null) return `<td class="text-center text-[9px] text-slate-300 dark:text-slate-600 py-1">—</td>`;
        const color = entry.pct >= 80 ? 'text-emerald-600 dark:text-emerald-400'
                    : entry.pct >= 60 ? 'text-amber-600 dark:text-amber-400'
                    : 'text-rose-600 dark:text-rose-400';
        const bg    = entry.pct >= 80 ? 'bg-emerald-50 dark:bg-emerald-950/20'
                    : entry.pct >= 60 ? 'bg-amber-50 dark:bg-amber-950/20'
                    : 'bg-rose-50 dark:bg-rose-950/20';
        return `<td class="text-center py-1 px-1"><span class="text-[10px] font-black ${color} ${bg} rounded px-1">${entry.pct}%</span></td>`;
      }).join('');
      const label = cat.length > 12 ? cat.slice(0,11)+'…' : cat;
      return `<tr class="border-b border-slate-100 dark:border-slate-800 last:border-0">
        <td class="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase py-1.5 pr-2 whitespace-nowrap">${label}</td>
        ${cells}
      </tr>`;
    }).join('');

    heatmapHTML = `
      <div class="mb-3">
        <p class="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
          <i class="fa-solid fa-fire mr-1 text-orange-400"></i>Accuracy by Difficulty
        </p>
        <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <table class="w-full">
            <thead>
              <tr class="bg-slate-50 dark:bg-slate-800">
                <th class="text-[9px] text-slate-400 font-bold uppercase text-left py-1 pl-2">Topic</th>
                <th class="text-[9px] text-emerald-600 font-bold uppercase py-1 text-center">Easy</th>
                <th class="text-[9px] text-amber-500 font-bold uppercase py-1 text-center">Med</th>
                <th class="text-[9px] text-rose-500 font-bold uppercase py-1 text-center">Hard</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ── 4. Most-missed questions ─────────────────────────────────────────────
  let missedHTML = '';
  if (mostMissed.length > 0) {
    const items = mostMissed.map(m => {
      const badgeColor = m.missRate >= 70 ? 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                       : m.missRate >= 40 ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
                       : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400';
      return `
        <div class="flex items-start gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
          <span class="shrink-0 mt-0.5 text-[10px] font-black px-1.5 py-0.5 rounded ${badgeColor}">
            ✕${m.missed}
          </span>
          <div class="min-w-0">
            <p class="text-[11px] text-slate-700 dark:text-slate-300 leading-snug line-clamp-2">${m.text}</p>
            <p class="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5 uppercase font-bold">${m.subCategory} · ${m.missRate}% miss rate</p>
          </div>
        </div>`;
    }).join('');

    missedHTML = `
      <div>
        <p class="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
          <i class="fa-solid fa-skull text-rose-400 mr-1"></i>Questions You Keep Missing
        </p>
        <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-1">
          ${items}
        </div>
      </div>`;
  }

  smartPanel.innerHTML = recommendHTML + trendHTML + heatmapHTML + missedHTML;
}

export function clearHistory() {
  if (confirm('Are you certain you wish to completely wipe your historical parameters and high scores across all systems?')) {
    analytics.clearAll();
    state.comboBest = 0;
    loadPerformanceAnalysis();
  }
}

export function updateSystemPoolIndicator() {
  const count = state.currentSystem === 'english'
    ? state.baselineQuizData.length
    : state.japaneseQuizData.length;
  $('base-pool-indicator').innerText = `${count} Questions Available`;
}

export function updatePoolVal(val) {
  $('pool-size-indicator').innerText = `${val} Questions`;
}

// ── Bookmark helpers ──────────────────────────────────────────────────────────

export function toggleFlagCurrent() {
  const q    = state.activeQuizPool[state.currentQuestionIndex];
  const icon = $('flag-icon');

  if (state.bookmarkedQuestionIds.has(q.id)) {
    state.bookmarkedQuestionIds.delete(q.id);
    icon.className = 'fa-regular fa-star';
  } else {
    state.bookmarkedQuestionIds.add(q.id);
    icon.className = 'fa-solid fa-star text-amber-500';
  }

  analytics.saveBookmarks(state.bookmarkedQuestionIds);
  updateBookmarkIndicator();
}

export function updateBookmarkIndicator() {
  const container = $('bookmark-badge-container');
  const counter   = $('bookmark-counter');
  if (state.bookmarkedQuestionIds.size > 0) {
    container.classList.remove('hidden');
    counter.innerText = state.bookmarkedQuestionIds.size;
  } else {
    container.classList.add('hidden');
  }
}

/**
 * Shows/hides the "Review Due" badge on the welcome screen based on
 * how many cards are due for the currently selected system.
 */
export function updateSRSIndicator() {
  const container = $('srs-badge-container');
  const counter    = $('srs-due-counter');
  if (!container || !counter) return; // guard if markup hasn't been added yet

  const sourcePool = state.currentSystem === 'english'
    ? state.baselineQuizData
    : state.japaneseQuizData;

  const { dueCount } = getSRSStats(sourcePool);

  if (dueCount > 0) {
    container.classList.remove('hidden');
    counter.innerText = dueCount;
  } else {
    container.classList.add('hidden');
  }
}

export function startBookmarkedQuiz() {
  const combined = [...state.baselineQuizData, ...state.japaneseQuizData];
  const pool = combined.filter(q => state.bookmarkedQuestionIds.has(q.id));
  if (pool.length === 0) return;

  resetQuizState();
  resetComboState();
  state.activeQuizPool = shuffleArray(pool);
  state.selectedMode   = 'practice';

  hide('welcome-card');
  show('quiz-card');
  hide('exam-timer-container');
  hide('combo-streak-container');

  renderCurrentQuestion();
}

/**
 * Starts a focused review session pulling from cards the SRS scheduler
 * has marked due, for whichever system the user currently has selected.
 * Falls back gracefully (does nothing) if nothing is due.
 */
export function startSRSReviewQuiz() {
  const sourcePool = state.currentSystem === 'english'
    ? state.baselineQuizData
    : state.japaneseQuizData;

  const pool = getDueQuestions(sourcePool, 1, 20);
  if (pool.length === 0) return;

  resetQuizState();
  resetComboState();
  state.activeQuizPool = pool;
  state.selectedMode   = 'practice';

  hide('welcome-card');
  show('quiz-card');
  hide('exam-timer-container');
  hide('combo-streak-container');

  renderCurrentQuestion();
}

// ── Config selectors ──────────────────────────────────────────────────────────

export function selectSystem(system) {
  state.currentSystem = system;
  state.godspeedFocus = 'all';  // reset focus when system changes

  const btnEn  = $('system-en-btn');
  const btnJa  = $('system-ja-btn');

  const activeClass =
    'py-3 px-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 fast-transition ' +
    'bg-white dark:bg-slate-800 shadow-md text-indigo-600 dark:text-indigo-400 ' +
    'border border-slate-200/50 dark:border-slate-700';
  const inactiveClass =
    'py-3 px-4 rounded-xl text-sm font-bold flex items-center justify-center gap-2 fast-transition ' +
    'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50';

  if (system === 'english') {
    btnEn.className = activeClass;
    btnJa.className = inactiveClass;
    show('filter-english-panel');
    hide('filter-japanese-panel');
    show('analytics-english-box');
    hide('analytics-japanese-box');
    // Sync Godspeed focus picker
    const enDiv = $('gs-foci-english'); if (enDiv) enDiv.classList.remove('hidden');
    const jaDiv = $('gs-foci-japanese'); if (jaDiv) jaDiv.classList.add('hidden');
  } else {
    btnJa.className = activeClass;
    btnEn.className = inactiveClass;
    show('filter-japanese-panel');
    hide('filter-english-panel');
    show('analytics-japanese-box');
    hide('analytics-english-box');
    // Sync Godspeed focus picker
    const enDiv = $('gs-foci-english'); if (enDiv) enDiv.classList.add('hidden');
    const jaDiv = $('gs-foci-japanese'); if (jaDiv) jaDiv.classList.remove('hidden');
  }

  updateSystemPoolIndicator();
  loadPerformanceAnalysis();
}

export function setFocus(focus) {
  if (state.selectedMode === 'exam' || state.selectedMode === 'combo' || state.selectedMode === 'godspeed') return;
  state.configFocus = focus;
  document.querySelectorAll('.focus-btn').forEach(btn => {
    btn.className =
      'focus-btn py-2.5 px-3 text-xs font-bold border rounded-xl bg-white dark:bg-slate-800 ' +
      'text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600 ' +
      'hover:bg-slate-50 dark:hover:bg-slate-700 fast-transition';
  });
  $(`focus-${focus}`).className =
    'focus-btn py-2.5 px-3 text-xs font-bold border rounded-xl bg-indigo-600 text-white border-indigo-600 fast-transition';
}

export function setJapaneseFocus(focus) {
  if (state.selectedMode === 'exam' || state.selectedMode === 'combo' || state.selectedMode === 'godspeed') return;
  state.configJapaneseFocus = focus;
  document.querySelectorAll('.focus-ja-btn').forEach(btn => {
    btn.className =
      'focus-ja-btn py-2.5 px-3 text-xs font-bold border rounded-xl bg-white dark:bg-slate-800 ' +
      'text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600 ' +
      'hover:bg-slate-50 dark:hover:bg-slate-700 fast-transition';
  });
  $(`focus-ja-${focus}`).className =
    'focus-ja-btn py-2.5 px-3 text-xs font-bold border rounded-xl bg-indigo-600 text-white border-indigo-600 fast-transition';
}

export function setDifficulty(diff) {
  if (state.selectedMode === 'exam' || state.selectedMode === 'combo' || state.selectedMode === 'godspeed') return;
  state.configDifficulty = diff;
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.className =
      'diff-btn py-2.5 px-2 text-[11px] font-bold border rounded-xl bg-white dark:bg-slate-800 ' +
      'text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600 ' +
      'hover:bg-slate-50 dark:hover:bg-slate-700 fast-transition';
  });
  $(`diff-${diff}`).className =
    'diff-btn py-2.5 px-2 text-[11px] font-bold border rounded-xl bg-indigo-600 text-white border-indigo-600 fast-transition';
}

export function selectMode(mode) {
  state.selectedMode = mode;
  const modes = ['practice', 'exam', 'combo', 'godspeed'];

  modes.forEach(m => {
    const pill = $(`mode-${m}-pill`);
    const desc = $(`mode-${m}-desc`);
    const chk  = $(`mode-${m}-check`);

    if (!pill) return;   // guard: element may not exist yet during boot

    if (m === mode) {
      pill.classList.add('active');
      if (desc) desc.classList.add('open');
      if (chk)  chk.style.opacity = '1';
    } else {
      pill.classList.remove('active');
      if (desc) desc.classList.remove('open');
      if (chk)  chk.style.opacity = '0';
    }
  });

  const configContainer = $('config-panel-container');
  const startBtnText    = $('start-btn-text');

  if (mode === 'exam') {
    configContainer.style.opacity = '0.5';
    startBtnText.innerText = 'Deploy Exam Simulation';
  } else if (mode === 'combo') {
    configContainer.style.opacity = '0.5';
    startBtnText.innerText = 'Deploy Arcade Chain';
  } else if (mode === 'godspeed') {
    configContainer.style.opacity = '0.5';
    startBtnText.innerText = '⚡ Launch Godspeed Mode';
  } else {
    configContainer.style.opacity = '1';
    startBtnText.innerText = 'Initialize Simulator';
  }
}

// ── Navigation ────────────────────────────────────────────────────────────────

export function setGodspeedLives(n) {
  state.godspeedLives = parseInt(n, 10) || 3;
}

export function setGodspeedFocus(focus) {
  state.godspeedFocus = focus;
}

export function setGodspeedSeconds(n) {
  state.godspeedSeconds = parseInt(n, 10) || 5;
}

export function backToWelcome() {
  stopTimer();
  resetGodspeedState();
  hide('results-card');
  hide('combo-game-over-card');
  hide('godspeed-game-over-card');
  hide('quiz-card');
  show('welcome-card');
  hide('exam-timer-container');
  hide('combo-streak-container');
  hide('godspeed-hud-container');
  // Remove exit button so it's recreated cleanly on the next quiz session
  const exitBtn = $('exit-quiz-btn');
  if (exitBtn) exitBtn.remove();
  loadPerformanceAnalysis();
}

export function restartQuiz() {
  hide('results-card');
  startQuiz();
}

export { restartGodspeedMode };

/**
 * Called by godspeed.js via window.App._godspeedRenderNext()
 * Advances to the next question inside the shared quiz-card.
 */
export function godspeedRenderNext() {
  if (state.currentQuestionIndex >= state.activeQuizPool.length) {
    // Survived every question — victory! Reuse the game-over card.
    hide('quiz-card');
    hide('godspeed-hud-container');
    show('godspeed-game-over-card');
    $('gs-final-score').innerText  = gs.totalScore;
    $('gs-best-score').innerText   = gs.bestScore;
    $('gs-final-streak').innerText = gs.streak;
    const reasonEl = $('gs-termination-reason');
    if (reasonEl) reasonEl.innerText = '🏆 You cleared the entire pool — incredible!';
    return;
  }
  // Re-enable gs.active so the next question accepts taps
  gs.active = true;
  gs.livesRemaining = Math.max(gs.livesRemaining, 0); // safety clamp
  renderCurrentQuestion();
}
