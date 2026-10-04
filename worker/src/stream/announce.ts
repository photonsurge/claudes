/**
 * "Notify the world" — when an announce-flagged run commits live, publish a blog
 * post (and optional social fan-out) through hydra's site-content API:
 *
 *   POST ${HYDRA_ENDPOINT}/api/v1/sites/${HYDRA_SITEID}/blogs
 *   Authorization: Bearer ${HYDRA_API_TOKEN}   (a `hydra_site_…` site API key)
 *
 * The key needs scopes blog:create + blog:publish, plus social:generate (and
 * social:send when HYDRA_SOCIAL_MODE=send) if HYDRA_SOCIAL_PAGE_IDS is set.
 *
 * Fired from transitionToLive as its own queued job (retried with backoff — a
 * flaky hydra must never touch the go-live path). Double-post safe twice over:
 * `announcedAt` on the run short-circuits re-enqueues, and the Idempotency-Key
 * header (derived from the run id) dedupes at hydra even if that write is lost.
 */
import { getQueue } from "@photonsurge/shared/bull/bull";
import { getAppDb } from "@photonsurge/shared/db/index";
import { runIsActive, type Run } from "@photonsurge/shared/runs";
import { DEFAULT_STREAM_BLURB } from "@photonsurge/shared/stream-description";
import { log } from "@photonsurge/shared/utill/logger";

const TAG = "stream-announce";

interface HydraConfig {
  apiUrl: string;
  siteId: string;
  token: string;
  categoryId: string;
  socialPageIds: string[];
  socialMode: "draft" | "send";
}

function hydraConfig(): HydraConfig | null {
  const apiUrl = (process.env.HYDRA_ENDPOINT || "").trim().replace(/\/+$/, "");
  const siteId = (process.env.HYDRA_SITEID || "").trim();
  const token = (process.env.HYDRA_API_TOKEN || "").trim();
  const categoryId = (process.env.HYDRA_BLOG_CATEGORY_ID || "").trim();
  if (!apiUrl || !siteId || !token || !categoryId) return null;
  return {
    apiUrl,
    siteId,
    token,
    categoryId,
    socialPageIds: (process.env.HYDRA_SOCIAL_PAGE_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    socialMode: process.env.HYDRA_SOCIAL_MODE === "draft" ? "draft" : "send",
  };
}

/** Hydra slugs must be lowercase alphanumerics joined by single hyphens. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Same copy as the YouTube description's default body — one pitch everywhere.
const DEFAULT_BLURB = DEFAULT_STREAM_BLURB;

/** "14:05 UK (13:05 UTC) on 24 Aug 2026" — the go-live moment, both clocks. */
function formatWhen(at: number): string {
  const d = new Date(at);
  const time = (tz: string) =>
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz, hour12: false }).format(d);
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
  return `${time("Europe/London")} UK (${time("UTC")} UTC) on ${day}`;
}

/**
 * The announcement body for a live run: headline from the run title, channel +
 * YouTube-channel names, go-live time, the watch link, and a closing blurb
 * (HYDRA_ANNOUNCE_BLURB overrides the default copy). Pure — easy to test and
 * easy to see exactly what gets posted.
 */
export function buildAnnouncement(
  run: Run,
  extras: { watchUrl: string; sceneName?: string; channelTitle?: string; categoryId: string },
): { name: string; description: string; categoryID: string; slug: string; contentMarkdown: string } {
  const sceneName = extras.sceneName || run.sceneId;
  const title = (run.title || `${sceneName} — live weather stream`).trim();
  const on = extras.channelTitle ? ` on ${extras.channelTitle}` : "";
  const when = formatWhen(run.startAt || Date.now());
  const blurb = (process.env.HYDRA_ANNOUNCE_BLURB || "").trim() || DEFAULT_BLURB;
  const alwaysOn = !run.durationMs && run.slotId ? " The stream runs around the clock." : "";

  return {
    name: `Live now: ${title}`.slice(0, 200),
    description: `${sceneName} is live${on} — ${title}. Watch: ${extras.watchUrl}`.slice(0, 1000),
    categoryID: extras.categoryId,
    slug: ["live", slugify(title), run.id.slice(0, 8)].filter(Boolean).join("-"),
    contentMarkdown: [
      `# ${title}`,
      "",
      `${sceneName} is live on YouTube${on}, since ${when}.`,
      "",
      "Watch live:",
      "",
      extras.watchUrl,
      "",
      blurb + alwaysOn,
    ].join("\n"),
  };
}

