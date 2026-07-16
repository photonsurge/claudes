import type { Job } from "bullmq";
import sharp from "sharp";
import type { AppDb } from "@photonsurge/shared/db/index";
import { getAppDb } from "@photonsurge/shared/db/index";
import { fetchVolcanoes } from "@photonsurge/shared/volcanoes/gvp";
import { fetchUsgsVolcanoStatus } from "@photonsurge/shared/volcanoes/usgs-geojson";
import { fetchGeonetVal, type GeonetVolcano } from "@photonsurge/shared/volcanoes/geonet";
import { fetchGvpCatalog, nearestGvp } from "@photonsurge/shared/volcanoes/gvp-catalog";
import { fetchGeonetCams } from "@photonsurge/shared/volcanoes/geonet-cams";
import type { NormalizedVolcanoLevel } from "@photonsurge/shared/volcanoes/diff";
import type { VolcanoStatus } from "@photonsurge/shared/volcanoes/types";
import type { Cam } from "@photonsurge/shared/cams/types";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import { diffVolcanoStatus } from "@photonsurge/shared/volcanoes/diff";
import { volcanoTimelineUpdatesFromChanges } from "@photonsurge/shared/events/promote";
import type { NewEventTimelineUpdate } from "@photonsurge/shared/db/event-timeline-update-model";
import { fetchWikiSummary, fetchWikiGallery } from "@photonsurge/shared/utill/wikipedia";
import { fetchVolcanoFacts } from "@photonsurge/shared/utill/wikidata";
import { log } from "@photonsurge/shared/utill/logger";
import { TRACKS_UPDATED } from "@photonsurge/shared/control";
import { eventsUnifiedEnabled, shouldPromoteVolcano } from "../events/config";
import { hourSlotOf } from "../alerts/snapshot-select";
import { pHash, hamming } from "../satimg/phash";
import { frameLuma, isDarkFrame, pickEvenly, buildTimelapseWebp, planCamThinning } from "../volcanoes/camFrames";
import { summarizeForLog } from "../utils";
import { blogInfo, blogErr } from "../blog";
import { emitWorkerEvent } from "../socket";
import { parseReportFacts } from "../volcanoes/parseReport";
import { fetchAvoCameraRegistry } from "../volcano/media/avo";
import { fetchUsgsAshcam, fetchUsgsVolcanoWebcams, USGS_ASHCAM_API, USGS_VHP_WEBCAMS } from "../volcano/media/usgs";
import { fetchImoEruptionImages, IMO_EPOS_OPENAPI } from "../volcano/media/imo";
import { fetchIngvCameras, INGV_ETNA_PAGE } from "../volcano/media/ingv";
import { fetchPhivolcsCameras, PHIVOLCS_INSTRUMENTS } from "../volcano/media/phivolcs";
import { fetchMagmaCameras, MAGMA_CCTV_URL } from "../volcano/media/magma";
import { fetchGvpImages } from "../volcano/media/gvpImages";
import { fetchVolcatImages, VOLCAT_LIST_URL } from "../volcano/media/volcat";
import { fetchNasaVolcanoImages, NASA_IMAGES_SEARCH } from "../volcano/media/nasaImages";
import { fetchJmaCameras, JMA_VOLCAMS } from "../volcano/media/jma";
import { fetchCenapredCameras, CENAPRED_POPO } from "../volcano/media/cenapred";
import { fetchOvpfCameras, OVPF_CAMERAS } from "../volcano/media/ovpf";
import type { VolcanoCameraMode, VolcanoMediaType } from "@photonsurge/shared/volcanoes/media";
import { runExclusive } from "../jobLock";
import { fetchWithTimeout, mapPool } from "../http";

const TAG = "job:volcanoes";

/**
 * Stop the media schedules stacking up (three `officialMedia` runs at once was
 * the observed symptom): each takes longer than its own interval, so the next
 * tick starts before the last finished and copies pile up, hammering the same
 * providers concurrently. A skipped run is harmless — the next tick picks it up.
 *
 * TWO locks, not one. The catalog walkers (official stills + satellite products)
 * are slow and share providers, so they serialise against each other. Camera
 * refresh gets its own: it's the live "what does it look like right now" imagery
 * the deck airs every 5 minutes, and it must never sit behind a photo sweep.
 */
const VOLCANO_MEDIA_LOCK = "volcano-media";
const VOLCANO_CAMERA_LOCK = "volcano-cameras";

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
    // hook can diff prev-vs-persisted rather than prev-vs-prev. Doubles as the
    // first-seen check below, so it's one read serving both.
    const prev = await db.volcanoes.listByIds(volcanoes.map((v) => v.id));
    const known = new Set(prev.map((v) => v.id));
    const r = await db.volcanoes.upsertMany(volcanoes);
    if (eventsUnifiedEnabled()) await promoteVolcanoStatus(db, prev, volcanoes, "gvp");

    // A volcano appearing in the bulletin for the first time is the one moment
    // its wiki enrichment is both missing and worth having — it's active by
    // definition, and it may be on air within the half-hour. Enrichment is
    // otherwise operator-triggered ONLY (no cron, no boot sweep — see
    // worker/src/index.ts), so this hook is deliberately narrow: just the
    // first-seen ids, on the low-priority lane, never a catalog sweep.
    const newIds = volcanoes.map((v) => v.id).filter((id) => !known.has(id));
    if (newIds.length) {
      await sendToQueue("volcanoes", "volcanoes", "enrichWiki", { ids: newIds }, undefined, QUEUE_PRIORITY.LOW);
      log(TAG, `queued enrichWiki for ${newIds.length} first-seen volcanoes`, { ids: newIds });
    }

    const result = { volcanoes: volcanoes.length, upserted: r.upserted, firstSeen: newIds.length };
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
 *
 * `searchOverride` (operator-set, on /admin/volcanoes/:id) wins OUTRIGHT rather
 * than joining the list: it exists for the volcanoes whose name derives the
 * WRONG article, so falling back to the derived guesses would just re-fetch the
 * wrong one the operator was correcting. A bad override shows as "no match",
 * which is the honest, fixable outcome.
 */
export function titleCandidates(name: string, searchOverride?: string): string[] {
  const override = searchOverride?.trim();
  if (override) return [override];
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
  /** Narrow the sweep to these source ids (the first-seen hook). Never widens. */
  ids?: string[];
}

/** Cache Wikipedia title/thumb/extract onto active volcano docs. Incremental
 *  (skips fresh ones unless force); never closes the connection (caller owns it). */
