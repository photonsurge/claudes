// Placeholder until WP2 (docs/crossword-mode-plan.md §11): puzzle-building jobs.
import { UnrecoverableError, type Job } from "bullmq";

const notYet = (name: string) => async (_job: Job) => {
  throw new UnrecoverableError(`crossword.${name} is not built yet`);
};

/** Job handler: `crossword.generate`. */
export const generate = notYet("generate");
/** Job handler: `crossword.topUp`. */
export const topUp = notYet("topUp");
/** Job handler: `crossword.writeClues`. */
export const writeClues = notYet("writeClues");
/** Job handler: `crossword.bankIndex`. */
export const bankIndex = notYet("bankIndex");
