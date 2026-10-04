/**
 * The offline test's preflight report (docs/short-video-plan.md §7.1): what a
 * render would do, checked with NO side effects — nothing queued, no script
 * saved, no director config written, no YouTube API call, no OBS command
 * beyond the read-only probe the encoders card's "Test connection" uses.
 *
 *  - Clips: each clip of the script resolved against live data the way the
 *    runner will resolve it, the skipped ones with their reason. A generate
 *    request is generated as a DRY RUN (it is generated again at the front of
 *    the queue); an `auto` scope is only picked at the front.
 *  - Length: what would play against the format's budget.
 *  - Encoder: the named encoder probed; for "any", every enabled video encoder.
 *  - YouTube: the chosen account usable — connected, no stamped `authError`,
 *    quota not marked spent and enough left for a video — read from what the
 *    worker already records (Mongo and the Redis quota meter).
 */
import { getAppDb, type AppDb } from "@photonsurge/shared/db/index";
import { ENV_ENCODER_ID, encoderUse } from "@photonsurge/shared/runs";
import {
  ANY_ENCODER,
  type PreflightLevel,
  type ShortRenderPreflight,
  type ShortRenderRequest,
} from "@photonsurge/shared/short-render";
import { sceneIdForScript, type ShortClip, type ShortScript } from "@photonsurge/shared/short-script";
import type { ShortFormat } from "@photonsurge/shared/short-format";
import { generateFormat, generateShortScript, sceneDirectorConfig } from "../director/script-generate";
import { resolveClip } from "../director/script-resolve";
import { probe, type ObsProbe } from "../obs/client";
import { endpointForEncoderId } from "./encoders";
import { quotaAllowsRender } from "./render-queue";
import { formatDuration } from "./script-values";

const errMsg = (err: unknown) => String((err as Error)?.message ?? err);

/** Injectable for tests: the read-only OBS probe of one encoder. */
export interface PreflightDeps {
  probeEncoder: (encoderId: string) => Promise<ObsProbe>;
}

const defaultDeps: PreflightDeps = {
  probeEncoder: async (encoderId) => probe(await endpointForEncoderId(encoderId)),
};

const worst = (...levels: PreflightLevel[]): PreflightLevel =>
  levels.includes("fail") ? "fail" : levels.includes("warn") ? "warn" : "ok";

/** Over the budget by more than this share is worth a warning. */
const BUDGET_SLACK = 0.1;

async function scriptPart(
  db: AppDb,
  req: ShortRenderRequest,
  now: number,
): Promise<{ part: ShortRenderPreflight["script"]; format?: ShortFormat; clips: ShortClip[]; sceneId?: string }> {
  const empty = { clips: [], skipped: [] };
  let script: ShortScript | null = null;
  let formatId: string;
  if (req.what.type === "script") {
    script = await db.shortScripts.get(req.what.scriptId).catch(() => null);
    if (!script) return { part: { level: "fail", note: `script ${req.what.scriptId} not found`, ...empty }, clips: [] };
    formatId = sceneIdForScript(script);
  } else {
    formatId = req.what.formatId;
  }
  let format: ShortFormat;
  try {
    format = await generateFormat(db, formatId);
  } catch (err) {
    return { part: { level: "fail", title: script?.title, note: errMsg(err), ...empty }, clips: [] };
  }
  if (req.what.type === "generate") {
    const what = req.what;
    if (what.scope.type === "auto") {
      return {
        part: {
          level: "ok",
          generated: true,
          note: `The busiest ${what.scope.of} is picked when the video reaches the front of the queue, so its clips aren't known yet.`,
          ...empty,
        },
        format,
        clips: [],
      };
    }
    try {
      script = await generateShortScript(db, { formatId, scope: what.scope, include: what.include }, { dryRun: true, now });
    } catch (err) {
      return { part: { level: "fail", generated: true, note: `generate failed: ${errMsg(err)}`, ...empty }, format, clips: [] };
    }
  }
  return {
    part: {
      level: "ok",
      title: script!.title,
      ...(req.what.type === "generate"
        ? { generated: true, note: "A dry run of generate: the video is generated again, from fresh data, when it reaches the front." }
        : {}),
      ...empty,
    },
    format,
    clips: script!.clips,
    sceneId: sceneIdForScript(script!),
  };
}

