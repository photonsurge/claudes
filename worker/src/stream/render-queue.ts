/**
 * The render queue (docs/short-video-plan.md §6.6): one OBS instance makes one
 * video at a time, so each encoder works through its own queue in order, and a
 * shared "any" pool feeds whichever video encoder is idle first. State lives in
 * Mongo (`db.shortRenders`); the queue advances when a video is queued, when a
 * render's run ends, and on the 60 s `run-lifecycle.renders` ticker, so nothing
 * is lost across a restart.
 *
 * Rules:
 *  - A named encoder takes its own queue first; a VIDEO encoder (use "videos")
 *    then takes from the "any" pool. A channel encoder only takes videos queued
 *    for it by name.
 *  - An encoder is busy while any run is active on it (a channel run blocks the
 *    queue until it ends — never pre-empted), while an enabled slot holds it,
 *    or while a render it took is preparing / live.
 *  - One video per format at a time: a format plays on its own scene.
 *  - HEAD-OF-LINE WAIT: when the next video for an encoder is in a format that
 *    is busy elsewhere, the encoder WAITS — it does not skip ahead to a later
 *    video. That keeps a named encoder's batch in order (§13 "Blocked first
 *    video": waiting is the simpler of the two options). The "any" pool waits
 *    the same way.
 *  - Paused: a paused encoder finishes the video that is live and starts nothing.
 *  - `startBy`: a video still queued past it is skipped as too late.
 *  - `notBefore` (the Render form's "At"): a video is not in line until then;
 *    the 60 s ticker starts it once the time comes.
 *  - At the front, in order: quota check (live only), the script (saved, or:
 *    `auto` scope resolved to a place, `skipIfQuiet`, the round-up freshness
 *    check and refresh, then generate — §8), the title-code values (with the
 *    schedule's `%{n}`), the title and description resolved onto a new Run,
 *    then goLive. Any failure there fails
 *    THAT video with a note and the queue moves on — one failure never stops a
 *    batch.
 */
import { getQueue } from "@photonsurge/shared/bull/bull";
import { getAppDb, type AppDb } from "@photonsurge/shared/db/index";
import {
  ENV_ENCODER_ID,
  encoderKeyForRun,
  encoderUse,
  runIsActive,
  runIsFinished,
  type Run,
  type StreamEncoder,
  type StreamSlot,
} from "@photonsurge/shared/runs";
import {
  ANY_ENCODER,
  renderCanRetry,
  renderIsActive,
  renderIsWaiting,
  renderFormatId,
  type ShortFormatVideo,
  type ShortRender,
  type ShortRenderRequest,
} from "@photonsurge/shared/short-render";
import {
  sceneIdForScript,
  scriptDurationMs,
  type ShortInclude,
  type ShortPlace,
  type ShortScope,
  type ShortScript,
} from "@photonsurge/shared/short-script";
import type { DirectorConfig } from "@photonsurge/shared/director";
import type { SummaryPeriod } from "@photonsurge/shared/db/event-summary-model";
import { PLACE_TIMEZONE, type ShortFormat } from "@photonsurge/shared/short-format";
import { countryShot } from "@photonsurge/shared/director-countries";
import {
  clipYouTubeDescription,
  formatVideoText,
  isValidTimeZone,
  trimVideoTitle,
  VIDEO_TEXT_TIMEZONE,
} from "@photonsurge/shared/video-text";
import { log } from "@photonsurge/shared/utill/logger";
import { generateFormat, generateShortScript, sceneDirectorConfig } from "../director/script-generate";
import { resolveAutoScope, scopeHasActivity } from "../director/script-auto";
import { refreshPlaceRoundup } from "../placeRoundups/refresh";
import { exhaustedUntil, fmtResetTime, quotaSnapshot } from "../youtube/quota";
import { watchBaseUrl } from "./encoders";
import { formatDuration, scriptValues } from "./script-values";

const TAG = "render-queue";

const envNum = (name: string, dflt: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 && process.env[name] !== "" && process.env[name] !== undefined ? n : dflt;
};

/** Deployment settings (§6.9), env with a default like VOD_LEAD_MS. */
export const renderEnv = {
  /** Units one video costs: create, bind, two transitions, thumbnail, finalize (§6.3). */
  quotaPerVideo: () => envNum("RENDER_QUOTA_PER_VIDEO", 400),
  /** Head-room kept on top of the estimate before a video is started. */
  quotaMargin: () => envNum("RENDER_QUOTA_MARGIN", 100),
  /** Safety cap on a render run past the script's own length (§6.9: 2 min). */
  safetyCapMs: () => envNum("RENDER_SAFETY_CAP_MS", 120_000),
  /** A render stuck in `preparing` with no run this long (crash mid-start) fails. */
  prepareTimeoutMs: () => envNum("RENDER_PREPARE_TIMEOUT_MS", 10 * 60_000),
};

