/**
 * One-shot CLI wrapper around the "Clear look slides" admin job — see
 * worker/src/jobs/director.ts#clearKindSlides for what it actually does.
 * Destructive: wipes every scene's saved-slide library (mainly useful when
 * iterating on DEFAULT_KIND_SLIDES so a re-seed lays down the new set).
 *
 *   cd worker && yarn clear:director-slides
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { clearKindSlides } from "../jobs/director";

(async () => {
  const result = await clearKindSlides();
  for (const [sceneId, kinds] of Object.entries(result.cleared)) {
    console.log(`[clearDirectorSlides] scene "${sceneId}": cleared ${kinds.join(", ")}`);
  }
  if (Object.keys(result.cleared).length === 0) {
    console.log("[clearDirectorSlides] every scene's slide library is already empty, nothing to do");
  }
  console.log("[clearDirectorSlides] done");
  process.exit(0);
})().catch((err) => {
  console.error("[clearDirectorSlides] failed:", err);
  process.exit(1);
});
