/**
 * analytics.js — Phase 4 (Smart Analytics upgrade)
 *
 * New tracking added on top of the original:
 *  • Per-question miss counter  → which exact questions you keep getting wrong
 *  • Per-category × difficulty  → where your weak spots really live
 *  • Session history ring buffer (last 10) → trend over time
 *  • Focus recommendation engine → tells you what to study next and why
 */

// ── Key registry ──────────────────────────────────────────────────────────────
export const KEYS = Object.freeze({
  THEME: 'mext_theme',

  TOTAL_QUIZZES:  'mext_total_quizzes',
  TOTAL_QS:       'mext_total_qs',
  TOTAL_CORRECT:  'mext_total_correct',

  ARCADE_BEST_COMBO: 'mext_arcade_best_combo',

  // Japanese sub-category counters (answered / correct pairs)
  JA_QS_GRAMMAR:   'mext_ja_qs_grammar',
  JA_CORR_GRAMMAR: 'mext_ja_corr_grammar',
  JA_QS_ONOMATO:   'mext_ja_qs_onomatopoeia',
  JA_CORR_ONOMATO: 'mext_ja_corr_onomatopoeia',
  JA_QS_VOCAB:     'mext_ja_qs_vocabulary',
  JA_CORR_VOCAB:   'mext_ja_corr_vocabulary',
  JA_QS_KEIGO:     'mext_ja_qs_keigo',
  JA_CORR_KEIGO:   'mext_ja_corr_keigo',

  // English sub-category counters
  EN_QS_PREPOSITION:  'mext_en_qs_preposition',
  EN_CORR_PREPOSITION:'mext_en_corr_preposition',
  EN_QS_SV:           'mext_en_qs_sv-agreement',
  EN_CORR_SV:         'mext_en_corr_sv-agreement',
  EN_QS_IDIOM:        'mext_en_qs_idiom',
  EN_CORR_IDIOM:      'mext_en_corr_idiom',
  EN_QS_ERROR:        'mext_en_qs_error-correction',
  EN_CORR_ERROR:      'mext_en_corr_error-correction',

  BOOKMARKS: 'mext_bookmarks',

  // Godspeed Mode high score
  GODSPEED_BEST: 'mext_godspeed_best',

  // ── NEW ──────────────────────────────────────────────────────────────────
  /** JSON: { [questionId]: { missed: number, seen: number, text: string, subCategory: string } } */
  QUESTION_MISSES: 'mext_question_misses',

  /** JSON: { [system]: { [subCat]: { easy:{a,c}, medium:{a,c}, hard:{a,c} } } } */
  DIFF_BREAKDOWN: 'mext_diff_breakdown',

  /** JSON: Array<{ ts, system, score, total, subCat }> — last 10, newest first */
  SESSION_HISTORY: 'mext_session_history',
});

// ── Internal helpers ──────────────────────────────────────────────────────────
function readInt(key) {
  const raw = localStorage.getItem(key);
  if (raw === null) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}
function writeInt(key, value) { localStorage.setItem(key, String(value)); }

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function writeJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