/** The video title when neither the format nor the render names one. */
export const DEFAULT_VIDEO_TITLE = "%{place} %{kind} · %A %e %B";

/** A video that won't render, with the reason recorded on it. */
class RenderOutcome extends Error {
  constructor(
    readonly status: "failed" | "skipped",
    note: string,
  ) {
    super(note);
    this.name = "RenderOutcome";
  }
}

const errMsg = (err: unknown) => String((err as Error)?.message ?? err);

// ---- the format and the generate path ----

/**
 * The format a render is made in (§5.2): its YouTube video card, timing and
 * render defaults come from `db.shortFormats` — never the scene's channel
 * YouTube card. The default format works before it is seeded (its defaults);
 * an unknown format fails the video.
 */
export async function loadRenderFormat(db: AppDb, formatId: string): Promise<ShortFormat> {
  try {
    return await generateFormat(db, formatId);
  } catch (err) {
    throw new RenderOutcome("failed", errMsg(err));
  }
}

/**
 * Generate at the front of the queue — the ONE call into the generate path, in
 * the render's format. An `auto` scope is resolved to a place before this
 * (`generateAtFront`), so one still here fails.
 */
export async function generateForRender(
  db: AppDb,
  what: Extract<ShortRender["what"], { type: "generate" }>,
): Promise<ShortScript> {
  if (what.scope.type === "auto") throw new RenderOutcome("failed", "auto scope was not resolved to a place");
  return generateShortScript(db, { formatId: what.formatId, scope: what.scope, include: what.include });
}

/** How many of a schedule's latest videos `auto` won't repeat the place of (§8). */
export const AUTO_SKIP_RECENT = 3;

// ---- pure helpers ----

/** Title, description and thumbnail resolved for one video (§6.8). */
export interface ResolvedVideoText {
  title: string;
  description: string;
  /** Image source resolved; undefined = no image (none, or a frame). */
  thumbnailUrl?: string;
  /** A frame thumbnail: taken from OBS this far into the play (§6.8). */
  thumbnailFrameAtMs?: number;
}

/**
 * Resolve the video's YouTube text from its settings and values. `%{duration}`
 * and the date codes are filled here, at render time. The title is cut to
 * YouTube's 100 characters at a word, the description to its limit, with the
 * site link appended as it is for live descriptions.
 */
export function resolveVideoText(
  video: ShortFormatVideo,
  values: Record<string, string>,
  durationMs: number,
  now: Date,
  siteUrl: string = watchBaseUrl(),
): ResolvedVideoText {
  // "place" = the video's own zone: no per-place zone is stored yet, so London.
  // A several-places video has no single place and is London either way (§6.8).
  const tz =
    video.timezone && video.timezone !== PLACE_TIMEZONE && isValidTimeZone(video.timezone) ? video.timezone : VIDEO_TEXT_TIMEZONE;
  const vals = { ...values, duration: formatDuration(durationMs) };
  const title = trimVideoTitle(formatVideoText(video.title || DEFAULT_VIDEO_TITLE, vals, now, tz)) || "Untitled video";
  let description = formatVideoText(video.description || "", vals, now, tz).trim();
  const site = siteUrl.trim().replace(/\/+$/, "");
  if (site && !description.includes(site)) description = `${description ? `${description}\n\n` : ""}Watch the map live: ${site}`;
  const out: ResolvedVideoText = { title, description: clipYouTubeDescription(description) };
  if (video.thumbnail?.source === "image") {
    out.thumbnailUrl = formatVideoText(video.thumbnail.url || "", vals, now, tz).trim();
  }
  // A frame: a GetSourceScreenshot of the render `atMs` into the script's play,
  // uploaded like an image (stream/script-shots.ts).
  if (video.thumbnail?.source === "frame") out.thumbnailFrameAtMs = Math.max(0, Math.round(video.thumbnail.atMs || 0));
  return out;
}

export interface PlanInput {
  /** Every unfinished render (queued, preparing, live). */
  renders: ShortRender[];
  encoders: Pick<StreamEncoder, "id" | "enabled" | "use" | "sceneId">[];
  activeRuns: Pick<Run, "id" | "encoderId" | "sceneId" | "status">[];
  slots: Pick<StreamSlot, "id" | "enabled" | "encoderId" | "sceneId">[];
  paused: Set<string>;
  /** The format (scene) a render plays in; undefined when it can't be known yet. */
  formatOf: (r: ShortRender) => string | undefined;
  /** Now — a video queued for later (`notBefore`) is not in line until then. Default Date.now(). */
  now?: number;
}

