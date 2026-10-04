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
 *  - At the front, in order: quota check (live only), the script (saved, or
 *    freshness check + generate), the title-code values, the title and
 *    description resolved onto a new Run, then goLive. Any failure there fails
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
  type ShortFormatVideo,
  type ShortRender,
  type ShortRenderRequest,
} from "@photonsurge/shared/short-render";
import { scriptDurationMs, type ShortScript } from "@photonsurge/shared/short-script";
import { countryShot } from "@photonsurge/shared/director-countries";
import {
  clipYouTubeDescription,
  formatVideoText,
  isValidTimeZone,
  trimVideoTitle,
  VIDEO_TEXT_TIMEZONE,
} from "@photonsurge/shared/video-text";
import { log } from "@photonsurge/shared/utill/logger";
import { generateShortScript } from "../director/script-generate";
import { exhaustedUntil, fmtResetTime, quotaSnapshot } from "../youtube/quota";
import { channelYoutubeSettings } from "./channel-youtube";
import { watchBaseUrl } from "./encoders";
import { formatForScript, sceneForScript } from "./script-scene";
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

/** Timing defaults until formats carry them (ShortFormat.timing, §5.2). */
const DEFAULT_TIMING = { leadInMs: 3_000, leadOutMs: 5_000 };
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

// ---- adapters onto code the formats branch (WP5) is rewriting ----

/** What the queue needs from a format. */
export interface FormatRenderSettings {
  name: string;
  video: ShortFormatVideo;
  timing: { leadInMs: number; leadOutMs: number };
  render: { accountId?: string };
}

/**
 * A format's render settings. ADAPTER: formats (ShortFormat, §5.2) arrive with
 * WP5; until then a "format" is its scene, and its YouTube video settings start
 * from the scene's own YouTube card (title, description, thumbnail image) with
 * the §5.2 defaults for the rest. After the merge: read `db.shortFormats`.
 */
export async function formatRenderSettings(db: AppDb, formatId: string): Promise<FormatRenderSettings> {
  const yt = await channelYoutubeSettings(formatId).catch(() => ({ title: "", description: "", thumbnailUrl: "" }));
  const scene = (await db.getScene(formatId).catch(() => null)) as { name?: string } | null;
  return {
    name: scene?.name ?? formatId,
    video: {
      title: yt.title || DEFAULT_VIDEO_TITLE,
      description: yt.description || "",
      timezone: VIDEO_TEXT_TIMEZONE,
      thumbnail: { source: "image", url: yt.thumbnailUrl || "" },
      tags: [],
      categoryId: "",
      publishAs: "unlisted",
      chapters: true,
    },
    timing: { ...DEFAULT_TIMING },
    render: {},
  };
}

/**
 * Generate at the front of the queue — the ONE call into the generate path.
 * ADAPTER: passes the format id as the scene id for now (a format's id is its
 * scene's id); after WP5 it passes `formatId`. `auto` scope (pick the busiest
 * place) belongs to scheduling (WP9a) and fails here until then.
 */
export async function generateForRender(
  db: AppDb,
  what: Extract<ShortRender["what"], { type: "generate" }>,
): Promise<ShortScript> {
  if (what.scope.type === "auto") {
    throw new RenderOutcome("failed", "auto scope is not available yet (it arrives with scheduling, WP9a)");
  }
  return generateShortScript(db, { scope: what.scope, include: what.include, sceneId: what.formatId });
}

// ---- pure helpers ----

/** Title, description and thumbnail resolved for one video (§6.8). */
export interface ResolvedVideoText {
  title: string;
  description: string;
  /** Image source resolved; undefined = no custom thumbnail (a frame source until WP8). */
  thumbnailUrl?: string;
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
  const tz = video.timezone && video.timezone !== "place" && isValidTimeZone(video.timezone) ? video.timezone : VIDEO_TEXT_TIMEZONE;
  const vals = { ...values, duration: formatDuration(durationMs) };
  const title = trimVideoTitle(formatVideoText(video.title || DEFAULT_VIDEO_TITLE, vals, now, tz)) || "Untitled video";
  let description = formatVideoText(video.description || "", vals, now, tz).trim();
  const site = siteUrl.trim().replace(/\/+$/, "");
  if (site && !description.includes(site)) description = `${description ? `${description}\n\n` : ""}Watch the map live: ${site}`;
  const out: ResolvedVideoText = { title, description: clipYouTubeDescription(description) };
  if (video.thumbnail?.source === "image") {
    out.thumbnailUrl = formatVideoText(video.thumbnail.url || "", vals, now, tz).trim();
  }
  // TODO(WP8): a "frame" thumbnail is a GetSourceScreenshot of the render at
  // `atMs`; until WP8 adds that OBS call the video gets no custom thumbnail.
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