export async function runVolcanoWikiEnrich(opts: VolcanoWikiEnrichOpts = {}) {
  const force = Boolean(opts.force);
  const db = await getAppDb();
  const staleBefore = new Date(Date.now() - STALE_DAYS * 86_400_000);
  const volcanoes = await db.volcanoes.listNeedingEnrichment(staleBefore, force, { ids: opts.ids });
  log(TAG, `enrichWiki ${volcanoes.length} volcanoes`, { force, ids: opts.ids?.length });

  let enriched = 0;
  let withPhoto = 0;
  let noMatch = 0;
  for (const v of volcanoes) {
    try {
      let r: Awaited<ReturnType<typeof fetchWikiSummary>> = "missing";
      for (const title of titleCandidates(v.name, v.searchOverride)) {
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
  const ids = Array.isArray(d.ids) && d.ids.length ? (d.ids as string[]) : undefined;
  try {
    return await runVolcanoWikiEnrich({ force: d.force, ids });
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

// ── GeoNet (New Zealand) official Volcanic Alert Levels ─────────────────────

/** Max distance for a GeoNet slug → GVP catalog coordinate crosswalk. */
const GEONET_MATCH_KM = 25;

/** GeoNet normalized level → our coarse overlay status. */
function statusForLevel(n: NormalizedVolcanoLevel): VolcanoStatus {
  if (n === "eruption") return "erupting";
  if (n === "watch" || n === "warning" || n === "unrest" || n === "advisory") return "unrest";
  return "dormant";
}

/**
 * Dispatched as `volcanoes.snapshotGeonet`. Pulls GeoNet's official NZ Volcanic
 * Alert Levels and writes them onto the crosswalked volcano as OFFICIAL status
 * (outranks the GVP weekly bulletin), kept in its own fields so the two schemes
 * don't overwrite each other. A level change lands a timeline beat via the shared
 * promote hook (behind EVENTS_UNIFIED_ENABLED).
 *
 * Crosswalk: a stored source-link resolves instantly (never re-match); a new
 * ELEVATED volcano is matched against the WORLDWIDE GVP catalog (fetched once,
 * only when needed) and a stub volcano doc is seeded — so an active NZ volcano
 * that isn't in the weekly bulletin still gets tracked. Quiet, unlinked volcanoes
 * (level 0) are ignored.
 */
export async function snapshotGeonet(_job: Job) {
  const db = await getAppDb();
  try {
    const volcanoes = await fetchGeonetVal();
    const now = new Date();
    const resolved: { volcanoId: string; g: GeonetVolcano }[] = [];
    const needCrosswalk: GeonetVolcano[] = [];

    // Pass 1 — resolve by existing link; queue unlinked elevated ones for crosswalk.
    for (const g of volcanoes) {
      const link = await db.volcanoSourceLinks.find("geonet", g.externalId);
      if (link) resolved.push({ volcanoId: link.volcanoId, g });
      else if (g.elevated) needCrosswalk.push(g);
    }

    // Pass 2 — crosswalk the unlinked elevated volcanoes against the GVP catalog
    // (one fetch, only when there's something to resolve), seeding a stub + link.
    if (needCrosswalk.length) {
      const catalog = await fetchGvpCatalog();
      for (const g of needCrosswalk) {
        const match = nearestGvp(catalog, g.lng, g.lat, GEONET_MATCH_KM);
        if (!match) {
          log(TAG, `geonet crosswalk miss`, { slug: g.externalId });
          continue;
        }
        const e = match.entry;
        await db.volcanoes.upsertStub(e.volcanoId, {
          name: e.name,
          lat: e.lat,
          lng: e.lng,
          country: e.country,
          status: statusForLevel(g.normalized),
          sourceUrl: e.sourceUrl,
          elevationM: e.elevationM,
        });
        await db.volcanoSourceLinks.upsert({
          volcanoId: e.volcanoId,
          source: "geonet",
          externalId: g.externalId,
          externalUrl: `https://www.geonet.org.nz/volcano/${g.externalId}`,
          matchMethod: "coordinate",
          matchScore: Math.max(0, 1 - match.distanceKm / GEONET_MATCH_KM),
        });
        log(TAG, `geonet crosswalk`, { slug: g.externalId, volcanoId: e.volcanoId, km: Math.round(match.distanceKm) });
        resolved.push({ volcanoId: e.volcanoId, g });
      }
    }

    const ids = resolved.map((r) => r.volcanoId);
    const prev = eventsUnifiedEnabled() ? await db.volcanoes.listByIds(ids) : [];
    let updated = 0;
    for (const { volcanoId, g } of resolved) {
      const ok = await db.volcanoes.updateOfficialStatus(
        volcanoId,
        {
          officialSource: "geonet",
          officialAlertScheme: "GEONET_VAL",
          officialAlertLevelRaw: g.levelRaw,
          officialAlertLevelNormalized: g.normalized,
          officialActivity: g.activity || undefined,
          officialUpdatedAt: now,
        },
        { keepAlive: g.elevated },
      );
      if (ok) updated++;
    }
    if (eventsUnifiedEnabled()) {
      const next = await db.volcanoes.listByIds(ids);
      await promoteVolcanoStatus(db, prev, next, "geonet");
    }
    const result = { volcanoes: volcanoes.length, resolved: resolved.length, updated };
    log(TAG, `geonet val snapshot done`, result);
    blogInfo(TAG, `geonet val snapshot: ${resolved.length} resolved, ${updated} updated`, result, "volcanoes", "snapshotGeonet");
    if (updated > 0) emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "volcanoes", count: updated } });
    return result;
  } catch (err) {
    log(TAG, `geonet val snapshot failed`, summarizeForLog(err));
    blogErr(TAG, `geonet val snapshot failed`, err, "volcanoes", "snapshotGeonet");
    throw err;
  }
}

// ── GeoNet volcano cameras (official monitoring stills) ─────────────────────

/** Max distance for a GeoNet camera → GVP catalog coordinate crosswalk. */
const GEONET_CAM_MATCH_KM = 30;

/**
 * Dispatched as `volcanoes.ingestGeonetCams`. Pulls GeoNet's official volcano
 * camera catalogue into the generic Cam collection (provider "geonet"), tagging
 * each with the volcano's `gvp:<vnum>` id(s) so the detail page can list "cameras
 * for this volcano". The slug→volcano crosswalk reuses the same source-links +
 * GVP-catalog match as the status job. P2a stores the LIVE latest-image URL;
 * on-disk frame capture + retention + timelapse is P2b.
 */
export async function ingestGeonetCams(_job: Job) {
  const db = await getAppDb();
  try {
    const geonetCams = await fetchGeonetCams();
    let catalog: Awaited<ReturnType<typeof fetchGvpCatalog>> | null = null;
    const cams: Cam[] = [];
    const mediaCameras: Parameters<typeof db.volcanoCameras.upsertMany>[0] = [];
    let associated = 0;
    for (const gc of geonetCams) {
      const gvpIds = new Set<string>();
      for (const slug of gc.volcanoSlugs) {
        const link = await db.volcanoSourceLinks.find("geonet", slug);
        if (link) gvpIds.add(link.volcanoId);
      }
      // No existing link — catalog-match the camera's coords to the nearest
      // volcano and seed the primary link so the camera associates immediately.
      if (gvpIds.size === 0 && gc.volcanoSlugs.length) {
        if (!catalog) catalog = await fetchGvpCatalog();
        const match = nearestGvp(catalog, gc.lng, gc.lat, GEONET_CAM_MATCH_KM);
        if (match) {
          gvpIds.add(match.entry.volcanoId);
          await db.volcanoSourceLinks.upsert({
            volcanoId: match.entry.volcanoId,
            source: "geonet",
            externalId: gc.volcanoSlugs[0],
            matchMethod: "coordinate",
            matchScore: Math.max(0, 1 - match.distanceKm / GEONET_CAM_MATCH_KM),
          });
        }
      }
      if (gvpIds.size) associated++;
      const primaryVolcanoId = gvpIds.values().next().value as string | undefined;
      if (primaryVolcanoId) {
        mediaCameras.push({
          volcanoId: primaryVolcanoId,
          source: "GEONET",
          sourceCameraId: gc.cameraId,
          name: gc.title,
          mode: "VISIBLE",
          latitude: gc.lat,
          longitude: gc.lng,
          bearing: gc.azimuthDeg,
          currentImageUrl: gc.imageUrl,
          detailUrl: "https://www.geonet.org.nz/volcano/cameras",
          upstreamTimestamp: gc.timestampText,
          attribution: "GeoNet / GNS Science (CC BY 4.0)",
          licence: "CC BY 4.0",
          reuseAllowed: true,
          enabled: true,
        });
      }
      cams.push({
        camId: `geonet-vol:${gc.cameraId}`,
        provider: "geonet",
        title: gc.title,
        lat: gc.lat,
        lng: gc.lng,
        status: "active",
        country: "New Zealand",
        imageUrl: gc.imageUrl,
        playerUrl: "https://www.geonet.org.nz/volcano/cameras",
        tags: ["volcano", ...gc.volcanoSlugs.map((s) => `geonet:${s}`), ...gvpIds],
        attribution: {
          provider: "GeoNet / GNS Science",
          requiredText: "GeoNet / GNS Science (CC BY 4.0)",
          linkUrl: "https://www.geonet.org.nz/volcano/cameras",
        },
        fetchedAt: Date.now(),
      });
    }
    const [r, mediaResult] = await Promise.all([
      db.cams.upsertMany(cams),
      db.volcanoCameras.upsertMany(mediaCameras),
    ]);
    await db.volcanoMediaSources.upsert({
      source: "GEONET",
      name: "GeoNet / GNS Science",
      registryUrl: "https://images.geonet.org.nz/volcano/cameras/all.json",
      enabled: true,
      registryPollSeconds: 30 * 60,
      mediaPollSeconds: 60 * 60,
      attribution: "GeoNet / GNS Science (CC BY 4.0)",
      defaultLicence: "CC BY 4.0",
      defaultReuseAllowed: true,
      lastDiscoveredAt: new Date(),
    });
    const result = { cameras: cams.length, associated, upserted: r.upserted, mediaCameras: mediaCameras.length,
      mediaUpserted: mediaResult.upserted };
    log(TAG, `geonet cams ingest done`, result);
    blogInfo(TAG, `geonet cams: ${cams.length} cameras, ${associated} volcano-linked`, result, "volcanoes", "ingestGeonetCams");
    if (cams.length > 0) emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "volcanoes", count: cams.length } });
    return result;
  } catch (err) {
    log(TAG, `geonet cams ingest failed`, summarizeForLog(err));
    blogErr(TAG, `geonet cams ingest failed`, err, "volcanoes", "ingestGeonetCams");
    throw err;
  }
}