/**
 * Which queued renders start now, on which encoder. Pure: encoders in id order,
 * renders in queue order. See the rules at the top of this file — in particular
 * an encoder whose next video's format is busy elsewhere WAITS.
 */
export function planRenderStarts(input: PlanInput): { renderId: string; encoderId: string }[] {
  const busyEncoders = new Set<string>();
  const busyFormats = new Set<string>();
  for (const run of input.activeRuns) {
    if (!runIsActive(run.status)) continue;
    busyEncoders.add(encoderKeyForRun(run));
    busyFormats.add(run.sceneId);
  }
  for (const r of input.renders) {
    if (!renderIsActive(r.status)) continue;
    if (r.assignedEncoderId) busyEncoders.add(r.assignedEncoderId);
    const f = input.formatOf(r);
    if (f) busyFormats.add(f);
  }
  const held = (enc: PlanInput["encoders"][number]) =>
    input.slots.some((s) => s.enabled && (s.encoderId ? s.encoderId === enc.id : !!enc.sceneId && enc.sceneId === s.sceneId));

  // A video queued "At" a later time (§6.1) isn't in line yet: it doesn't hold
  // up the videos behind it.
  const now = input.now ?? Date.now();
  const queued = input.renders
    .filter((r) => r.status === "queued" && !renderIsWaiting(r, now))
    .sort((a, b) => a.queuedAt - b.queuedAt);
  const taken = new Set<string>();
  const picks: { renderId: string; encoderId: string }[] = [];
  for (const enc of [...input.encoders].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!enc.enabled || input.paused.has(enc.id) || busyEncoders.has(enc.id) || held(enc)) continue;
    const own = queued.find((r) => !taken.has(r.id) && r.encoderId === enc.id);
    const next =
      own ?? (encoderUse(enc) === "videos" ? queued.find((r) => !taken.has(r.id) && r.encoderId === ANY_ENCODER) : undefined);
    if (!next) continue;
    const format = input.formatOf(next);
    if (format && busyFormats.has(format)) continue; // head-of-line: wait for the format
    taken.add(next.id);
    busyEncoders.add(enc.id);
    if (format) busyFormats.add(format);
    picks.push({ renderId: next.id, encoderId: enc.id });
  }
  return picks;
}

/** How a finished run maps onto its render's outcome. */
export function renderOutcomeForRun(run: Run): Pick<ShortRender, "status" | "note" | "videoUrl"> {
  const url = run.platforms?.youtube?.watchUrl;
  if (run.status === "ended" && run.script?.playEnded === "finished") {
    return { status: "done", ...(url && !run.script.offline ? { videoUrl: url } : {}) };
  }
  if (run.status === "stopped") return { status: "failed", note: "stopped by operator" };
  if (run.status === "failed") return { status: "failed", note: run.error?.message || "the run failed" };
  return { status: "failed", note: "the run ended before the script finished (safety cap)" };
}

// ---- the queue ----

// The worker is one process: chain every advance so two (the ticker and a
// run-end hook) can't both give the same idle encoder a video.
let chain: Promise<unknown> = Promise.resolve();
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

/** Quota gate (§13, user decision): a live video needs about one video's units plus a margin. */
export async function quotaAllowsRender(accountId: string, now = Date.now()): Promise<{ ok: true } | { ok: false; note: string }> {
  const blocked = await exhaustedUntil(accountId, now);
  if (blocked) return { ok: false, note: `quota low: the YouTube API quota is spent until ${fmtResetTime(blocked)}` };
  const snap = await quotaSnapshot(accountId, now);
  const need = renderEnv.quotaPerVideo() + renderEnv.quotaMargin();
  if (snap.remaining < need) {
    return { ok: false, note: `quota low: ${snap.remaining} YouTube API units left today, a video needs about ${need}` };
  }
  return { ok: true };
}

/** The world round-up's cadences, any of which a globe video can open with. */
const WORLD_PERIODS: SummaryPeriod[] = ["hourly", "12h", "daily"];

/**
 * Freshness of the scope's round-up against the render's rule; null when fine
 * (or no rule). A place's is its latest place round-up; the globe's is the
 * newest world round-up of any cadence.
 */