async function encoderPart(db: AppDb, req: ShortRenderRequest, deps: PreflightDeps): Promise<ShortRenderPreflight["encoder"]> {
  let targets: { id: string; name?: string }[];
  if (req.encoderId === ANY_ENCODER) {
    const all = await db.listStreamEncoders();
    targets = all.filter((e) => e.enabled && encoderUse(e) === "videos").map((e) => ({ id: e.id, name: e.name }));
    if (!targets.length) return { level: "fail", checked: [], note: "No enabled video encoder: assign one to videos on /admin/streams, or pick an encoder." };
  } else if (req.encoderId === ENV_ENCODER_ID) {
    targets = [{ id: ENV_ENCODER_ID, name: "Env OBS" }];
  } else {
    const enc = await db.getStreamEncoder(req.encoderId);
    targets = [{ id: req.encoderId, name: enc?.name }];
  }
  const checked = await Promise.all(
    targets.map(async (t) => {
      try {
        const p = await deps.probeEncoder(t.id);
        return { ...t, reachable: true, detail: `OBS ${p.obsVersion}${p.streaming ? " · streaming right now" : ""}` };
      } catch (err) {
        return { ...t, reachable: false, detail: errMsg(err) };
      }
    }),
  );
  const up = checked.filter((c) => c.reachable).length;
  if (!up) return { level: "fail", checked, note: checked.length > 1 ? "No video encoder answered." : "The encoder did not answer." };
  if (up < checked.length) return { level: "warn", checked, note: `${up} of ${checked.length} video encoders answered; the video goes to one that is idle.` };
  return { level: "ok", checked };
}

async function youtubePart(
  db: AppDb,
  req: ShortRenderRequest,
  format: ShortFormat | undefined,
  now: number,
): Promise<ShortRenderPreflight["youtube"]> {
  if (req.offline) return { level: "ok", used: false, note: "Not used: an offline test never contacts YouTube." };
  const wanted = req.accountId ?? format?.render.accountId;
  const account = await db.getYoutubeAccount(wanted);
  if (!account) {
    return {
      level: "fail",
      used: true,
      accountId: wanted,
      note: wanted ? `YouTube channel ${wanted} is not connected.` : "No YouTube channel is connected.",
    };
  }
  const base = { used: true, accountId: account.id, accountTitle: account.channelTitle };
  if (account.authError) {
    return { ...base, level: "fail", note: `Needs reconnecting: ${(account.authError as { message?: string }).message ?? "authorisation failed"}.` };
  }
  if (!account.refreshTokenEnc) return { ...base, level: "fail", note: "Connected without a refresh token: reconnect it." };
  const quota = await quotaAllowsRender(account.id, now);
  if (!quota.ok) return { ...base, level: "fail", note: quota.note };
  return { ...base, level: "ok", note: "Connected, and the quota meter has room for a video." };
}

/** Build the preflight report for a render request. Never throws; never writes. */
export async function preflightRender(
  req: ShortRenderRequest,
  deps: PreflightDeps = defaultDeps,
  now = Date.now(),
): Promise<ShortRenderPreflight> {
  const db = await getAppDb();
  const { part: script, format, clips, sceneId } = await scriptPart(db, req, now).catch((err) => ({
    part: { level: "fail", note: errMsg(err), clips: [], skipped: [] } as ShortRenderPreflight["script"],
    format: undefined,
    clips: [] as ShortClip[],
    sceneId: undefined,
  }));

  // Resolve each clip the way the runner will, against the scene's look —
  // read-only (no first-read insert of a director config).
  let playMs = 0;
  if (clips.length && sceneId) {
    const cfg = await sceneDirectorConfig(db, sceneId, true);
    for (const clip of clips) {
      const title = clip.label?.title || clip.target;
      const res = await resolveClip(db, cfg, clip, now);
      if ("skipped" in res) script.skipped.push({ id: clip.id, title, reason: res.skipped });
      else {
        script.clips.push({ id: clip.id, title, durationMs: clip.durationMs });
        playMs += clip.durationMs;
      }
    }
    if (!script.clips.length) {
      script.level = "fail";
      script.note = "Nothing would play: every clip is skipped.";
    } else if (script.skipped.length) {
      script.level = worst(script.level, "warn");
    }
  } else if (script.level === "ok" && !script.generated) {
    script.level = "fail";
    script.note = "The script has no clips.";
  }

  const budgetMs = format?.template.budgetMs ?? 0;
  const length: ShortRenderPreflight["length"] = { level: "ok", playMs, budgetMs };
  if (!script.clips.length) {
    length.note = script.generated && !script.skipped.length && script.level !== "fail" ? "Known once it is generated." : "Nothing would play.";
    length.level = script.level === "fail" ? "fail" : "ok";
  } else if (budgetMs && playMs > budgetMs * (1 + BUDGET_SLACK)) {
    length.level = "warn";
    length.note = `${formatDuration(playMs)} is over the format's ${formatDuration(budgetMs)} budget.`;
  } else {
    length.note = `${formatDuration(playMs)} of the format's ${formatDuration(budgetMs)} budget.`;
  }

  const [encoder, youtube] = await Promise.all([
    encoderPart(db, req, deps).catch((err) => ({ level: "fail" as const, checked: [], note: errMsg(err) })),
    youtubePart(db, req, format, now).catch((err) => ({ level: "fail" as const, used: !req.offline, note: errMsg(err) })),
  ]);

  return {
    ok: worst(script.level, length.level, encoder.level, youtube.level) !== "fail",
    at: now,
    ...(format ? { format: { id: format.id, name: format.name } } : {}),
    script,
    length,
    encoder,
    youtube,
  };
}
