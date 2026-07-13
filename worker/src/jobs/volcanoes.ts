import type { Job } from "bullmq";
import type { AppDb } from "@photonsurge/shared/db/index";
import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchVolcanoes } from "@photonsurge/shared/volcanoes/gvp";
import { fetchUsgsVolcanoStatus } from "@photonsurge/shared/volcanoes/usgs-geojson";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import { diffVolcanoStatus } from "@photonsurge/shared/volcanoes/diff";
import { volcanoTimelineUpdatesFromChanges } from "@photonsurge/shared/events/promote";
import type { NewEventTimelineUpdate } from "@photonsurge/shared/db/event-timeline-update-model";
import { fetchWikiSummary, fetchWikiGallery } from "@photonsurge/shared/utill/wikipedia";
import { fetchVolcanoFacts } from "@photonsurge/shared/utill/wikidata";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { eventsUnifiedEnabled, shouldPromoteVolcano } from "../events/config";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";
import { parseReportFacts } from "../volcanoes/parseReport";

const TAG = "job:volcanoes";

/**
 * Unified-event promotion for volcanoes — the analogue of the alert ingest
 * bridge. For each SIGNIFICANT volcano, promote (idempotent upsert) to a
 * WatchedEvent of type VOLCANO and append a stored timeline beat for every
 * official status change since the previous poll. Store-on-change: a steady
 * re-poll (no status move) writes zero beats. `prev` MUST be captured before the
 * doc is overwritten, so the caller reads it first and hands both sides in here.
 * Behind EVENTS_UNIFIED_ENABLED so the whole layer stays dark until switched on.
 */
async function promoteVolcanoStatus(
  db: AppDb,
  prev: Volcano[],
  next: Volcano[],
  source: string,
): Promise<{ promoted: number; beats: number }> {
  const prevById = new Map(prev.map((p) => [p.id, p]));
  const now = new Date();
  const nowIso = now.toISOString();
  let promoted = 0;
  let beats = 0;
  for (const v of next) {
    const prevV = prevById.get(v.id);
    // Promote if it's significant now OR was (so a WARNING→NORMAL downgrade still
    // updates the dossier and records the de-escalation beat), like the alert bridge.
    if (!shouldPromoteVolcano(v) && !(prevV && shouldPromoteVolcano(prevV))) continue;
    try {
      const changes = diffVolcanoStatus(prevV, v);
      const { eventId, created } = await db.watchedEvents.promoteFromVolcano(v, now);
      promoted++;
      const rows: NewEventTimelineUpdate[] = [];
      if (created) {
        rows.push({
          eventId,
          at: new Date(v.statusChangedAt || v.firstDate).toISOString(),
          type: "ISSUED",
          label: `Tracking started · ${v.status}`,
          source,
        });
      }
      rows.push(...volcanoTimelineUpdatesFromChanges(eventId, changes, nowIso, source));
      if (rows.length) beats += (await db.eventTimeline.appendMany(rows)).inserted;
    } catch (err) {
      log(TAG, `volcano promotion failed`, { volcanoId: v.id, err: String(err) });
    }
  }
  if (promoted || beats) log(TAG, `volcano promotion`, { source, promoted, beats });
  return { promoted, beats };
}

/**
 * Dispatched as type "volcanoes", event "snapshot". Pulls the Smithsonian/USGS
 * Weekly Volcanic Activity Report (whole globe, no key) and upserts them into
 * Mongo on the volcano's stable VOTW number; a TTL on `fetchedAt` drops
 * volcanoes that stop showing up in the bulletin. The public route reads only
 * this cache.
 */
export async function snapshot(_job: Job) {
  const db = await getAppDb();
  try {
    const { volcanoes } = await fetchVolcanoes();
    // Capture the PREV docs BEFORE upsertMany overwrites them, so the timeline
    // hook can diff prev-vs-persisted rather than prev-vs-prev.
    const prev = eventsUnifiedEnabled() ? await db.volcanoes.listByIds(volcanoes.map((v) => v.id)) : [];
    const r = await db.volcanoes.upsertMany(volcanoes);
    if (eventsUnifiedEnabled()) await promoteVolcanoStatus(db, prev, volcanoes, "gvp");
    const result = { volcanoes: volcanoes.length, upserted: r.upserted };
    log(TAG, `volcanoes snapshot done`, result);
    blogInfo(TAG, `volcanoes snapshot: ${volcanoes.length} active`, result, "volcanoes", "snapshot");
    // Live push so the overlay refetches the instant a snapshot lands.
    emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "volcanoes", count: volcanoes.length } });
    return result;
  } catch (err) {
    log(TAG, `volcanoes snapshot failed`, summarizeForLog(err));
    blogErr(TAG, `volcanoes snapshot failed`, err, "volcanoes", "snapshot");
    throw err;
  }
}