// ── Volcano-specific media registry + byte acquisition ──────────────────────

const normalizedVolcanoName = (value: string) => value.toLowerCase().normalize("NFKD")
  .replace(/[^a-z0-9]+/g, " ").trim().replace(/\b(?:volcano|mount|mt)\b/g, "").replace(/\s+/g, " ").trim();

const mediaTypeForCamera = (mode: VolcanoCameraMode): VolcanoMediaType =>
  mode === "THERMAL" ? "THERMAL" : mode === "IR" ? "IR" : "WEBCAM";
const mediaDiagnosticError = (err: unknown): string => {
  const summary = summarizeForLog(err);
  return typeof summary === "string" ? summary : `${summary.name}: ${summary.message}`;
};

/**
 * Discover source camera records without touching the existing GVP ingest.
 * AVO is the first adapter; subsequent source adapters write the same registry.
 */
export async function mediaRegistry(_job: Job) {
  const db = await getAppDb();
  try {
    const [discovered, volcanoes] = await Promise.all([
      fetchAvoCameraRegistry().catch((err) => { log(TAG, "AVO registry unavailable", summarizeForLog(err)); return []; }),
      db.volcanoes.list(),
    ]);
    const byName = new Map(volcanoes.map((v) => [normalizedVolcanoName(v.name), v]));
    let avoCatalog: Awaited<ReturnType<typeof fetchGvpCatalog>> | null = null;
    const findVolcano = (name: string) => {
      const key = normalizedVolcanoName(name);
      return byName.get(key) ?? volcanoes.find((v) => {
        const candidate = normalizedVolcanoName(v.name);
        return candidate.length >= 4 && (candidate.includes(key) || key.includes(candidate));
      });
    };
    const cameras = [];
    const generic: Cam[] = [];
    let unmatched = 0;
    const avoUnmatchedNames: string[] = [];
    for (const camera of discovered) {
      let volcano = byName.get(normalizedVolcanoName(camera.volcanoName));
      if (!volcano) {
        avoCatalog ??= await fetchGvpCatalog().catch(() => []);
        const nameKey = normalizedVolcanoName(camera.volcanoName);
        const entry = avoCatalog.find((candidate) => normalizedVolcanoName(candidate.name) === nameKey);
        if (entry) {
          await db.volcanoes.upsertStub(entry.volcanoId, {
            name: entry.name, lat: entry.lat, lng: entry.lng, country: entry.country,
            status: "dormant", sourceUrl: entry.sourceUrl, elevationM: entry.elevationM,
          });
          volcano = {
            id: entry.volcanoId, name: entry.name, country: entry.country, lat: entry.lat, lng: entry.lng,
            status: "dormant", firstDate: Date.now(), lastDate: Date.now(), statusChangedAt: Date.now(),
            sourceUrl: entry.sourceUrl, elevationM: entry.elevationM,
          };
          byName.set(nameKey, volcano);
        }
      }
      if (!volcano) { unmatched++; if (avoUnmatchedNames.length < 10) avoUnmatchedNames.push(camera.volcanoName); continue; }
      const latitude = camera.latitude ?? volcano.lat;
      const longitude = camera.longitude ?? volcano.lng;
      cameras.push({
        volcanoId: volcano.id,
        source: "AVO" as const,
        sourceCameraId: camera.sourceCameraId,
        name: camera.name,
        mode: camera.mode,
        latitude,
        longitude,
        bearing: camera.bearing,
        currentImageUrl: camera.currentImageUrl,
        detailUrl: camera.detailUrl,
        videoUrl: camera.video12hUrl,
        upstreamTimestamp: camera.upstreamTimestamp,
        attribution: "Alaska Volcano Observatory / USGS",
        licence: "VERIFY",
        reuseAllowed: false,
        enabled: true,
      });
      generic.push({
        camId: `avo:${camera.sourceCameraId}`,
        provider: "avo",
        title: camera.name,
        lat: latitude,
        lng: longitude,
        status: "active",
        country: "United States",
        imageUrl: camera.currentImageUrl,
        timelapseUrl: camera.video12hUrl,
        playerUrl: camera.detailUrl,
        tags: ["volcano", volcano.id, `avo:${camera.volcanoName}`],
        attribution: { provider: "Alaska Volcano Observatory", linkUrl: camera.detailUrl },
        fetchedAt: Date.now(),
      });
      await db.volcanoSourceLinks.upsert({
        volcanoId: volcano.id, source: "avo", externalId: camera.volcanoName,
        externalCode: camera.sourceCameraId, externalUrl: camera.detailUrl,
        matchMethod: "name", matchScore: 1,
      });
    }
    const [cameraResult, genericResult] = await Promise.all([
      db.volcanoCameras.upsertMany(cameras), db.cams.upsertMany(generic),
    ]);
    await db.volcanoMediaSources.upsert({
      source: "AVO",
      name: "Alaska Volcano Observatory",
      registryUrl: "https://avo.alaska.edu/webcam/",
      enabled: true,
      registryPollSeconds: 6 * 60 * 60,
      mediaPollSeconds: 5 * 60,
      attribution: "Alaska Volcano Observatory / USGS",
      defaultLicence: "VERIFY",
      defaultReuseAllowed: false,
      lastDiscoveredAt: new Date(),
    });
    // Do not depend on snapshotUsgs having run first. Its live catalogue gives
    // us stable GVP ids for elevated volcanoes; tracked NORMAL volcanoes remain
    // eligible without creating a database full of dormant monitoring stubs.
    let usgsDiscovered = 0;
    let usgsPages = 0;
    let usgsPageMisses = 0;
    const usgsDiagnostics: Array<{ stage: string; url: string; status?: number; reason: string }> = [];
    const usgsCameras: Parameters<typeof db.volcanoCameras.upsertMany>[0] = [];
    const usgsGeneric: Cam[] = [];
    const usgsStatuses = await fetchUsgsVolcanoStatus().catch((err) => {
      log(TAG, "USGS status catalogue unavailable during media discovery", summarizeForLog(err)); return [];
    });
    const trackedById = new Map(volcanoes.map((v) => [v.id, v]));
    const usgsAshcam = await fetchUsgsAshcam().catch((err) => {
      if (usgsDiagnostics.length < 20) usgsDiagnostics.push({ stage: "api", url: USGS_ASHCAM_API, reason: mediaDiagnosticError(err) });
      return [];
    });
    const usgsCandidates = usgsStatuses.flatMap((status) => {
      const tracked = trackedById.get(status.volcanoId);
      if (tracked) return [tracked];
      if (!status.elevated || status.unassigned) return [];
      return [{ id: status.volcanoId, name: status.name, lat: status.lat, lng: status.lng,
        country: "United States", status: "unrest" as const, firstDate: Date.now(), lastDate: Date.now(),
        statusChangedAt: Date.now(), usgsAlertLevel: status.alertLevel, usgsColorCode: status.colorCode }];
    });
    const addUsgsCamera = (volcano: (typeof usgsCandidates)[number], camera: Awaited<ReturnType<typeof fetchUsgsVolcanoWebcams>>[number]) => {
      usgsCameras.push({ volcanoId: volcano.id, source: "USGS_VHP", sourceCameraId: camera.sourceCameraId,
        name: camera.name, mode: camera.mode, latitude: (camera as any).latitude ?? volcano.lat,
        longitude: (camera as any).longitude ?? volcano.lng, currentImageUrl: camera.currentImageUrl,
        detailUrl: camera.detailUrl, videoUrl: camera.gif24hUrl, attribution: camera.attribution,
        licence: camera.licence, reuseAllowed: camera.reuseAllowed, enabled: true });
      usgsGeneric.push({ camId: `usgs-vhp:${camera.sourceCameraId}`, provider: "usgs_vhp", title: camera.name,
        lat: (camera as any).latitude ?? volcano.lat, lng: (camera as any).longitude ?? volcano.lng, status: "active",
        country: volcano.country, imageUrl: camera.currentImageUrl, timelapseUrl: camera.gif24hUrl,
        playerUrl: camera.detailUrl, tags: ["volcano", volcano.id], attribution: { provider: "USGS Volcano Hazards Program",
          requiredText: camera.licence, linkUrl: camera.detailUrl }, fetchedAt: Date.now() });
    };
    if (usgsAshcam.length) {
      const candidateById = new Map(usgsCandidates.map((v) => [v.id, v]));
      for (const camera of usgsAshcam) {
        const volcano = camera.volcanoNumber ? candidateById.get(`gvp:${camera.volcanoNumber}`) :
          usgsCandidates.find((v) => camera.volcanoName && normalizedVolcanoName(v.name) === normalizedVolcanoName(camera.volcanoName));
        if (!volcano) continue;
        addUsgsCamera(volcano, camera);
      }
      usgsDiscovered = usgsCameras.length;
    }
    for (const volcano of usgsAshcam.length ? [] : usgsCandidates) {
      const slug = volcano.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
        .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const pageUrl = `https://www.usgs.gov/volcanoes/${slug}/webcams`;
      const found = await fetchUsgsVolcanoWebcams(pageUrl, fetch, (event) => {
        if (usgsDiagnostics.length < 20) usgsDiagnostics.push(event);
      }).catch((err) => {
        if (usgsDiagnostics.length < 20) usgsDiagnostics.push({ stage: "page", url: pageUrl, reason: mediaDiagnosticError(err) });
        log(TAG, "USGS webcam page unavailable", { volcanoId: volcano.id, pageUrl, err: summarizeForLog(err) });
        return [];
      });
      usgsPages++;
      if (!found.length) usgsPageMisses++;
      usgsDiscovered += found.length;
      for (const camera of found) {
        addUsgsCamera(volcano, camera);
      }
    }
    const [usgsCameraResult, usgsGenericResult] = await Promise.all([
      db.volcanoCameras.upsertMany(usgsCameras), db.cams.upsertMany(usgsGeneric),
    ]);
    await db.volcanoMediaSources.upsert({
      source: "USGS_VHP", name: "USGS Volcano Hazards Program", registryUrl: USGS_VHP_WEBCAMS,
      enabled: true, registryPollSeconds: 24 * 60 * 60, mediaPollSeconds: 5 * 60,
      attribution: "U.S. Geological Survey Volcano Hazards Program", defaultLicence: "VERIFY",
      defaultReuseAllowed: false, lastDiscoveredAt: new Date(),
    });
    const phivolcsDiagnostics: Array<{ stage: string; url: string; status?: number; reason: string; volcano?: string }> = [];
    const providerErrors: Record<string, string> = {};
    const [ingvFound, phivolcsFound, magmaFound, jmaFound, cenapredFound, ovpfFound] = await Promise.all([
      fetchIngvCameras().catch((err) => { providerErrors.ingv = mediaDiagnosticError(err); return []; }),
      fetchPhivolcsCameras(fetch, (event) => { if (phivolcsDiagnostics.length < 20) phivolcsDiagnostics.push(event); })
        .catch((err) => { providerErrors.phivolcs = mediaDiagnosticError(err); return []; }),
      fetchMagmaCameras().catch((err) => { providerErrors.magma = mediaDiagnosticError(err); return []; }),
      fetchJmaCameras().catch((err) => { providerErrors.jma = mediaDiagnosticError(err); return []; }),
      fetchCenapredCameras().catch((err) => { providerErrors.cenapred = mediaDiagnosticError(err); return []; }),
      fetchOvpfCameras().catch((err) => { providerErrors.ovpf = mediaDiagnosticError(err); return []; }),
    ]);
    const extraCameras: Parameters<typeof db.volcanoCameras.upsertMany>[0] = [];
    const extraGeneric: Cam[] = [];
    const extraStubWrites: Promise<unknown>[] = [];
    type ExtraSource = "INGV" | "PHIVOLCS" | "MAGMA" | "JMA" | "CENAPRED" | "IPGP_OVPF";
    const extraUnmatched: Record<ExtraSource, string[]> = { INGV: [], PHIVOLCS: [], MAGMA: [], JMA: [], CENAPRED: [], IPGP_OVPF: [] };
    const addExtra = (source: ExtraSource, found: {
      sourceCameraId: string; volcanoName: string; name: string; imageUrl: string; detailUrl: string;
      mode?: VolcanoCameraMode; observedAt?: string;
    }, reusable: boolean) => {
      let volcano = findVolcano(found.volcanoName);
      if (!volcano && avoCatalog) {
        const jmaName = source === "JMA" ? Object.entries({ "富士山": "Fuji", "箱根山": "Hakone", "伊豆大島": "Izu-Oshima",
          "三宅島": "Miyakejima", "阿蘇山": "Aso", "雲仙岳": "Unzen", "霧島山": "Kirishimayama", "桜島": "Sakura-jima",
          "薩摩硫黄島": "Satsuma-Iojima", "口永良部島": "Kuchinoerabujima" }).find(([jp]) => found.volcanoName.includes(jp))?.[1] : undefined;
        const rawKey = normalizedVolcanoName(jmaName ?? found.volcanoName);
        const key = ({ bromo: "tengger caldera" } as Record<string, string>)[rawKey] ?? rawKey;
        const entry = avoCatalog.find((candidate) => {
          const candidateKey = normalizedVolcanoName(candidate.name);
          return candidateKey === key || (key.length >= 4 && (candidateKey.includes(key) || key.includes(candidateKey)));
        });
        if (entry) {
          volcano = { id: entry.volcanoId, name: entry.name, country: entry.country, lat: entry.lat, lng: entry.lng,
            status: "dormant", firstDate: Date.now(), lastDate: Date.now(), statusChangedAt: Date.now(),
            sourceUrl: entry.sourceUrl, elevationM: entry.elevationM };
          byName.set(normalizedVolcanoName(entry.name), volcano);
          extraStubWrites.push(db.volcanoes.upsertStub(entry.volcanoId, { name: entry.name, lat: entry.lat, lng: entry.lng,
            country: entry.country, status: "dormant", sourceUrl: entry.sourceUrl, elevationM: entry.elevationM }));
        }
      }
      if (!volcano) { if (extraUnmatched[source].length < 10) extraUnmatched[source].push(found.volcanoName); return; }
      const provider = ({ INGV: "ingv", PHIVOLCS: "phivolcs", MAGMA: "magma", JMA: "jma", CENAPRED: "cenapred", IPGP_OVPF: "ipgp_ovpf" } as const)[source];
      const sourceName = ({ INGV: "INGV Osservatorio Etneo", PHIVOLCS: "PHIVOLCS VOLCAN", MAGMA: "MAGMA Indonesia / PVMBG",
        JMA: "Japan Meteorological Agency", CENAPRED: "CENAPRED", IPGP_OVPF: "IPGP OVPF" } as const)[source];
      extraCameras.push({
        volcanoId: volcano.id, source, sourceCameraId: found.sourceCameraId, name: found.name,
        mode: found.mode ?? "VISIBLE", latitude: volcano.lat, longitude: volcano.lng,
        currentImageUrl: found.imageUrl, detailUrl: found.detailUrl, upstreamTimestamp: found.observedAt,
        attribution: sourceName,
        licence: source === "MAGMA" ? "CC BY-NC-ND 4.0" : reusable ? "CC BY 4.0" : "VERIFY", reuseAllowed: reusable, enabled: true,
      });
      extraGeneric.push({
        camId: `${provider}:${found.sourceCameraId}`, provider, title: found.name, lat: volcano.lat, lng: volcano.lng,
        status: "active", country: volcano.country, imageUrl: found.imageUrl, playerUrl: found.detailUrl,
        tags: ["volcano", volcano.id], attribution: { provider: sourceName,
          requiredText: source === "MAGMA" ? "CC BY-NC-ND 4.0 — do not rebroadcast" : reusable ? "CC BY 4.0" : "Reuse permission unverified", linkUrl: found.detailUrl }, fetchedAt: Date.now(),
      });
    };
    avoCatalog ??= await fetchGvpCatalog().catch(() => []);
    ingvFound.forEach((camera) => addExtra("INGV", camera, true));
    phivolcsFound.forEach((camera) => addExtra("PHIVOLCS", camera, false));
    magmaFound.forEach((camera) => addExtra("MAGMA", camera, false));
    jmaFound.forEach((camera) => addExtra("JMA", camera, false));
    cenapredFound.forEach((camera) => addExtra("CENAPRED", camera, false));
    ovpfFound.forEach((camera) => addExtra("IPGP_OVPF", camera, false));
    const [extraCameraResult, extraGenericResult] = await Promise.all([
      db.volcanoCameras.upsertMany(extraCameras), db.cams.upsertMany(extraGeneric), ...extraStubWrites,
    ]);
    const ingvCameraIds = extraCameras.filter((camera) => camera.source === "INGV").map((camera) => camera.sourceCameraId);
    const ingvGenericIds = extraGeneric.filter((camera) => camera.provider === "ingv").map((camera) => camera.camId);
    const [ingvDisabled, ingvOfflined] = await Promise.all([
      db.volcanoCameras.disableMissing("INGV", ingvCameraIds), db.cams.offlineMissing("ingv", ingvGenericIds),
    ]);
    await Promise.all([
      db.volcanoMediaSources.upsert({ source: "INGV", name: "INGV Osservatorio Etneo", registryUrl: INGV_ETNA_PAGE,
        enabled: true, registryPollSeconds: 6 * 60 * 60, mediaPollSeconds: 3 * 60, attribution: "INGV Osservatorio Etneo",
        defaultLicence: "CC BY 4.0", defaultReuseAllowed: true, lastDiscoveredAt: new Date() }),
      db.volcanoMediaSources.upsert({ source: "PHIVOLCS", name: "PHIVOLCS VOLCAN", registryUrl: PHIVOLCS_INSTRUMENTS,
        enabled: true, registryPollSeconds: 6 * 60 * 60, mediaPollSeconds: 15 * 60, attribution: "PHIVOLCS VOLCAN",
        defaultLicence: "VERIFY", defaultReuseAllowed: false, lastDiscoveredAt: new Date() }),
      db.volcanoMediaSources.upsert({ source: "MAGMA", name: "MAGMA Indonesia / PVMBG", registryUrl: MAGMA_CCTV_URL,
        enabled: true, registryPollSeconds: 6 * 60 * 60, mediaPollSeconds: 5 * 60, attribution: "MAGMA Indonesia / PVMBG",
        defaultLicence: "CC BY-NC-ND 4.0", defaultReuseAllowed: false, lastDiscoveredAt: new Date() }),
      db.volcanoMediaSources.upsert({ source: "JMA", name: "Japan Meteorological Agency", registryUrl: JMA_VOLCAMS,
        enabled: true, registryPollSeconds: 12 * 60 * 60, mediaPollSeconds: 60, attribution: "Japan Meteorological Agency", defaultLicence: "VERIFY", defaultReuseAllowed: false, lastDiscoveredAt: new Date() }),
      db.volcanoMediaSources.upsert({ source: "CENAPRED", name: "CENAPRED", registryUrl: CENAPRED_POPO,
        enabled: true, registryPollSeconds: 5 * 60, mediaPollSeconds: 60, attribution: "CENAPRED", defaultLicence: "VERIFY", defaultReuseAllowed: false, lastDiscoveredAt: new Date() }),
      db.volcanoMediaSources.upsert({ source: "IPGP_OVPF", name: "IPGP OVPF", registryUrl: OVPF_CAMERAS,
        enabled: true, registryPollSeconds: 24 * 60 * 60, mediaPollSeconds: 5 * 60, attribution: "IPGP OVPF", defaultLicence: "VERIFY", defaultReuseAllowed: false, lastDiscoveredAt: new Date() }),
    ]);
    const result = { avo: { discovered: discovered.length, cameras: cameras.length, unmatched, unmatchedNames: avoUnmatchedNames,
      upserted: cameraResult.upserted, genericUpserted: genericResult.upserted },
      usgs: { catalogue: usgsStatuses.length, ashcam: usgsAshcam.length, candidates: usgsCandidates.length, pages: usgsPages,
        pageMisses: usgsPageMisses, diagnostics: usgsDiagnostics, discovered: usgsDiscovered, cameras: usgsCameras.length,
        upserted: usgsCameraResult.upserted, genericUpserted: usgsGenericResult.upserted },
      ingv: { discovered: ingvFound.length, unmatchedNames: extraUnmatched.INGV, error: providerErrors.ingv },
      phivolcs: { discovered: phivolcsFound.length, unmatchedNames: extraUnmatched.PHIVOLCS,
        diagnostics: phivolcsDiagnostics, error: providerErrors.phivolcs },
      magma: { discovered: magmaFound.length, unmatchedNames: extraUnmatched.MAGMA, error: providerErrors.magma },
      jma: { discovered: jmaFound.length, unmatchedNames: extraUnmatched.JMA, error: providerErrors.jma },
      cenapred: { discovered: cenapredFound.length, unmatchedNames: extraUnmatched.CENAPRED, error: providerErrors.cenapred },
      ovpf: { discovered: ovpfFound.length, unmatchedNames: extraUnmatched.IPGP_OVPF, error: providerErrors.ovpf },
      extra: { cameras: extraCameras.length, upserted: extraCameraResult.upserted, genericUpserted: extraGenericResult.upserted,
        ingvDisabled, ingvOfflined } };
    log(TAG, "volcano media registry done", result);
    return result;
  } catch (err) {
    log(TAG, "volcano media registry failed", summarizeForLog(err));
    blogErr(TAG, "volcano media registry failed", err, "volcanoes", "mediaRegistry");
    throw err;
  }
}

