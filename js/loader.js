/**
 * loader.js — Phase 5 (also carries the Phase 1 fetch work)
 * Responsible for fetching the two JSON data files and populating
 * state.baselineQuizData and state.japaneseQuizData.
 *
 * Usage:
 *   import { loadSystemDatabases } from './loader.js';
 *   await loadSystemDatabases();
 */

import { state } from './state.js';

/**
 * Fetches english.json and japanese.json from the data/ folder in parallel.
 * Mutates state directly once both responses arrive.
 *
 * @returns {Promise<void>}
 * @throws  Will rethrow if either fetch fails; caller should catch and show UI error.
 */
export async function loadSystemDatabases() {
  const [enRes, jaRes] = await Promise.all([
    fetch('./data/english.json'),
    fetch('./data/japanese.json'),
  ]);

  if (!enRes.ok) throw new Error(`English data fetch failed: ${enRes.status}`);
  if (!jaRes.ok) throw new Error(`Japanese data fetch failed: ${jaRes.status}`);

  state.baselineQuizData = await enRes.json();
  state.japaneseQuizData = await jaRes.json();
}