// ── Wikipedia enrichment ──────────────────────────────────────────────────────

const STALE_DAYS = 30;
const GAP_MS = 150; // ~6-7 req/s — well within Wikipedia's limits, still kind.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The report's own volcano name is usually already close to the Wikipedia
 * article title (e.g. "Nevados de Chillan"), but sometimes needs a nudge — try
 * the bare name, then without a trailing "Volcano"/"Volcanic Complex" suffix
 * some entries carry — first non-missing/disambiguation hit wins.
 */
export function titleCandidates(name: string): string[] {
  const out = [name];
  const noPlace = name.replace(/,\s*[^,]+$/, "").trim();
  if (noPlace && !out.includes(noPlace)) out.push(noPlace);
  const bare = noPlace.replace(/\s+Volcan(o|ic)(\s+(Group|Field|Complex))?$/i, "").trim();
  if (bare && !out.includes(bare)) out.push(bare);
  return out;
}

export interface VolcanoWikiEnrichOpts {
  /** Re-fetch even volcanoes enriched within STALE_DAYS. */
  force?: boolean;
}

/** Cache Wikipedia title/thumb/extract onto active volcano docs. Incremental
 *  (skips fresh ones unless force); never closes the connection (caller owns it). */
export async function runVolcanoWikiEnrich(opts: VolcanoWikiEnrichOpts = {}) {
  const force = Boolean(opts.force);
  const db = await getAppDb();
  const staleBefore = new Date(Date.now() - STALE_DAYS * 86_400_000);
  const volcanoes = await db.volcanoes.listNeedingEnrichment(staleBefore, force);
  log(TAG, `enrichWiki ${volcanoes.length} volcanoes`, { force });

  let enriched = 0;
  let withPhoto = 0;
  let noMatch = 0;
  for (const v of volcanoes) {
    try {
      let r: Awaited<ReturnType<typeof fetchWikiSummary>> = "missing";
      for (const title of titleCandidates(v.name)) {
        r = await fetchWikiSummary(title);
        if (r !== "missing" && r !== "disambig") break;
        await sleep(GAP_MS);
      }
      if (r === "missing" || r === "disambig") {
        noMatch++;
        await db.volcanoes.updateEnrichment(v.volcanoId, { wikiFetchedAt: new Date() });
      } else {
        await sleep(GAP_MS);
        const [gallery, facts] = await Promise.all([fetchWikiGallery(r.title), fetchVolcanoFacts(r.title)]);
        await db.volcanoes.updateEnrichment(v.volcanoId, {
          wikiTitle: r.title,
          wikiThumb: r.thumb,
          wikiPhoto: r.photo,
          wikiExtract: r.extract,
          wikiGallery: gallery.length ? gallery : undefined,
          wikiFetchedAt: new Date(),
          elevationM: facts.elevationM,
          volcanoType: facts.volcanoType,
          lastEruptionYear: facts.lastEruptionYear,
        });
        enriched++;
        if (r.thumb || r.photo) withPhoto++;
      }
    } catch (err) {
      log(TAG, `enrichWiki ${v.name} failed`, summarizeForLog(err));
    }
    await sleep(GAP_MS);
  }

  const result = { candidates: volcanoes.length, enriched, withPhoto, noMatch };
  log(TAG, `enrichWiki done`, result);
  blogInfo(
    TAG,
    `volcano wiki enrich: ${enriched} enriched (${withPhoto} with a photo), ${noMatch} no match`,
    result,
    "volcanoes",
    "enrich",
  );
  // Live push so the overlay/admin table refetch the instant enrichment lands.
  if (enriched > 0) emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "volcanoes", count: enriched } });
  return result;
}

/** Job handler: `volcanoes.enrichWiki`. */
export async function enrichWiki(job: Job) {
  const d = job.data?.data ?? {};
  try {
    return await runVolcanoWikiEnrich({ force: d.force });
  } catch (err) {
    log(TAG, `enrichWiki failed`, summarizeForLog(err));
    blogErr(TAG, `volcano wiki enrichment failed`, err, "volcanoes", "enrich");
    throw err;
  }
}

// ── LLM bulletin parsing ──────────────────────────────────────────────────────

