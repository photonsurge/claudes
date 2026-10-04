/**
 * `crossword.inject` (foreground) — the Desk's simulator and controls
 * (docs/crossword-mode-plan.md §8.3). The job runs in the worker process that
 * hosts the runner, so it drives the in-process runner directly.
 *
 * A simulated message goes through the same answer path as a YouTube one,
 * marked `sim`, under the player id `sim:<name>`. It is NOT written to the
 * chat log: the chat log is what YouTube said.
 */
import { UnrecoverableError, type Job } from "bullmq";
import { CROSSWORD_COMMANDS, type CrosswordInject } from "@photonsurge/shared/crossword";
import { simPlayerId } from "@photonsurge/shared/crossword-records";
import { log } from "@photonsurge/shared/utill/logger";
import {
  commandTo,
  crosswordDeps,
  crosswordRunnerState,
  submitAnswersTo,
  type CrosswordRunnerDeps,
  type CrosswordRunnerState,
} from "./runner";

const TAG = "job:crossword";

/** Apply one inject payload to a runner. Throws (unrecoverably) on a bad payload or a scene with no runner. */
export async function handleInject(
  payload: CrosswordInject,
  state: CrosswordRunnerState,
  deps: CrosswordRunnerDeps,
  now: number,
) {
  const sceneId = typeof payload?.sceneId === "string" ? payload.sceneId : "";
  if (!sceneId) throw new UnrecoverableError("crossword.inject: sceneId is required");
  const notRunning = () =>
    new UnrecoverableError(`crossword.inject: the host is not running on "${sceneId}" (not a crossword channel, or not enabled)`);

  if (payload.kind === "sim") {
    const name = String(payload.name ?? "").trim();
    const text = String(payload.text ?? "");
    if (!name || !text) throw new UnrecoverableError("crossword.inject: sim needs a name and text");
    const typedAt = typeof payload.at === "number" && Number.isFinite(payload.at) ? Math.min(payload.at, now) : now;
    const res = await submitAnswersTo(state, sceneId, [{ playerId: simPlayerId(name), name, text, typedAt, sim: true }], now, deps);
    if (!res.running) throw notRunning();
    return { kind: "sim", solved: res.solved };
  }
  if (payload.kind === "command") {
    if (!CROSSWORD_COMMANDS.includes(payload.command)) {
      throw new UnrecoverableError(`crossword.inject: unknown command "${String(payload.command)}"`);
    }
    if (!(await commandTo(state, sceneId, payload.command, now, deps))) throw notRunning();
    return { kind: "command", command: payload.command };
  }
  throw new UnrecoverableError(`crossword.inject: unknown kind "${String((payload as { kind?: unknown })?.kind)}"`);
}

/** Job handler: `crossword.inject`. */
export async function inject(job: Job) {
  const payload = (job.data?.data ?? {}) as CrosswordInject;
  const result = await handleInject(payload, crosswordRunnerState(), await crosswordDeps(), Date.now());
  log(TAG, "inject done", { sceneId: payload.sceneId, ...result });
  return result;
}
