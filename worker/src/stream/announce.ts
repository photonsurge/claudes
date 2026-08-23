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

const DEFAULT_BLURB =
  "This is our live weather globe — real-time global wind, temperature, storms and " +
  "severe-weather alerts, rendered live and directed automatically around breaking " +
  "weather events.";

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
  await getQueue("foreground").add(
    "do",
    { domain: "stream", type: "run-lifecycle", event: "announce", data: { runId } },
    {
      attempts: 5,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

/**
 * Post the announcement for a live run. Throws on transport/API failure so the
 * BullMQ attempts drive the retry; silently skips whenever announcing no longer
 * makes sense (flag off, already announced, run dead, no public URL, no config).
 */
export async function announceRun(runId: string): Promise<void> {
  const db = await getAppDb();
  const run = await db.getRun(runId);
  if (!run?.announce) return;
  if (run.announcedAt) return; // already told the world
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
    log(TAG, `hydra not configured (HYDRA_ENDPOINT / HYDRA_SITEID / HYDRA_API_TOKEN / HYDRA_BLOG_CATEGORY_ID) — skipping`);
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

  const res = await fetch(`${cfg.apiUrl}/api/v1/sites/${encodeURIComponent(cfg.siteId)}/blogs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.token}`,
      "Idempotency-Key": `weatherchannel-run-${run.id}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`hydra announce failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = (await res.json().catch(() => ({}))) as { data?: { blog?: { id?: string } } };

  await db.updateRun(runId, { announcedAt: Date.now() });
  log(TAG, `run ${runId} announced — hydra blog ${json?.data?.blog?.id ?? "?"} ("${post.slug}")`);
}