/**
 * Re-parse each volcano whose weekly `latestReport` text is newer than its
 * last LLM parse (see volcano-repo.ts#listNeedingReportParse) — unlike wiki
 * enrichment this re-runs every time a fresh bulletin lands, not on a 30-day
 * gate. Fully skips (never touches Mongo) when `OPENROUTER_API_KEY` is unset.
 */
export async function runVolcanoReportParse() {
  const db = await getAppDb();
  const volcanoes = await db.volcanoes.listNeedingReportParse();
  log(TAG, `parseReports ${volcanoes.length} candidates`);

  let parsed = 0;
  let skipped = 0;
  let failed = 0;
  for (const v of volcanoes) {
    const facts = await parseReportFacts(v.latestReport ?? "");
    if (facts.status === "skipped") {
      skipped++;
      break; // no API key configured — every subsequent call will also skip.
    }
    if (facts.status === "error") {
      failed++;
      log(TAG, `parseReports ${v.name} failed`, facts.error);
      continue;
    }
    await db.volcanoes.updateEnrichment(v.volcanoId, {
      reportVei: facts.vei,
      reportPlumeHeightM: facts.plumeHeightM,
      reportParsedAt: new Date(),
    });
    parsed++;
    await sleep(GAP_MS);
  }

  const result = { candidates: volcanoes.length, parsed, skipped, failed };
  log(TAG, `parseReports done`, result);
  if (parsed > 0) emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "volcanoes", count: parsed } });
  return result;
}

/** Job handler: `volcanoes.parseReports`. */
export async function parseReports(_job: Job) {
  try {
    return await runVolcanoReportParse();
  } catch (err) {
    log(TAG, `parseReports failed`, summarizeForLog(err));
    blogErr(TAG, `volcano report parsing failed`, err, "volcanoes", "parseReports");
    throw err;
  }
}

// ── USGS VONA (near-real-time alert level, US-monitored volcanoes only) ─────

/**
 * Pulls the USGS VHP status GeoJSON — the full current alert state for every
 * US-monitored volcano, much fresher than the weekly GVP bulletin. Because it
 * reports NORMAL/GREEN too (not just elevated), a de-escalation is visible and
 * lands a timeline beat. Elevated volcanoes upsert a tracking stub; NORMAL ones
 * only patch a volcano we already track (no 150-dormant-stub flood); UNASSIGNED
 * are skipped. Undocumented endpoint → per-item failures are swallowed while a
 * total fetch failure still surfaces (matches the GVP snapshot).
 */
export async function snapshotUsgs(_job: Job) {
  const db = await getAppDb();
  try {
    const statuses = await fetchUsgsVolcanoStatus();
    const ids = statuses.map((s) => s.volcanoId);
    // Prev snapshot before the USGS patches land, so a level move produces a beat.
    const prev = eventsUnifiedEnabled() ? await db.volcanoes.listByIds(ids) : [];
    let elevated = 0;
    let patched = 0;
    for (const s of statuses) {
      if (s.unassigned) continue; // no monitoring assessment — record nothing.
      const patch = {
        usgsAlertLevel: s.alertLevel,
        usgsColorCode: s.colorCode,
        usgsNoticeSynopsis: s.noticeSynopsis,
        usgsNoticeUrl: s.noticeUrl,
        usgsUpdatedAt: new Date(s.updatedAtMs),
      };
      if (s.elevated) {
        await db.volcanoes.updateUsgsAlert(s.volcanoId, { name: s.name, lat: s.lat, lng: s.lng }, patch);
        elevated++;
      } else if (await db.volcanoes.updateUsgsAlertIfExists(s.volcanoId, patch)) {
        patched++; // NORMAL/GREEN on a volcano we already track — catches a downgrade.
      }
    }
    if (eventsUnifiedEnabled()) {
      // Re-read the merged docs (stub-upserts + patched fields) as the NEXT side.
      const next = await db.volcanoes.listByIds(ids);
      await promoteVolcanoStatus(db, prev, next, "usgs");
    }
    const result = { volcanoes: statuses.length, elevated, patched };
    log(TAG, `usgs status snapshot done`, result);
    blogInfo(TAG, `usgs status snapshot: ${elevated} elevated, ${patched} tracked`, result, "volcanoes", "snapshotUsgs");
    if (elevated + patched > 0) {
      emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "volcanoes", count: elevated + patched } });
    }
    return result;
  } catch (err) {
    log(TAG, `usgs status snapshot failed`, summarizeForLog(err));
    blogErr(TAG, `usgs status snapshot failed`, err, "volcanoes", "snapshotUsgs");
    throw err;
  }
}