export async function staleRoundup(
  db: AppDb,
  scope: ShortPlace | Extract<ShortScope, { type: "globe" }>,
  rule: ShortRender["roundup"],
  now: number,
): Promise<string | null> {
  if (!rule) return null;
  let at: number | null = null;
  let label: string;
  if (scope.type === "globe") {
    label = "the world";
    const docs = await Promise.all(WORLD_PERIODS.map((p) => db.eventSummaries.latest(p).catch(() => null)));
    for (const d of docs) {
      const t = d?.generatedAt ? new Date(d.generatedAt).getTime() : NaN;
      if (Number.isFinite(t) && (at == null || t > at)) at = t;
    }
  } else {
    const placeId = scope.type === "country" ? countryShot(scope.id)?.iso2.toLowerCase() : scope.id;
    if (!placeId) return null; // an unknown country: generate says so
    label = scope.id;
    const repo = scope.type === "country" ? db.countryRoundups : db.regionRoundups;
    const latest = await repo.latestForPlace(placeId).catch(() => null);
    at = latest?.generatedAt ? new Date(latest.generatedAt).getTime() : null;
  }
  if (at == null) return `no round-up for ${label}`;
  const ageMs = now - at;
  if (ageMs <= rule.maxAgeHours * 3_600_000) return null;
  return `round-up for ${label} is ${Math.round(ageMs / 3_600_000)} h old (limit ${rule.maxAgeHours} h)`;
}

/** The places (scope ids) this render's schedule made its latest videos of — `auto` skips them. */
async function recentSchedulePlaces(db: AppDb, render: ShortRender): Promise<Set<string>> {
  const out = new Set<string>();
  if (!render.scheduleId) return out;
  const recent = await db.shortRenders.recentWithScriptForSchedule(render.scheduleId, AUTO_SKIP_RECENT + 1).catch(() => []);
  for (const r of recent.filter((x) => x.id !== render.id).slice(0, AUTO_SKIP_RECENT)) {
    const s = r.scriptId ? await db.shortScripts.get(r.scriptId).catch(() => null) : null;
    if (s && (s.scope.type === "country" || s.scope.type === "area")) out.add(s.scope.id);
  }
  return out;
}

const anyEvents = (inc: ShortInclude) => inc.alerts || inc.quakes || inc.volcanoes;

/**
 * The generate path at the front (§8 "Order of work"): resolve `auto` to a
 * place, skip a quiet scope, check the round-up's freshness and refresh it,
 * then generate. Throws a RenderOutcome for a skip or a failure.
 */
async function generateAtFront(db: AppDb, render: ShortRender, format: ShortFormat, now: number): Promise<ShortScript> {
  const what = render.what as Extract<ShortRender["what"], { type: "generate" }>;
  const include = what.include ?? format.template.include;
  let cfg: DirectorConfig | undefined;
  const directorCfg = async () => (cfg ??= await sceneDirectorConfig(db, format.id, true));

  // 1. `auto`: the busiest place, not one of this schedule's last few.
  let scope: ShortScope;
  if (what.scope.type === "auto") {
    const auto = what.scope;
    const exclude = await recentSchedulePlaces(db, render);
    let picked: Awaited<ReturnType<typeof resolveAutoScope>>;
    try {
      picked = await resolveAutoScope(db, await directorCfg(), auto, include, exclude, now);
    } catch (err) {
      throw new RenderOutcome("failed", `auto scope failed: ${errMsg(err)}`);
    }
    if (!picked) {
      const outside = exclude.size ? ` outside the last places made (${[...exclude].join(", ")})` : "";
      throw new RenderOutcome(render.skipIfQuiet ? "skipped" : "failed", `auto: no ${auto.of} has anything active${outside}`);
    }
    scope = picked.scope;
    log(TAG, `render ${render.id}: auto ${auto.of} -> ${picked.name} (score ${Math.round(picked.score)})`);
  } else {
    scope = what.scope;
  }

  // 2. Quiet: only with an include switch on, and before any LLM call.
  if (render.skipIfQuiet && anyEvents(include)) {
    let active: boolean;
    try {
      active = await scopeHasActivity(db, await directorCfg(), scope, include, now);
    } catch (err) {
      throw new RenderOutcome("failed", `generate failed: ${errMsg(err)}`);
    }
    if (!active) throw new RenderOutcome("skipped", "quiet: nothing active in scope");
  }

  // 3. Freshness: skip, or refresh the place's round-up first (one LLM call).
  // A several-places video applies the rule per place (§8): under "refresh"
  // each stale place is rewritten; under "skip" a stale place is left out (as
  // generate leaves out a place with no round-up) and named on the render, and
  // the video is skipped only when no place is left.
  const freshnessScopes: (ShortPlace | Extract<ShortScope, { type: "globe" }>)[] =
    scope.type === "places" ? scope.places : [scope];
  const leftOut: { place: ShortPlace; why: string }[] = [];
  for (const one of freshnessScopes) {
    const stale = await staleRoundup(db, one, render.roundup, now);
    if (!stale) continue;
    if (render.roundup!.ifStale === "skip") {
      if (scope.type !== "places" || one.type === "globe") throw new RenderOutcome("skipped", stale);
      leftOut.push({ place: one, why: stale });
      continue;
    }
    if (one.type === "globe") {
      throw new RenderOutcome(
        "failed",
        `${stale}; the world round-up can't be refreshed for a video (it is written on its own schedule) - choose skip, or allow an older round-up`,
      );
    }
    try {
      await refreshPlaceRoundup(db, one);
      log(TAG, `render ${render.id}: ${stale} - refreshed`);
    } catch (err) {
      throw new RenderOutcome("failed", `${stale}; refresh failed: ${errMsg(err)}`);
    }
  }
  if (leftOut.length && scope.type === "places") {
    const reasons = leftOut.map((l) => l.why).join("; ");
    const kept = scope.places.filter((p) => !leftOut.some((l) => l.place === p));
    if (!kept.length) throw new RenderOutcome("skipped", `every place is stale: ${reasons}`);
    scope = { type: "places", places: kept };
    const note = `left out: ${reasons}`;
    await db.shortRenders.update(render.id, { note }).catch(() => {});
    log(TAG, `render ${render.id}: ${note}`);
  }

  // 4. Generate, in the resolved scope.
  let script: ShortScript;
  try {
    script = await generateForRender(db, { ...what, scope });
  } catch (err) {
    if (err instanceof RenderOutcome) throw err;
    throw new RenderOutcome("failed", `generate failed: ${errMsg(err)}`);
  }
  const scriptInclude = what.include ?? script.include;
  const hasEvents = script.clips.some((c) => /^(storm|quake|volcano):/.test(c.target));
  if (render.skipIfQuiet && anyEvents(scriptInclude) && !hasEvents) throw new RenderOutcome("skipped", "quiet: nothing active in scope");
  return script;
}

