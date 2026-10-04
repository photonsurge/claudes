// Placeholder until WP3 (docs/crossword-mode-plan.md §11): the runner's inject handler.
import { UnrecoverableError, type Job } from "bullmq";

/** Job handler: `crossword.inject`. */
export async function inject(_job: Job) {
  throw new UnrecoverableError("crossword.inject is not built yet");
}
