/**
 * Manual one-shot — `yarn short:play <scriptId> [--from <n>] [--record]`.
 * Starts a saved short script playing on its FORMAT's scene
 * (`sceneIdForScript` — the same scene /admin/shorts previews on and a render
 * uses) by writing that scene's director config (`mode: "script"` + a fresh
 * `script.playNonce`). It only writes Mongo: the RUNNING worker's script runner
 * picks the play up within a second and airs it on /watch/<scene>. Defaults:
 * from clip 0, no as-run log (pass --record to log the play to /admin/runs).
 *
 * Stop a play with `--stop [<scriptId> | --format <id>]` (default: the
 * default format's scene), or by setting the scene's director mode to off.
 */
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { sceneIdForScript, scriptDurationMs } from "@photonsurge/shared/short-script";
import { DEFAULT_SHORT_FORMAT_ID } from "@photonsurge/shared/short-format";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

(async () => {
  const db = await getAppDb();
  // The first bare argument that isn't a flag's value.
  const valued = new Set(["--format", "--from"]);
  const scriptId = process.argv.slice(2).find((a, i, all) => !a.startsWith("--") && !valued.has(all[i - 1]));

  if (process.argv.includes("--stop")) {
    const script = scriptId ? await db.shortScripts.get(scriptId) : null;
    if (scriptId && !script) {
      console.error(`no short script with id "${scriptId}"`);
      process.exit(1);
    }
    const sceneId = script ? sceneIdForScript(script) : argValue("--format") ?? DEFAULT_SHORT_FORMAT_ID;
    await db.saveDirectorConfig(sceneId, { mode: "off" });
    console.log(`scene ${sceneId}: director set to off (a playing script stops within a second)`);
    await db.conn.close();
    process.exit(0);
  }

  if (!scriptId) {
    console.error("usage: yarn short:play <scriptId> [--from <n>] [--record] | --stop [<scriptId> | --format <id>]");
    process.exit(1);
  }
  const fromClip = Math.max(0, Math.floor(Number(argValue("--from") ?? 0)) || 0);
  const record = process.argv.includes("--record");

  const script = await db.shortScripts.get(scriptId);
  if (!script) {
    console.error(`no short script with id "${scriptId}"`);
    process.exit(1);
  }
  const sceneId = sceneIdForScript(script);
  if (!(await db.getScene(sceneId))) {
    console.warn(
      `warning: format scene "${sceneId}" doesn't exist yet — the play still runs, but nothing renders it until the scene exists` +
        ` (yarn seed:short-format creates the default format's)`,
    );
  }

  const cfg = await db.getOrInitDirectorConfig(sceneId);
  // Any change of nonce starts a play. A timestamp also never repeats a nonce
  // this scene answered before a restart (the runner's restart guard).
  const playNonce = Math.max((cfg.script?.playNonce ?? 0) + 1, Date.now());
  await db.saveDirectorConfig(sceneId, { mode: "script", script: { scriptId, fromClip, playNonce, record } });

  const remaining = script.clips.slice(fromClip);
  console.log(
    `scene ${sceneId}: playing "${script.title}" (${scriptId}) from clip ${fromClip} — ` +
      `${remaining.length} clip(s), ${Math.round(scriptDurationMs(remaining) / 1000)}s before skips, ` +
      `as-run ${record ? "on" : "off"}, nonce ${playNonce}`,
  );
  console.log(`watch: /watch/${sceneId}. The worker must be running; afterwards its play record for this scene shows what aired.`);
  await db.conn.close();
  process.exit(0);
})().catch((err) => {
  console.error("playShortScript fatal:", err);
  process.exit(1);
});