/** The format a render plays in, when it can be known without generating. */
async function formatOfRender(db: AppDb, r: ShortRender, scripts: Map<string, ShortScript | null>): Promise<string | undefined> {
  const known = renderFormatId(r);
  if (known || r.what.type !== "script") return known;
  const id = r.scriptId ?? r.what.scriptId;
  if (!scripts.has(id)) scripts.set(id, await db.shortScripts.get(id).catch(() => null));
  const s = scripts.get(id);
  return s ? sceneIdForScript(s) : undefined;
}

async function enqueueLifecycle(event: string, data: Record<string, unknown>): Promise<void> {
  await getQueue("foreground").add(
    "do",
    { domain: "stream", type: "run-lifecycle", event, data },
    { removeOnComplete: true, removeOnFail: true },
  );
}

/** Record a render's outcome (only while it is still unfinished). */
async function settle(db: AppDb, render: ShortRender, patch: Partial<ShortRender>, now = Date.now()) {
  const done = await db.shortRenders.transition(render.id, ["queued", "preparing", "live"], { endedAt: now, ...patch });
  if (done) log(TAG, `render ${render.id}: ${done.status}${done.note ? ` — ${done.note}` : ""}`);
  return done;
}

/**
 * Start a claimed render on `encoderId`: everything §6.5 step 1 does at the
 * front. Never throws — a failure is recorded on the render. Returns false when
 * the video was settled here (failed or skipped), leaving the encoder free.
 */