/**
 * Acquire official non-camera media — the stills a source publishes (eruption
 * photos, reference imagery). These DO append: unlike a camera frame, each is a
 * distinct, permanent picture, and they're the "nice photo" the deck leans on.
 *
 * Every block is gated on the operator's chosen sources, and skips media we
 * already hold BEFORE fetching it.
 */
export const officialMedia = (job: Job) => runExclusive(VOLCANO_MEDIA_LOCK, TAG, () => officialMediaRun(job));

async function officialMediaRun(_job: Job) {
  const db = await getAppDb();
  const [images, volcanoes, active, sources] = await Promise.all([
    fetchImoEruptionImages().catch((err) => { log(TAG, "IMO official media unavailable", summarizeForLog(err)); return []; }),
    db.volcanoes.list(),
    db.volcanoes.listSignificant(),
    db.volcanoMediaSources.list(),
  ]);
  const enabled = new Set(sources.filter((source) => source.enabled).map((source) => source.source));
  // Match names against the FULL catalog (so a picture is still correctly
  // identified), but only acquire media for the active few — see `activeIds`.
  const byName = new Map(volcanoes.map((v) => [normalizedVolcanoName(v.name), v]));
  const activeIds = new Set(active.map((v) => v.id));
  let stored = 0;
  let unchanged = 0;
  let unmatched = 0;
  let failed = 0;
  let skipped = 0;
  let wikimediaDiscovered = 0;
  for (const image of images) {
    if (!enabled.has("IMO")) { skipped++; break; }
    const volcano = image.volcanoName ? byName.get(normalizedVolcanoName(String(image.volcanoName))) : undefined;
    if (!volcano) { unmatched++; continue; }
    if (!activeIds.has(volcano.id)) { skipped++; continue; }
    if (image.sourceMediaId && await db.volcanoMedia.hasSourceMedia("IMO", image.sourceMediaId)) { unchanged++; continue; }
    try {
      const res = await fetchWithTimeout(image.imageUrl);
      if (!res.ok) { failed++; continue; }
      const bytes = Buffer.from(await res.arrayBuffer());
      const result = await db.volcanoMedia.put({
        volcanoId: volcano.id, source: "IMO", type: image.type, sourceMediaId: image.sourceMediaId,
        title: image.title ?? image.eruption, caption: image.caption, observedAt: image.observedAt,
        imageUrl: image.imageUrl, sourceUrl: image.sourceUrl, attribution: image.attribution,
        licence: image.licence, reuseAllowed: image.reuseAllowed,
        contentType: res.headers.get("content-type") ?? "application/octet-stream", bytes,
      });
      if (result.inserted) stored++; else unchanged++;
    } catch { failed++; }
  }
  let gvpDiscovered = 0;
  for (const volcano of enabled.has("GVP") ? active : []) {
    if (!volcano.sourceUrl) continue;
    const gvpImages = await fetchGvpImages(volcano.sourceUrl).catch(() => []);
    gvpDiscovered += gvpImages.length;
    for (const image of gvpImages) {
      if (await db.volcanoMedia.hasSourceMedia("GVP", image.sourceMediaId)) { unchanged++; continue; }
      try {
        const res = await fetchWithTimeout(image.imageUrl);
        if (!res.ok) { failed++; continue; }
        const result = await db.volcanoMedia.put({
          volcanoId: volcano.id, source: "GVP", type: image.type, sourceMediaId: image.sourceMediaId,
          title: image.title, caption: image.caption, imageUrl: image.imageUrl, sourceUrl: image.sourceUrl,
          attribution: image.attribution, licence: image.licence, reuseAllowed: image.reuseAllowed,
          contentType: res.headers.get("content-type") ?? "application/octet-stream",
          bytes: Buffer.from(await res.arrayBuffer()),
        });
        if (result.inserted) stored++; else unchanged++;
      } catch { failed++; }
    }
  }
  // Wikipedia enrichment already resolves the canonical lead/gallery URLs. Feed
  // those files through the same byte store so they receive deduplication,
  // provenance and rights review instead of remaining loose external URLs.
  for (const volcano of enabled.has("WIKIMEDIA") ? active : []) {
    const urls = [...new Set([volcano.wikiPhoto, ...(volcano.wikiGallery ?? [])].filter((url): url is string => Boolean(url)))];
    wikimediaDiscovered += urls.length;
    for (const imageUrl of urls) {
      if (await db.volcanoMedia.hasSourceMedia("WIKIMEDIA", imageUrl)) { unchanged++; continue; }
      try {
        const res = await fetchWithTimeout(imageUrl); if (!res.ok) { failed++; continue; }
        const result = await db.volcanoMedia.put({ volcanoId: volcano.id, source: "WIKIMEDIA", type: "PHOTO",
          sourceMediaId: imageUrl, title: `${volcano.name} reference image`, imageUrl,
          sourceUrl: volcano.wikiTitle ? `https://en.wikipedia.org/wiki/${encodeURIComponent(volcano.wikiTitle.replace(/ /g, "_"))}` : imageUrl,
          attribution: "Wikimedia contributors", licence: "VERIFY ON FILE PAGE", reuseAllowed: false,
          contentType: res.headers.get("content-type") ?? "application/octet-stream", bytes: Buffer.from(await res.arrayBuffer()) });
        if (result.inserted) stored++; else unchanged++;
      } catch { failed++; }
    }
  }
  const nasaImages = enabled.has("NASA_IMAGES")
    ? await fetchNasaVolcanoImages(active.map((v) => v.name)).catch(() => [])
    : [];
  for (const image of nasaImages) {
    const volcano = image.volcanoName ? byName.get(normalizedVolcanoName(image.volcanoName)) : undefined;
    if (!volcano) { unmatched++; continue; }
    if (!activeIds.has(volcano.id)) { skipped++; continue; }
    if (await db.volcanoMedia.hasSourceMedia("NASA_IMAGES", image.sourceMediaId)) { unchanged++; continue; }
    try {
      const res = await fetchWithTimeout(image.imageUrl); if (!res.ok) { failed++; continue; }
      const result = await db.volcanoMedia.put({ volcanoId: volcano.id, source: "NASA_IMAGES", type: image.type,
        sourceMediaId: image.sourceMediaId, title: image.title, caption: image.caption, observedAt: image.observedAt,
        imageUrl: image.imageUrl, sourceUrl: image.sourceUrl, attribution: "NASA Image and Video Library",
        licence: "NASA Media Usage Guidelines", reuseAllowed: false,
        contentType: res.headers.get("content-type") ?? "application/octet-stream", bytes: Buffer.from(await res.arrayBuffer()) });
      if (result.inserted) stored++; else unchanged++;
    } catch { failed++; }
  }
  await db.volcanoMediaSources.upsert({
    source: "IMO", name: "Icelandic Meteorological Office", registryUrl: IMO_EPOS_OPENAPI,
    enabled: true, registryPollSeconds: 24 * 60 * 60, mediaPollSeconds: 15 * 60,
    attribution: "Icelandic Meteorological Office", defaultLicence: "CC BY-SA 4.0",
    defaultReuseAllowed: true, lastDiscoveredAt: new Date(),
  });
  await db.volcanoMediaSources.upsert({
    source: "GVP", name: "Smithsonian Global Volcanism Program", registryUrl: "https://volcano.si.edu/gallery/ImageCollection.cfm",
    enabled: true, registryPollSeconds: 24 * 60 * 60, attribution: "Smithsonian Global Volcanism Program",
    defaultLicence: "VERIFY", defaultReuseAllowed: false, lastDiscoveredAt: new Date(),
  });
  await Promise.all([
    db.volcanoMediaSources.upsert({ source: "WIKIMEDIA", name: "Wikimedia Commons / Wikipedia", registryUrl: "https://commons.wikimedia.org/wiki/Category:Volcanoes",
      enabled: true, registryPollSeconds: 7 * 24 * 60 * 60, attribution: "Wikimedia contributors",
      defaultLicence: "VERIFY ON FILE PAGE", defaultReuseAllowed: false, lastDiscoveredAt: new Date() }),
    db.volcanoMediaSources.upsert({ source: "NASA_IMAGES", name: "NASA Image and Video Library", registryUrl: NASA_IMAGES_SEARCH,
      enabled: true, registryPollSeconds: 24 * 60 * 60, attribution: "NASA Image and Video Library",
      defaultLicence: "NASA Media Usage Guidelines", defaultReuseAllowed: false, lastDiscoveredAt: new Date() }),
  ]);
  const result = { imoDiscovered: images.length, gvpDiscovered, wikimediaDiscovered, nasaDiscovered: nasaImages.length,
    stored, unchanged, unmatched, failed, skipped };
  if (stored || failed) log(TAG, "official volcano media done", result);
  if (stored) emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "volcanoes", count: stored } });
  return result;
}