/** Enqueue the announcement as its own retried job — never inline in go-live. */
export async function queueAnnounce(runId: string): Promise<void> {
  log(TAG, `announce queued for run ${runId}`);
  await getQueue("foreground").add(
    "do",
    { domain: "stream", type: "run-lifecycle", event: "announce", data: { runId } },
    {
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: { count: 50 },
    },
  );
}

/** Stamp the failure on the run (best-effort) so the admin UI can show why nothing posted. */
async function recordFailure(
  db: Awaited<ReturnType<typeof getAppDb>>,
  run: Run,
  message: string,
  status?: number,
): Promise<void> {
  const attempts = (run.announceError?.attempts ?? 0) + 1;
  await db
    .updateRun(run.id, { announceError: { at: Date.now(), attempts, message, ...(status ? { status } : {}) } })
    .catch((err: unknown) => log(TAG, `could not record announce error on ${run.id}`, String((err as Error)?.message ?? err)));
}

/**
 * Post the announcement for a live run. Throws on transport/API failure so the
 * BullMQ attempts drive the retry; silently skips whenever announcing no longer
 * makes sense (flag off, already announced, run dead, no public URL, no config).
 */
export async function announceRun(runId: string): Promise<void> {
  const db = await getAppDb();
  const run = await db.getRun(runId);
  log(TAG, `announce job start ${runId}`);
  if (!run) {
    log(TAG, `run ${runId} not found — announce dropped`);
    return;
  }
  if (!run.announce) {
    log(TAG, `run ${runId} has announce off — skipping`);
    return;
  }
  if (run.announcedAt) {
    log(TAG, `run ${runId} already announced — skipping`);
    return;
  }
  if (!runIsActive(run.status)) {
    log(TAG, `run ${runId} is ${run.status} — stale announcement dropped`);
    return;
  }
  const watchUrl = run.platforms?.youtube?.watchUrl;
  if (!watchUrl) {
    log(TAG, `run ${runId} has no public watch URL — nothing to announce`);
    return;
  }
  const cfg = hydraConfig();
  if (!cfg) {
    const missing = ["HYDRA_ENDPOINT", "HYDRA_SITEID", "HYDRA_API_TOKEN", "HYDRA_BLOG_CATEGORY_ID"].filter(
      (k) => !(process.env[k] || "").trim(),
    );
    const message = `hydra not configured — missing ${missing.join(", ")}`;
    log(TAG, `run ${runId}: ${message} — skipping`);
    await recordFailure(db, run, message);
    return;
  }

  // Best-effort colour: the scene's display name + the YouTube channel title.
  // Neither is worth failing (and retrying) an announcement over.
  const sceneName = await db
    .getScene(run.sceneId)
    .then((s: { name?: string } | null) => s?.name)
    .catch(() => undefined);
  const channelTitle = await db
    .getYoutubeAccount(run.platforms?.youtube?.accountId)
    .then((a: { channelTitle?: string } | null) => a?.channelTitle)
    .catch(() => undefined);

  const post = buildAnnouncement(run, { watchUrl, sceneName, channelTitle, categoryId: cfg.categoryId });
  const body = {
    ...post,
    publish: true,
    ...(cfg.socialPageIds.length
      ? { social: { pageIDs: cfg.socialPageIds, count: 1, mode: cfg.socialMode } }
      : {}),
  };

  const url = `${cfg.apiUrl}/api/v1/sites/${encodeURIComponent(cfg.siteId)}/blogs`;
  log(TAG, `run ${runId}: POST ${url} (slug ${post.slug}, social ${cfg.socialPageIds.length ? `${cfg.socialMode} x${cfg.socialPageIds.length}` : "off"})`);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.token}`,
        "Idempotency-Key": `weatherchannel-run-${run.id}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
    const message = `request to ${cfg.apiUrl} failed: ${String((err as Error)?.message ?? err)}${cause?.code ? ` (${cause.code})` : ""}`;
    log(TAG, `run ${runId}: ${message}`);
    await recordFailure(db, run, message);
    throw new Error(`hydra announce failed: ${message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const message = text.slice(0, 300) || res.statusText || "no body";
    log(TAG, `run ${runId}: hydra answered ${res.status}: ${message}`);
    await recordFailure(db, run, message, res.status);
    throw new Error(`hydra announce failed (${res.status}): ${message}`);
  }
  const json = (await res.json().catch(() => ({}))) as { data?: { blog?: { id?: string } } };

  await db.updateRun(runId, { announcedAt: Date.now(), announceError: null });
  log(TAG, `run ${runId} announced — hydra blog ${json?.data?.blog?.id ?? "?"} ("${post.slug}")`);
}