  const queued = input.renders.filter((r) => r.status === "queued").sort((a, b) => a.queuedAt - b.queuedAt);
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

/** Freshness of a place's round-up against the render's rule; null when fine (or not applicable). */
async function staleRoundup(db: AppDb, render: ShortRender, now: number): Promise<string | null> {
  if (!render.roundup || render.what.type !== "generate") return null;
  const scope = render.what.scope;
  if (scope.type !== "country" && scope.type !== "area") return null;
  const placeId = scope.type === "country" ? countryShot(scope.id)?.iso2.toLowerCase() : scope.id;
  if (!placeId) return null;
  const repo = scope.type === "country" ? db.countryRoundups : db.regionRoundups;
  const latest = await repo.latestForPlace(placeId).catch(() => null);
  const limitMs = render.roundup.maxAgeHours * 3_600_000;
  if (!latest?.generatedAt) return `no round-up for ${scope.id}`;
  const ageMs = now - new Date(latest.generatedAt).getTime();
  if (ageMs <= limitMs) return null;
  return `round-up for ${scope.id} is ${Math.round(ageMs / 3_600_000)} h old (limit ${render.roundup.maxAgeHours} h)`;
}

/** The format a render plays in, when it can be known without generating. */
async function formatOfRender(db: AppDb, r: ShortRender, scripts: Map<string, ShortScript | null>): Promise<string | undefined> {
  if (r.what.type === "generate") return r.what.formatId;
  const id = r.scriptId ?? r.what.scriptId;
  if (!scripts.has(id)) scripts.set(id, await db.shortScripts.get(id).catch(() => null));
  const s = scripts.get(id);
  return s ? formatForScript(s as { formatId?: string }) : undefined;
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
    // 1. Quota, before anything is created (a live video only).
    let accountId: string | undefined;
    const formatId = render.what.type === "generate" ? render.what.formatId : undefined;
    if (!render.offline) {
      const account = await db.getYoutubeAccount(render.accountId);
      if (!account) {
        throw new RenderOutcome("failed", render.accountId ? `YouTube channel ${render.accountId} is not connected` : "no connected YouTube channel");
      }
      if (account.authError) throw new RenderOutcome("failed", `YouTube channel ${account.id} needs reconnecting: ${account.authError.message}`);
      const quota = await quotaAllowsRender(account.id, now);
      if (!quota.ok) throw new RenderOutcome("failed", quota.note);
      accountId = account.id;
    }

    // 2. The script: saved, or the freshness check and generate, at the front.
    let script: ShortScript | null;
    if (render.what.type === "script") {
      script = await db.shortScripts.get(render.what.scriptId);
      if (!script) throw new RenderOutcome("failed", `script ${render.what.scriptId} not found`);
    } else {
      const stale = await staleRoundup(db, render, now);
      if (stale && render.roundup!.ifStale === "skip") throw new RenderOutcome("skipped", stale);
      if (stale) {
        // TODO(WP9a): `refresh` writes a new round-up for the place first, through a
        // single-place entry point in jobs/placeRoundups.ts that doesn't exist yet.
        throw new RenderOutcome("failed", `${stale}; refreshing it is not available yet (WP9a)`);
      }
      try {
        script = await generateForRender(db, render.what);
      } catch (err) {
        if (err instanceof RenderOutcome) throw err;
        throw new RenderOutcome("failed", `generate failed: ${errMsg(err)}`);
      }
      const include = render.what.include ?? script.include;
      const wantsEvents = include.alerts || include.quakes || include.volcanoes;
      const hasEvents = script.clips.some((c) => /^(storm|quake|volcano):/.test(c.target));
      if (render.skipIfQuiet && wantsEvents && !hasEvents) throw new RenderOutcome("skipped", "quiet: nothing active in scope");
    }
    if (!script.clips.length) throw new RenderOutcome("failed", "the script has no clips");
    await db.shortRenders.update(render.id, { scriptId: script.id });

    // 3. Values (stamped at generate, §6.8) and the format's settings.
    const fmtId = formatId ?? formatForScript(script as { formatId?: string });
    const settings = await formatRenderSettings(db, fmtId);
    let values = script.values;
    if (!values) {
      values = await scriptValues(db, script as ShortScript & { formatId?: string }, { formatName: settings.name, now });
      await db.shortScripts.stampValues(script.id, values).catch((err) => log(TAG, `values stamp failed ${script!.id}`, errMsg(err)));
    }
    const video: ShortFormatVideo = { ...settings.video, ...(render.video ?? {}) } as ShortFormatVideo;
    const durationMs = scriptDurationMs(script.clips);
    const text = resolveVideoText(video, values, durationMs, new Date(now));

    // 4. The run: on the script's scene, unlisted, no chat, nothing announced.
    const sceneId = sceneForScript(script as { formatId?: string });
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
    const { leadInMs, leadOutMs } = settings.timing;
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

/** Queue a video (Render now, a schedule's batch, Retry) and advance at once. */
export async function queueRender(req: ShortRenderRequest, now = Date.now()): Promise<ShortRender> {
  const db = await getAppDb();
  const render = await db.shortRenders.create(req, now);
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
      // A retry is "now": the original start-by window has passed by definition.
    };
    const created = await db.shortRenders.create(req);
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