/** Acquire latest VOLCAT products only for volcanoes in the active cache. */
export const satelliteMedia = (job: Job) => runExclusive(VOLCANO_MEDIA_LOCK, TAG, () => satelliteMediaRun(job));

async function satelliteMediaRun(_job: Job) {
  const db = await getAppDb();
  // ACTIVE only: a satellite product for a volcano that has done nothing for
  // centuries is a picture of a quiet mountain — nothing to broadcast.
  const [volcanoes, sources] = await Promise.all([db.volcanoes.listSignificant(), db.volcanoMediaSources.list()]);
  const volcatEnabled = sources.some((source) => source.source === "VOLCAT" && source.enabled);
  // The registry row still gets refreshed below, so the source stays visible (and
  // re-enablable) in the admin UI even while it's switched off.
  const images = volcatEnabled ? await fetchVolcatImages(volcanoes.map((v) => v.name)) : [];
  let stored = 0; let unchanged = 0; let unmatched = 0; let failed = 0;
  for (const image of images) {
    const sector = normalizedVolcanoName(image.sectorId);
    const volcano = volcanoes.find((v) => {
      const name = normalizedVolcanoName(v.name); return name.length >= 4 && (sector.includes(name) || name.includes(sector));
    });
    if (!volcano) { unmatched++; continue; }
    const sourceMediaId = `${image.sectorId}:${image.product ?? "unknown"}:${image.observedAt?.toISOString() ?? image.imageUrl}`;
    if (await db.volcanoMedia.hasSourceMedia("VOLCAT", sourceMediaId)) { unchanged++; continue; }
    try {
      const res = await fetchWithTimeout(image.imageUrl); if (!res.ok) { failed++; continue; }
      const result = await db.volcanoMedia.put({
        volcanoId: volcano.id, source: "VOLCAT", type: image.type, sourceMediaId,
        title: [image.satellite, image.instrument, image.product].filter(Boolean).join(" · "), observedAt: image.observedAt,
        imageUrl: image.imageUrl, sourceUrl: image.sourceUrl, attribution: "NOAA/CIMSS VOLCAT · UW-SSEC",
        licence: "VERIFY", reuseAllowed: false, contentType: res.headers.get("content-type") ?? "application/octet-stream",
        bytes: Buffer.from(await res.arrayBuffer()),
      });
      if (result.inserted) stored++; else unchanged++;
    } catch { failed++; }
  }
  await db.volcanoMediaSources.upsert({ source: "VOLCAT", name: "NOAA/CIMSS VOLCAT", registryUrl: VOLCAT_LIST_URL,
    enabled: true, registryPollSeconds: 24 * 60 * 60, mediaPollSeconds: 10 * 60,
    attribution: "NOAA/CIMSS VOLCAT · UW-SSEC", defaultLicence: "VERIFY", defaultReuseAllowed: false,
    lastDiscoveredAt: new Date() });
  const result = { discovered: images.length, stored, unchanged, unmatched, failed, enabled: volcatEnabled };
  // Every 10 minutes, and usually a no-op — only worth a line when it did something.
  if (stored || failed) log(TAG, "volcano satellite media done", result);
  return result;
}

