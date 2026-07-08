/* TEMP: dump the persisted director config for the default scene. */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();
import { getAppDb } from "@photonsurge/shared/db/index";
import { volcanoHoldMs, kindHoldMs } from "@photonsurge/shared/director";

(async () => {
  const db = await getAppDb();
  const cfg = await db.getOrInitDirectorConfig("default");
  console.log("mode:", cfg.mode, " transitionSeconds:", (cfg as any).transitionSeconds);
  console.log("kindHoldSeconds:", JSON.stringify(cfg.kindHoldSeconds));
  console.log("volcanoHoldSeconds:", JSON.stringify((cfg as any).volcanoHoldSeconds));
  console.log("quakeHoldSeconds:", JSON.stringify((cfg as any).quakeHoldSeconds));
  console.log("stormHoldSeconds:", JSON.stringify((cfg as any).stormHoldSeconds));
  console.log("computed kindHoldMs(intro):", kindHoldMs(cfg, "intro"));
  console.log("computed kindHoldMs(volcano):", kindHoldMs(cfg, "volcano"));
  console.log("computed volcanoHoldMs(minor):", volcanoHoldMs(cfg, "minor" as any));
  console.log("computed volcanoHoldMs(major):", volcanoHoldMs(cfg, "major" as any));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