async function startRender(db: AppDb, render: ShortRender, encoderId: string, now: number): Promise<boolean> {
  try {
    // 1. The format (a saved script names its own) — its YouTube card, timing
    //    and render defaults shape everything below.
    let saved: ShortScript | null = null;
    if (render.what.type === "script") {
      saved = await db.shortScripts.get(render.what.scriptId);
      if (!saved) throw new RenderOutcome("failed", `script ${render.what.scriptId} not found`);
    }
    const formatId = render.what.type === "generate" ? render.what.formatId : sceneIdForScript(saved!);
    const format = await loadRenderFormat(db, formatId);

    // 2. Quota, before anything is created on YouTube (a live video only). The
    //    account: the render's pick, else the format's render default.
    let accountId: string | undefined;
    if (!render.offline) {
      const wanted = render.accountId ?? format.render.accountId;
      const account = await db.getYoutubeAccount(wanted);
      if (!account) {
        throw new RenderOutcome("failed", wanted ? `YouTube channel ${wanted} is not connected` : "no connected YouTube channel");
      }
      if (account.authError) throw new RenderOutcome("failed", `YouTube channel ${account.id} needs reconnecting: ${account.authError.message}`);
      const quota = await quotaAllowsRender(account.id, now);
      if (!quota.ok) throw new RenderOutcome("failed", quota.note);
      accountId = account.id;
    }

    // 3. The script: saved, or the freshness check and generate, at the front.
    let script: ShortScript;
    if (saved || render.what.type !== "generate") {
      script = saved!;
    } else {
      script = await generateAtFront(db, render, format, now);
    }
    if (!script.clips.length) throw new RenderOutcome("failed", "the script has no clips");
    await db.shortRenders.update(render.id, { scriptId: script.id, formatId: sceneIdForScript(script) });

    // 4. Values (stamped at generate, §6.8), with the format's round-up depth.
    let values = script.values;
    if (!values) {
      values = await scriptValues(db, script, { formatName: format.name, roundupDepth: format.opener.roundupDepth, now });
      await db.shortScripts.stampValues(script.id, values).catch((err) => log(TAG, `values stamp failed ${script!.id}`, errMsg(err)));
    }
    // `%{n}`: the schedule's running number for this fire - the render's, not the script's.
    if (render.n != null) values = { ...values, n: String(render.n) };
    const video: ShortFormatVideo = { ...format.video, ...(render.video ?? {}) } as ShortFormatVideo;
    const durationMs = scriptDurationMs(script.clips);
    const text = resolveVideoText(video, values, durationMs, new Date(now));

    // 5. The run: on the script's scene, unlisted, no chat, nothing announced.
    const sceneId = sceneIdForScript(script);
    const onScene = await db.activeRunForScene(sceneId);
    if (onScene) {
      // The planner saw the format free; a run appeared since. Back in line.
      await db.shortRenders.transition(render.id, ["preparing"], {
        status: "queued",
        startedAt: null as unknown as undefined,
        assignedEncoderId: null as unknown as undefined,
      });
      log(TAG, `render ${render.id}: scene ${sceneId} became busy (run ${onScene.id}) — back in the queue`);
      return true;
    }
    const { leadInMs, leadOutMs } = format.timing;
    const run = await db.createRun({
      sceneId,
      encoderId: encoderId === ENV_ENCODER_ID ? undefined : encoderId,
      status: "scheduled",
      phase: "created",
      title: text.title,
      description: text.description,
      // Always streams unlisted: going live in public pings subscribers (§6.3).
      privacy: "unlisted",
      // Safety cap: the script, its lead-in and lead-out, plus a margin.
      durationMs: durationMs + leadInMs + leadOutMs + renderEnv.safetyCapMs(),
      platforms: render.offline ? {} : { youtube: { accountId, monitorStream: false } },
      // A video is not a live show (§6.3): no chat polling or posting, no announce.
      chat: { enabled: false, promoteToTicker: false },
      announce: false,
      script: {
        scriptId: script.id,
        renderId: render.id,
        scheduleId: render.scheduleId,
        offline: render.offline,
        // The render's privacy (the form starts it from the format); a schedule's
        // per-video override (`video.publishAs`) wins.
        publishAs: render.video?.publishAs ?? render.publishAs,
        leadInMs,
        leadOutMs,
        tags: video.tags?.length ? video.tags : undefined,
        categoryId: video.categoryId || undefined,
        playlistId: video.playlistId || undefined,
        chapters: video.chapters !== false,
        // An image source (URL or site path); "" = the deployment default image;
        // absent = no custom thumbnail (stream/thumbnail.ts).
        thumbnailUrl: text.thumbnailUrl,
        ...(text.thumbnailFrameAtMs != null ? { thumbnailFrameAtMs: text.thumbnailFrameAtMs } : {}),
      },
      createdBy: `render:${render.id}`,
    });
    if (!run) throw new RenderOutcome("failed", "could not create the run");
    await db.shortRenders.update(render.id, { runId: run.id });
    await enqueueLifecycle("goLive", { runId: run.id });
    log(TAG, `render ${render.id}: run ${run.id} on ${encoderId} — "${text.title}" (${formatDuration(durationMs)})`);
    return true;
  } catch (err) {
    const outcome = err instanceof RenderOutcome ? err : new RenderOutcome("failed", errMsg(err));
    await settle(db, render, { status: outcome.status, note: outcome.message });
    return false;
  }
}

export interface AdvanceResult {
  started: string[];
  settled: string[];
  skipped: string[];
}