export async function mediaRights(_job: Job) {
  const summary = await (await getAppDb()).volcanoMedia.rightsSummary();
  const blocked = summary.filter((row) => row.reuseAllowed !== true).reduce((sum, row) => sum + row.count, 0);
  const result = { summary, blocked };
  log(TAG, "volcano media rights audit", result);
  return result;
}

/**
 * Refresh every camera's CURRENT frame — the "what does it look like right now"
 * image the volcano deck airs.
 *
 * Two rules, both deliberate:
 *  - CHOSEN SOURCES ONLY. A source the operator switched off is skipped outright:
 *    not fetched, not stored. Some feeds simply aren't broadcast-quality, and the
 *    flag existed but was read by nobody, so switching a source off did nothing.
 *  - LATEST ONLY (`putLatest`, not `put`). We keep one frame per camera and
 *    overwrite it. The old `put` appended a row + blob per novel frame with a
 *    permanent dedup window, so ~300 cameras polled every 5 min grew the
 *    collection forever with imagery no one would ever look at again.
 *
 * Runs the cameras through a bounded pool with per-request timeouts. Serially
 * and without timeouts, a handful of dead camera URLs set the runtime of the
 * whole job — this is the 5-minute schedule, so it has to finish in well under
 * five minutes or it stacks.
 */
