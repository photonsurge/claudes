/**
 * One-shot: write a short-video script from the lineup template — the same code
 * as the `short-video.generate` job — and print it.
 *
 *   yarn short:generate --country japan             (round-up video)
 *   yarn short:generate --area europe --alerts --quakes --budget 90
 *   yarn short:generate --globe --dry               (print only, nothing written)
 *
 * Flags: --country <id> | --area <id> | --globe, --alerts, --quakes,
 * --volcanoes (event kinds are opt-in; none = round-up only), --budget <seconds>,
 * --scene <id> (default SHORTS_SCENE_ID, "shorts"), --dry.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { scriptDurationMs } from "@photonsurge/shared/short-script";
import { generateShortScript, type GenerateRequest } from "../director/script-generate";

function parseArgs(argv: string[]): { req: GenerateRequest; dry: boolean } {
  const include = { alerts: false, quakes: false, volcanoes: false };
  const req: GenerateRequest = { scope: undefined, include };
  let dry = false;
  const value = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--country") req.scope = { type: "country", id: value(i++, a) };
    else if (a === "--area") req.scope = { type: "area", id: value(i++, a) };
    else if (a === "--globe") req.scope = { type: "globe" };
    else if (a === "--alerts") include.alerts = true;
    else if (a === "--quakes") include.quakes = true;
    else if (a === "--volcanoes") include.volcanoes = true;
    else if (a === "--budget") req.budgetMs = Number(value(i++, a)) * 1000;
    else if (a === "--scene") req.sceneId = value(i++, a);
    else if (a === "--dry") dry = true;
    else throw new Error(`unknown flag ${a}`);
  }
  if (!req.scope) throw new Error("pick a scope: --country <id> | --area <id> | --globe");
  if (req.budgetMs != null && !(req.budgetMs > 0)) throw new Error("--budget must be a positive number of seconds");
  return { req, dry };
}

const secs = (ms: number) => (ms / 1000).toFixed(1).padStart(6);

(async () => {
  const { req, dry } = parseArgs(process.argv.slice(2));
  const db = await getAppDb();
  const script = await generateShortScript(db, req, { dryRun: dry });

  console.log(`\n${dry ? "(dry run — not saved)" : `saved script ${script.id}`}`);
  console.log(`title:  ${script.title}`);
  console.log(`scope:  ${JSON.stringify(script.scope)}  include: ${JSON.stringify(script.include)}`);
  console.log(`length: ${(scriptDurationMs(script.clips) / 1000).toFixed(1)}s over ${script.clips.length} clips\n`);
  console.log(`  ${"secs".padStart(6)}  ${"target".padEnd(48)}  label`);
  for (const c of script.clips) {
    const extra = [c.maxStops != null ? `maxStops=${c.maxStops}` : "", c.leadSlide ? `lead=${c.leadSlide}` : ""].filter(Boolean).join(" ");
    const label = [c.label.icon, c.label.title, c.label.subtitle ? `· ${c.label.subtitle}` : ""].filter(Boolean).join(" ");
    console.log(`  ${secs(c.durationMs)}  ${c.target.padEnd(48)}  ${label}${extra ? `  [${extra}]` : ""}`);
  }
  process.exit(0);
})().catch((err) => {
  console.error("short:generate failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