async function advance(now: number): Promise<AdvanceResult> {
  const db = await getAppDb();
  const result: AdvanceResult = { started: [], settled: [], skipped: [] };

  // 1. Settle what a lost hook (or a restart) left behind.
  for (const r of await db.shortRenders.list({ status: ["preparing", "live"] })) {
    if (r.runId) {
      const run = await db.getRun(r.runId);
      if (!run) {
        if (await settle(db, r, { status: "failed", note: "its run disappeared" }, now)) result.settled.push(r.id);
      } else if (runIsFinished(run.status)) {
        if (await settle(db, r, renderOutcomeForRun(run), now)) result.settled.push(r.id);
      }
    } else if (r.status === "preparing" && now - (r.startedAt ?? r.queuedAt) > renderEnv.prepareTimeoutMs()) {
      if (await settle(db, r, { status: "failed", note: "interrupted while preparing (worker restart?)" }, now)) result.settled.push(r.id);
    }
  }

  // 2. Too late.
  for (const r of await db.shortRenders.list({ status: ["queued"] })) {
    if (r.startBy != null && now > r.startBy) {
      if (await settle(db, r, { status: "skipped", note: "too late" }, now)) result.skipped.push(r.id);
    }
  }

  // 3. Start what can start. A video that fails or is skipped at the front
  // leaves its encoder free, so plan again at once: the batch moves on in the
  // same pass instead of waiting a ticker interval per failure.
  const scripts = new Map<string, ShortScript | null>();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const [renders, registry, runs, slots, paused] = await Promise.all([
      db.shortRenders.list({ status: ["queued", "preparing", "live"] }),
      db.listStreamEncoders(),
      db.listRuns({ status: ["scheduled", "awaiting-ingest", "live", "ending"] }),
      db.listStreamSlots(),
      db.shortRenders.pausedEncoders(),
    ]);
    if (!renders.some((r) => r.status === "queued")) break;
    const encoders: PlanInput["encoders"] = [...registry];
    // The env-configured OBS takes only videos named for it.
    if (renders.some((r) => r.status === "queued" && r.encoderId === ENV_ENCODER_ID) && !registry.some((e) => e.id === ENV_ENCODER_ID)) {
      encoders.push({ id: ENV_ENCODER_ID, enabled: true, use: "channels" });
    }
    const formats = new Map<string, string | undefined>();
    for (const r of renders) formats.set(r.id, await formatOfRender(db, r, scripts));
    const picks = planRenderStarts({
      renders,
      encoders,
      activeRuns: runs,
      slots,
      paused: new Set(paused),
      formatOf: (r) => formats.get(r.id),
      now,
    });
    let freed = false;
    for (const pick of picks) {
      const claimed = await db.shortRenders.transition(pick.renderId, ["queued"], {
        status: "preparing",
        assignedEncoderId: pick.encoderId,
        startedAt: now,
      });
      if (!claimed) continue; // cancelled or taken meanwhile
      result.started.push(claimed.id);
      if (!(await startRender(db, claimed, pick.encoderId, now))) freed = true;
    }
    if (!freed) break;
  }
  return result;
}

/** Bound on re-planning within one advance (each round settles at least one video). */
const MAX_ROUNDS = 100;

/** Advance every encoder's queue. Serialised in-process; never throws. */
export function advanceRenderQueues(now = Date.now()): Promise<AdvanceResult> {
  return locked(() =>
    advance(now).catch((err) => {
      log(TAG, `advance failed`, errMsg(err));
      return { started: [], settled: [], skipped: [] };
    }),
  );
}

/** The format a request renders in: the generate request's, or the saved script's. */
async function requestFormatId(db: AppDb, req: Pick<ShortRenderRequest, "what">): Promise<string | undefined> {
  if (req.what.type === "generate") return req.what.formatId;
  const script = await db.shortScripts.get(req.what.scriptId).catch(() => null);
  return script ? sceneIdForScript(script) : undefined;
}

/**
 * Queue several videos in order (a schedule's batch, §8) WITHOUT advancing:
 * each gets a later `queuedAt` than the one before, so the queue keeps the
 * batch's order. The caller advances (`advanceRenderQueues`), typically
 * without waiting - a refresh or generate at the front can take a while.
 */
export async function createRenders(reqs: ShortRenderRequest[], now = Date.now()): Promise<ShortRender[]> {
  const db = await getAppDb();
  const out: ShortRender[] = [];
  for (const [i, req] of reqs.entries()) {
    out.push(await db.shortRenders.create({ ...req, formatId: await requestFormatId(db, req) }, now + i));
  }
  if (out.length) log(TAG, `queued ${out.length} render(s)${reqs[0]?.batchId ? ` as batch ${reqs[0].batchId}` : ""}`);
  return out;
}