export const cameraRefresh = (job: Job) => runExclusive(VOLCANO_CAMERA_LOCK, TAG, () => cameraRefreshRun(job));

/** Kept modest: these are observatory servers, not a CDN. */
const CAMERA_CONCURRENCY = Number(process.env.VOLCANO_CAMERA_CONCURRENCY || 8);

async function cameraRefreshRun(_job: Job) {
  const db = await getAppDb();
  const [cameras, sources] = await Promise.all([
    db.volcanoCameras.listEnabled(),
    db.volcanoMediaSources.list(),
  ]);
  const sourceMeta = new Map(sources.map((source) => [source.source, source]));
  const enabledSources = new Set(sources.filter((source) => source.enabled).map((source) => source.source));
  let stored = 0;
  let unchanged = 0;
  let failed = 0;
  let skipped = 0;
  const started = Date.now();

  // Check BEFORE fetching: a switched-off source should cost us no bandwidth and
  // no request against the provider.
  const due = cameras.filter((camera) => {
    if (!camera.currentImageUrl) return false;
    if (!enabledSources.has(camera.source)) { skipped++; return false; }
    return true;
  });

  await mapPool(due, CAMERA_CONCURRENCY, async (camera) => {
    try {
      const res = await fetchWithTimeout(camera.currentImageUrl!);
      if (!res.ok) { failed++; return; }
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!bytes.length) { failed++; return; }
      const observedAt = camera.upstreamTimestamp ? new Date(camera.upstreamTimestamp) : new Date();
      const rights = sourceMeta.get(camera.source);
      const result = await db.volcanoMedia.putLatest({
        volcanoId: camera.volcanoId,
        source: camera.source,
        type: mediaTypeForCamera(camera.mode),
        cameraId: camera.id,
        title: camera.name,
        observedAt: Number.isNaN(+observedAt) ? new Date() : observedAt,
        imageUrl: camera.currentImageUrl,
        sourceUrl: camera.detailUrl,
        latitude: camera.latitude,
        longitude: camera.longitude,
        bearing: camera.bearing,
        attribution: camera.attribution ?? rights?.attribution ?? camera.source,
        licence: camera.licence ?? rights?.defaultLicence ?? "VERIFY",
        reuseAllowed: camera.reuseAllowed ?? rights?.defaultReuseAllowed ?? false,
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
        bytes,
      });
      if (result.changed) stored++; else unchanged++;
    } catch {
      failed++;
    }
  });

  const result = { cameras: cameras.length, fetched: due.length, stored, unchanged, failed, skipped, ms: Date.now() - started };
  // Quiet by default: this runs every 5 minutes and "nothing changed" is the
  // normal outcome, so only speak up when something actually happened or broke.
  if (stored || failed) log(TAG, "volcano camera media refresh done", result);
  if (stored) emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "volcanoes", count: stored } });
  return result;
}

// ── P2b: worker-captured camera frames on disk (observation history) ─────────

/** Below this dHash distance a new still is "the same picture" → skip storing. */
const CAM_PHASH_THRESHOLD = Number(process.env.VOLCANO_CAM_PHASH_THRESHOLD || 4);
/** Mean brightness (0-255) below which a scene counts as night. */
const CAM_NIGHT_LUMA = Number(process.env.VOLCANO_CAM_NIGHT_LUMA || 26);
/** A bright region (0-255) at/above this in a dark frame = incandescence → keep. */
const CAM_GLOW_LUMA = Number(process.env.VOLCANO_CAM_GLOW_LUMA || 90);
/** Keep at most one flat-dark NIGHT frame per camera per this gap (ms), so a
 *  timelapse still spans the day→night→day cycle without hoarding black stills. */
const CAM_NIGHT_GAP_MS = Number(process.env.VOLCANO_CAM_NIGHT_GAP_MS || 3 * 60 * 60 * 1000);
/** Retention window for captured camera frames (days). */
const CAM_RETENTION_DAYS = Number(process.env.VOLCANO_CAM_RETENTION_DAYS || 30);
/** Frames older than this (days) get thinned to a day+night representative/day. */
const CAM_FULLRES_DAYS = Number(process.env.VOLCANO_CAM_FULLRES_DAYS || 3);
/** Max frames folded into one timelapse (thinned evenly, first+last kept). */
const CAM_TIMELAPSE_MAX = Number(process.env.VOLCANO_CAM_TIMELAPSE_MAX || 120);

/**
 * Opt-IN (it fetches + STORES third-party images) and only meaningful when the
 * unified layer is on (frames key on a volcano's WatchedEvent). Env:
 * VOLCANO_CAM_SNAPSHOT_ENABLED=true + EVENTS_UNIFIED_ENABLED=true.
 */
export function volcanoCamSnapshotsEnabled(): boolean {
  return eventsUnifiedEnabled() && process.env.VOLCANO_CAM_SNAPSHOT_ENABLED === "true";
}

/**
 * Dispatched as `volcanoes.snapshotCams`. For every ACTIVE volcano WatchedEvent,
 * grab its official monitoring cameras' current stills and archive one frame per
 * camera per hour to disk (as an EventSnapshot, kind "camera") — building the
 * "earlier today / this week" history the live latest-image can't give.
 *
 * NIGHT HANDLING ("do we need night ones?"): a flat dark night frame with nothing
 * to see is skipped so we don't hoard identical black stills; but a night frame
 * carrying volcanic incandescence has a bright region and is KEPT (the money
 * shot). Unchanged day frames are dropped by perceptual-hash dedup. Bytes on the
 * shared blob FS; the metadata doc is byte-free. Worker-only sharp.
 */
