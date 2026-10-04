/**
 * Crossword channel (docs/crossword-mode-plan.md §9) — the worker jobs.
 *
 *  • inject (foreground) — a Desk simulator message or command into the
 *    scene's runner. See crossword/inject.ts.
 *  • generate, topUp, writeClues, bankIndex (background) — puzzle building and
 *    the word bank. See crossword/build-jobs.ts.
 *
 * The job loader registers every export of this file as a handler, so it
 * re-exports handlers ONLY.
 */
export { inject } from "../crossword/inject";
export { generate, topUp, writeClues, bankIndex } from "../crossword/build-jobs";