/** Queue a video (Render now, a schedule's batch, Retry) and advance at once. */
export async function queueRender(req: ShortRenderRequest, now = Date.now()): Promise<ShortRender> {
  const db = await getAppDb();
  const render = await db.shortRenders.create({ ...req, formatId: await requestFormatId(db, req) }, now);
  log(TAG, `queued render ${render.id} on ${render.encoderId}`);
  await advanceRenderQueues(now);
  return (await db.shortRenders.get(render.id)) ?? render;
}

// ---- hooks from the run pipeline (script-run.ts) ----

async function renderForRun(db: AppDb, run: Run): Promise<ShortRender | null> {
  const id = run.script?.renderId;
  return (id ? await db.shortRenders.get(id) : null) ?? (await db.shortRenders.getByRunId(run.id));
}

/** The render's run went live. */
export async function renderRunLive(run: Run): Promise<void> {
  const db = await getAppDb();
  const r = await renderForRun(db, run);
  if (r) await db.shortRenders.transition(r.id, ["preparing"], { status: "live" });
}

/** The render's run is over: record the outcome, then start the next video (§6.5 step 6). */
export async function renderRunSettled(run: Run): Promise<void> {
  const db = await getAppDb();
  const r = await renderForRun(db, run);
  if (r && renderIsActive(r.status)) await settle(db, r, renderOutcomeForRun(run), run.endedAt ?? Date.now());
  await advanceRenderQueues();
}

// ---- operator controls (§6.7) ----

export type RenderControl =
  | { action: "pause" | "resume"; encoderId: string }
  | { action: "cancel" | "retry" | "stop"; renderId: string };

/** Pause, Resume, Cancel, Retry, Stop. Resolves with a structured result for the UI. */
export async function controlRender(c: RenderControl): Promise<{ ok: boolean; error?: string; render?: ShortRender }> {
  const db = await getAppDb();
  if (c.action === "pause" || c.action === "resume") {
    await db.shortRenders.setPaused(c.encoderId, c.action === "pause");
    log(TAG, `encoder ${c.encoderId}: queue ${c.action === "pause" ? "paused" : "resumed"}`);
    if (c.action === "resume") await advanceRenderQueues();
    return { ok: true };
  }
  const r = await db.shortRenders.get((c as Extract<RenderControl, { renderId: string }>).renderId);
  if (!r) return { ok: false, error: "no such render" };
  if (c.action === "cancel") {
    const done = await db.shortRenders.transition(r.id, ["queued"], { status: "cancelled", endedAt: Date.now(), note: "cancelled by operator" });
    return done ? { ok: true, render: done } : { ok: false, error: `only a queued video can be cancelled (this one is ${r.status})` };
  }
  if (c.action === "retry") {
    if (!renderCanRetry(r.status)) return { ok: false, error: `a ${r.status} video can't be retried` };
    const req: ShortRenderRequest = {
      encoderId: r.encoderId,
      what: r.what,
      publishAs: r.publishAs,
      offline: r.offline,
      ...(r.accountId ? { accountId: r.accountId } : {}),
      ...(r.video ? { video: r.video } : {}),
      ...(r.roundup ? { roundup: r.roundup } : {}),
      ...(r.skipIfQuiet ? { skipIfQuiet: true } : {}),
      ...(r.scheduleId ? { scheduleId: r.scheduleId } : {}),
      ...(r.batchId ? { batchId: r.batchId } : {}),
      ...(r.n != null ? { n: r.n } : {}),
      // A retry is "now": the original start-by window has passed by definition.
    };
    const created = await db.shortRenders.create({ ...req, formatId: r.formatId ?? (await requestFormatId(db, req)) });
    await db.shortRenders.update(created.id, { retryOf: r.id });
    await advanceRenderQueues();
    return { ok: true, render: (await db.shortRenders.get(created.id)) ?? created };
  }
  // stop: end the live video now; it fails and the queue continues.
  if (!renderIsActive(r.status)) return { ok: false, error: `only a preparing or live video can be stopped (this one is ${r.status})` };
  if (r.runId) {
    // finishRun(id, "manual") → run "stopped" → the render records failed, "stopped by operator".
    await enqueueLifecycle("stop", { runId: r.runId });
    return { ok: true, render: r };
  }
  const done = await settle(db, r, { status: "failed", note: "stopped by operator" });
  return { ok: true, render: done ?? r };
}