export async function snapshotCams(_job: Job) {
  if (!volcanoCamSnapshotsEnabled()) return { skipped: true };
  const db = await getAppDb();
  try {
    const events = await db.watchedEvents.list({ type: "VOLCANO", status: "ACTIVE" });
    const hourSlot = hourSlotOf(new Date());
    let stored = 0;
    let deduped = 0;
    let darkSkipped = 0;
    let failed = 0;
    for (const ev of events) {
      if (!ev.id) continue;
      // ACTIVE only: a camera an operator switched off (or one the registry lost —
      // e.g. the orphaned INGV archive-frame rows) must never be fetched. Without
      // this the job hammers dozens of dead URLs per volcano every hour.
      const cams = (await db.cams.listForVolcano(ev.primarySourceId)).filter((c) => c.status === "active");
      if (!cams.length) continue;
      const existing = await db.eventSnapshots.listForEvent(ev.id); // desc by capturedAt
      for (const cam of cams) {
        if (!cam.imageUrl) continue;
        let png: Buffer;
        let meta: sharp.Metadata;
        try {
          const res = await fetchWithTimeout(cam.imageUrl);
          if (!res.ok) {
            failed++;
            continue;
          }
          png = await sharp(Buffer.from(await res.arrayBuffer())).png().toBuffer();
          meta = await sharp(png).metadata();
        } catch {
          failed++;
          continue; // unreachable / not a decodable image
        }
        const luma = await frameLuma(png);
        const ph = await pHash(png);
        // `existing` is capturedAt-desc, so the first match is this cam's most recent frame.
        const prior = existing.find((s) => s.kind === "camera" && s.camId === cam.camId);
        if (isDarkFrame(luma, { nightMean: CAM_NIGHT_LUMA, glowMax: CAM_GLOW_LUMA })) {
          // Flat dark night frame (no glow): keep a SPARSE night track so the
          // timelapse spans day→night→day, but don't hoard black — one per gap.
          if (prior && Date.now() - +new Date(prior.capturedAt) < CAM_NIGHT_GAP_MS) {
            darkSkipped++;
            continue;
          }
        } else if (prior?.pHash && hamming(prior.pHash, ph) <= CAM_PHASH_THRESHOLD) {
          deduped++;
          continue; // day/glow frame unchanged since last time
        }
        const attribution = cam.attribution
          ? [cam.attribution.provider, cam.attribution.requiredText].filter(Boolean).join(" · ")
          : undefined;
        await db.eventSnapshots.put({
          eventId: ev.id,
          source: cam.provider,
          kind: "camera",
          layer: cam.camId, // per-cam hourly slot
          hourSlot,
          width: meta.width ?? 0,
          height: meta.height ?? 0,
          observationTime: new Date(),
          png,
          pHash: ph,
          meanLuma: Math.round(luma.mean),
          camId: cam.camId,
          attribution,
        });
        stored++;
      }
    }
    const result = { volcanoes: events.length, stored, deduped, darkSkipped, failed };
    log(TAG, `volcano cam snapshots done`, result);
    blogInfo(TAG, `volcano cam frames: ${stored} stored (${deduped} unchanged, ${darkSkipped} dark)`, result, "volcanoes", "snapshotCams");
    if (stored) emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "volcanoes", count: stored } });
    return result;
  } catch (err) {
    log(TAG, `volcano cam snapshots failed`, summarizeForLog(err));
    blogErr(TAG, `volcano cam snapshot failed`, err, "volcanoes", "snapshotCams");
    throw err;
  }
}

/**
 * Dispatched as `volcanoes.timelapseCams`. Stitch each active volcano camera's
 * archived hourly frames into a short looping WebP and store it as a `render`
 * EventSnapshot (layer `timelapse:<camId>`), refreshed once per day. It rides the
 * same FocusBundle.eventSnapshots + /api/events/snapshot plumbing as everything
 * else — the on-air EventMediaPanel already prefers a `render` hero.
 */
export async function timelapseCams(_job: Job) {
  if (!volcanoCamSnapshotsEnabled()) return { skipped: true };
  const db = await getAppDb();
  try {
    const events = await db.watchedEvents.list({ type: "VOLCANO", status: "ACTIVE" });
    const daySlot = hourSlotOf(new Date()).slice(0, 10); // YYYY-MM-DD, one build/day
    let built = 0;
    let skipped = 0;
    for (const ev of events) {
      if (!ev.id) continue;
      const snaps = await db.eventSnapshots.listForEvent(ev.id);
      const camIds = [...new Set(snaps.filter((s) => s.kind === "camera" && s.camId).map((s) => s.camId!))];
      for (const camId of camIds) {
        // Chronological camera frames for this cam (listForEvent is capturedAt desc).
        const frames = snaps
          .filter((s) => s.kind === "camera" && s.camId === camId)
          .sort((a, b) => +new Date(a.capturedAt) - +new Date(b.capturedAt));
        if (frames.length < 2) {
          skipped++;
          continue;
        }
        const picked = pickEvenly(frames, CAM_TIMELAPSE_MAX);
        const pngs: Buffer[] = [];
        for (const f of picked) {
          const got = await db.eventSnapshots.getPng(f.id);
          if (got) pngs.push(got.data);
        }
        if (pngs.length < 2) {
          skipped++;
          continue;
        }
        const { webp, width, height, frames: n } = await buildTimelapseWebp(pngs);
        await db.eventSnapshots.put({
          eventId: ev.id,
          source: frames[0].source,
          kind: "render",
          layer: `timelapse:${camId}`,
          hourSlot: daySlot,
          width,
          height,
          observationTime: new Date(frames[frames.length - 1].capturedAt),
          png: webp,
          contentType: "image/webp",
          camId,
          attribution: frames[0].attribution,
        });
        built++;
        log(TAG, `volcano timelapse built`, { volcanoId: ev.primarySourceId, camId, frames: n });
      }
    }
    const result = { volcanoes: events.length, built, skipped };
    log(TAG, `volcano timelapses done`, result);
    blogInfo(TAG, `volcano timelapses: ${built} built`, result, "volcanoes", "timelapseCams");
    if (built) emitWorkerEvent({ type: TRACKS_UPDATED, data: { kind: "volcanoes", count: built } });
    return result;
  } catch (err) {
    log(TAG, `volcano timelapses failed`, summarizeForLog(err));
    blogErr(TAG, `volcano timelapse failed`, err, "volcanoes", "timelapseCams");
    throw err;
  }
}

/**
 * Dispatched as `volcanoes.pruneCamSnapshots`. Two stages, both scoped to source
 * "geonet" (so alert-event snapshots keep their own retention):
 *  1. THIN — for each active volcano, keep every recent frame full-resolution but
 *     thin frames older than CAM_FULLRES_DAYS to a DAY + a NIGHT representative per
 *     camera per UTC day (so history stays browsable + the diurnal cycle survives).
 *  2. AGE-PRUNE — drop everything past the retention window entirely.
 * Bytes + metadata both go.
 */
export async function pruneCamSnapshots(_job: Job) {
  const db = await getAppDb();
  try {
    // Stage 1 — day/night thinning of the older frames.
    const events = await db.watchedEvents.list({ type: "VOLCANO", status: "ACTIVE" });
    const fullResUntilMs = Date.now() - CAM_FULLRES_DAYS * 86_400_000;
    let thinned = 0;
    for (const ev of events) {
      if (!ev.id) continue;
      const snaps = await db.eventSnapshots.listForEvent(ev.id);
      const doomed = planCamThinning(
        snaps.map((s) => ({ id: s.id, camId: s.camId, capturedAt: s.capturedAt, meanLuma: s.meanLuma, kind: s.kind })),
        { fullResUntilMs, nightMean: CAM_NIGHT_LUMA },
      );
      if (doomed.length) thinned += (await db.eventSnapshots.deleteMany(doomed)).removed;
    }

    // Stage 2 — hard age-prune past the retention window.
    const cutoff = new Date(Date.now() - CAM_RETENTION_DAYS * 86_400_000);
    const { removed } = await db.eventSnapshots.pruneOlderThanForSource(cutoff, "geonet");

    const result = { thinned, removed, fullResDays: CAM_FULLRES_DAYS, retentionDays: CAM_RETENTION_DAYS };
    log(TAG, `volcano cam prune done`, result);
    if (thinned || removed) {
      blogInfo(TAG, `volcano cam prune: ${thinned} thinned, ${removed} aged out`, result, "volcanoes", "pruneCamSnapshots");
    }
    return result;
  } catch (err) {
    log(TAG, `volcano cam prune failed`, summarizeForLog(err));
    blogErr(TAG, `volcano cam prune failed`, err, "volcanoes", "pruneCamSnapshots");
    throw err;
  }
}