// ── Public API ────────────────────────────────────────────────────────────────
export const analytics = {

  // ── Theme ─────────────────────────────────────────────────────────────────
  getTheme()        { return localStorage.getItem(KEYS.THEME); },
  setTheme(value)   { localStorage.setItem(KEYS.THEME, value); },

  // ── Global stats ──────────────────────────────────────────────────────────
  getTotals() {
    return {
      quizzes: readInt(KEYS.TOTAL_QUIZZES),
      qs:      readInt(KEYS.TOTAL_QS),
      correct: readInt(KEYS.TOTAL_CORRECT),
    };
  },
  incrementTotals(questionsAnswered, correctAnswers) {
    writeInt(KEYS.TOTAL_QUIZZES, readInt(KEYS.TOTAL_QUIZZES) + 1);
    writeInt(KEYS.TOTAL_QS,      readInt(KEYS.TOTAL_QS)      + questionsAnswered);
    writeInt(KEYS.TOTAL_CORRECT, readInt(KEYS.TOTAL_CORRECT) + correctAnswers);
  },
  incrementQuizCount() {
    writeInt(KEYS.TOTAL_QUIZZES, readInt(KEYS.TOTAL_QUIZZES) + 1);
  },

  // ── Combo ─────────────────────────────────────────────────────────────────
  getBestCombo()       { return readInt(KEYS.ARCADE_BEST_COMBO); },
  setBestCombo(value)  { writeInt(KEYS.ARCADE_BEST_COMBO, value); },

  // ── Sub-category stats (Japanese) ─────────────────────────────────────────
  getJapaneseStats() {
    return {
      grammar:      { answered: readInt(KEYS.JA_QS_GRAMMAR),  correct: readInt(KEYS.JA_CORR_GRAMMAR) },
      onomatopoeia: { answered: readInt(KEYS.JA_QS_ONOMATO),  correct: readInt(KEYS.JA_CORR_ONOMATO) },
      vocabulary:   { answered: readInt(KEYS.JA_QS_VOCAB),    correct: readInt(KEYS.JA_CORR_VOCAB) },
      keigo:        { answered: readInt(KEYS.JA_QS_KEIGO),    correct: readInt(KEYS.JA_CORR_KEIGO) },
    };
  },
  recordJapaneseAnswer(subCat, isCorrect) {
    const map = {
      grammar:      [KEYS.JA_QS_GRAMMAR,  KEYS.JA_CORR_GRAMMAR],
      onomatopoeia: [KEYS.JA_QS_ONOMATO,  KEYS.JA_CORR_ONOMATO],
      vocabulary:   [KEYS.JA_QS_VOCAB,    KEYS.JA_CORR_VOCAB],
      keigo:        [KEYS.JA_QS_KEIGO,    KEYS.JA_CORR_KEIGO],
    };
    const keys = map[subCat.toLowerCase()];
    if (!keys) return;
    writeInt(keys[0], readInt(keys[0]) + 1);
    if (isCorrect) writeInt(keys[1], readInt(keys[1]) + 1);
  },

  // ── Sub-category stats (English) ──────────────────────────────────────────
  getEnglishStats() {
    return {
      preposition:      { answered: readInt(KEYS.EN_QS_PREPOSITION),  correct: readInt(KEYS.EN_CORR_PREPOSITION) },
      'sv-agreement':   { answered: readInt(KEYS.EN_QS_SV),           correct: readInt(KEYS.EN_CORR_SV) },
      idiom:            { answered: readInt(KEYS.EN_QS_IDIOM),         correct: readInt(KEYS.EN_CORR_IDIOM) },
      'error-correction':{ answered: readInt(KEYS.EN_QS_ERROR),        correct: readInt(KEYS.EN_CORR_ERROR) },
    };
  },
  recordEnglishAnswer(subCat, isCorrect) {
    const norm = subCat.toLowerCase();
    const map = {
      'preposition':       [KEYS.EN_QS_PREPOSITION,  KEYS.EN_CORR_PREPOSITION],
      'dependent preposition': [KEYS.EN_QS_PREPOSITION, KEYS.EN_CORR_PREPOSITION],
      'preposition-verb':  [KEYS.EN_QS_PREPOSITION,  KEYS.EN_CORR_PREPOSITION],
      'sv-agreement':      [KEYS.EN_QS_SV,            KEYS.EN_CORR_SV],
      'idiom':             [KEYS.EN_QS_IDIOM,         KEYS.EN_CORR_IDIOM],
      'error-correction':  [KEYS.EN_QS_ERROR,         KEYS.EN_CORR_ERROR],
    };
    const keys = map[norm];
    if (!keys) return;
    writeInt(keys[0], readInt(keys[0]) + 1);
    if (isCorrect) writeInt(keys[1], readInt(keys[1]) + 1);
  },

  // ── Bookmarks ─────────────────────────────────────────────────────────────
  getBookmarks() {
    try {
      const raw = localStorage.getItem(KEYS.BOOKMARKS);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  },
  saveBookmarks(set) { localStorage.setItem(KEYS.BOOKMARKS, JSON.stringify([...set])); },

  // ── NEW: Per-question miss tracking ───────────────────────────────────────
  /**
   * Call once per answered question.
   * @param {{ id, question, subCategory }} q
   * @param {boolean} isCorrect
   */
  recordQuestionResult(q, isCorrect) {
    const db = readJSON(KEYS.QUESTION_MISSES, {});
    if (!db[q.id]) db[q.id] = { missed: 0, seen: 0, text: q.question, subCategory: q.subCategory };
    db[q.id].seen++;
    if (!isCorrect) db[q.id].missed++;
    // Keep question text fresh (truncated)
    db[q.id].text = q.question.length > 80 ? q.question.slice(0, 77) + '…' : q.question;
    writeJSON(KEYS.QUESTION_MISSES, db);
  },

  /**
   * Returns the N most-missed questions, sorted by miss count descending.
   * Only returns questions missed at least once.
   * @param {number} n
   * @returns {Array<{ id, missed, seen, text, subCategory, missRate }>}
   */
  getMostMissed(n = 5) {
    const db = readJSON(KEYS.QUESTION_MISSES, {});
    return Object.entries(db)
      .filter(([, v]) => v.missed > 0)
      .map(([id, v]) => ({ id, ...v, missRate: Math.round((v.missed / v.seen) * 100) }))
      .sort((a, b) => b.missed - a.missed || b.missRate - a.missRate)
      .slice(0, n);
  },

  // ── NEW: Per-category × difficulty breakdown ───────────────────────────────
  /**
   * @param {string} system  'english' | 'japanese'
   * @param {string} subCat
   * @param {'easy'|'medium'|'hard'} difficulty
   * @param {boolean} isCorrect
   */
  recordDiffBreakdown(system, subCat, difficulty, isCorrect) {
    const db = readJSON(KEYS.DIFF_BREAKDOWN, {});
    const sys = system.toLowerCase();
    const cat = subCat.toLowerCase();
    const diff = difficulty.toLowerCase();
    if (!db[sys]) db[sys] = {};
    if (!db[sys][cat]) db[sys][cat] = {};
    if (!db[sys][cat][diff]) db[sys][cat][diff] = { a: 0, c: 0 };
    db[sys][cat][diff].a++;
    if (isCorrect) db[sys][cat][diff].c++;
    writeJSON(KEYS.DIFF_BREAKDOWN, db);
  },

  /**
   * Returns difficulty breakdown for a system.
   * @param {string} system
   * @returns {{ [subCat]: { easy, medium, hard } }}  each: { a, c, pct }
   */
  getDiffBreakdown(system) {
    const db = readJSON(KEYS.DIFF_BREAKDOWN, {});
    const sys = db[system.toLowerCase()] || {};
    const result = {};
    for (const [cat, diffs] of Object.entries(sys)) {
      result[cat] = {};
      for (const [diff, { a, c }] of Object.entries(diffs)) {
        result[cat][diff] = { a, c, pct: a > 0 ? Math.round((c / a) * 100) : null };
      }
    }
    return result;
  },

  // ── NEW: Session history ring buffer ──────────────────────────────────────
  /**
   * Appends one session record. Keeps only the last 10.
   * @param {{ system: string, score: number, total: number, focusedSubCat: string }} session
   */
  pushSession(session) {
    const history = readJSON(KEYS.SESSION_HISTORY, []);
    history.unshift({ ts: Date.now(), ...session });
    writeJSON(KEYS.SESSION_HISTORY, history.slice(0, 10));
  },

  /** @returns {Array} newest first, up to 10 items */
  getSessionHistory() {
    return readJSON(KEYS.SESSION_HISTORY, []);
  },

  // ── NEW: Focus recommendation ─────────────────────────────────────────────
  /**
   * Returns a recommendation object for the given system.
   * @param {'english'|'japanese'} system
   * @returns {{ subCat: string, reason: string, confidence: 'high'|'medium'|'low' }}
   */
  getFocusRecommendation(system) {
    const stats = system === 'japanese'
      ? this.getJapaneseStats()
      : this.getEnglishStats();

    const history = this.getSessionHistory().filter(s => s.system === system);
    const misses  = this.getMostMissed(10);
    const diffDB  = this.getDiffBreakdown(system);

    // Score each category: lower is worse (needs more focus)
    const scores = {};
    for (const [cat, { answered, correct }] of Object.entries(stats)) {
      if (answered === 0) { scores[cat] = { priority: 999, reason: 'never practiced' }; continue; }
      const acc = correct / answered;

      // Penalty: recent trend (last 3 sessions in this category getting worse?)
      const recentSessions = history.filter(s => s.focusedSubCat === cat).slice(0, 3);
      let trendPenalty = 0;
      if (recentSessions.length >= 2) {
        const trend = recentSessions[0].score / recentSessions[0].total
                    - recentSessions[recentSessions.length - 1].score / recentSessions[recentSessions.length - 1].total;
        if (trend < -0.1) trendPenalty = 0.15; // getting worse → boost priority
      }

      // Penalty: hard difficulty especially weak?
      const hardData = diffDB[cat]?.hard;
      const hardPenalty = (hardData && hardData.pct !== null && hardData.pct < 50) ? 0.1 : 0;

      // Penalty: this category appears often in most-missed list
      const missCount = misses.filter(m => m.subCategory.toLowerCase() === cat).length;
      const missPenalty = missCount * 0.08;

      scores[cat] = {
        priority: acc - trendPenalty - hardPenalty - missPenalty,
        acc: Math.round(acc * 100),
        answered,
        trendPenalty,
        hardPenalty,
        missPenalty,
      };
    }

    // Find the category with lowest priority score (most needs work)
    const ranked = Object.entries(scores)
      .filter(([, v]) => v.priority !== 999)
      .sort((a, b) => a[1].priority - b[1].priority);

    const neverPracticed = Object.entries(scores).filter(([, v]) => v.priority === 999);

    if (neverPracticed.length > 0) {
      return {
        subCat: neverPracticed[0][0],
        reason: `You haven't practiced ${neverPracticed[0][0]} yet — start here to get a full picture.`,
        confidence: 'low',
      };
    }

    if (ranked.length === 0) {
      return { subCat: null, reason: 'Not enough data yet.', confidence: 'low' };
    }

    const [topCat, topData] = ranked[0];
    const reasons = [];
    if (topData.acc < 60)          reasons.push(`only ${topData.acc}% accuracy`);
    if (topData.trendPenalty > 0)  reasons.push('your recent scores here are declining');
    if (topData.hardPenalty > 0)   reasons.push('you struggle on hard-level questions in this area');
    if (topData.missPenalty > 0)   reasons.push('several of your most-missed questions are from this category');

    const confidence = topData.acc < 50 || topData.missPenalty > 0.1 ? 'high'
                     : topData.acc < 70 ? 'medium' : 'low';

    return {
      subCat: topCat,
      reason: reasons.length > 0
        ? `Focus on ${topCat}: ${reasons.join(', ')}.`
        : `${topCat} is your weakest area right now (${topData.acc}% accuracy).`,
      confidence,
    };
  },

  // ── Godspeed high score ──────────────────────────────────────────────────
  getGodspeedBest()       { return readInt(KEYS.GODSPEED_BEST); },
  setGodspeedBest(value)  { writeInt(KEYS.GODSPEED_BEST, value); },

  // ── Wipe everything ───────────────────────────────────────────────────────
  clearAll() {
    Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  },
};
