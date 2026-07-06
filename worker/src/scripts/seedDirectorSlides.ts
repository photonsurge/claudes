/**
 * One-shot CLI wrapper around the "Seed look slides" admin job — see
 * worker/src/jobs/director.ts#seedKindSlides for what it actually does.
 *
 *   cd worker && yarn seed:director-slides
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { seedKindSlides } from "../jobs/director";

(async () => {
  const result = await seedKindSlides();
  for (const [sceneId, kinds] of Object.entries(result.seeded)) {
    console.log(`[seedDirectorSlides] scene "${sceneId}": seeded ${kinds.join(", ")}`);
  }
  if (Object.keys(result.seeded).length === 0) {
    console.log("[seedDirectorSlides] every scene already has slides, nothing to do");
  }
  console.log("[seedDirectorSlides] done");
  process.exit(0);
})().catch((err) => {
  console.error("[seedDirectorSlides] failed:", err);
  process.exit(1);
});
