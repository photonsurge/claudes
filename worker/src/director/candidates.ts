/**
 * Build the scored candidate pool the director picks from each cut. Live events
 * (earthquakes, severe-weather alerts, notable flights/ships) come from the same
 * Mongo caches the public overlays read; curated establishing shots (the intro
 * opener + recurring global/ocean spins + country spotlights) are always added as
 * filler so the channel never runs out of somewhere to look.
 *
 * Pure-ish: takes a DB facade + config, returns Candidates. Scoring lives here
 * so "what's newsworthy" is one readable place to tune.
 */
import type { AppDb } from "@photonsurge/shared/db/index";
import {
  kindHoldMs,
  type DirectorConfig,
  type Segment,
  type SegmentKind,
  type TrackInfo,
} from "@photonsurge/shared/director";
import { DEFAULT_DIRECTOR_POOLS } from "@photonsurge/shared/director-tuning";
import { coarseGeoCell, type Candidate } from "@photonsurge/shared/director-select";
import { vehicleId, vehicleLabel, type iVehicle } from "@photonsurge/shared/db/vehicle-model";
import {
  GLOBAL_VIEW,
  OCEAN_VIEW_ZOOM,
  globalMapTour,
  orbitalViewZoom,
  ORBITAL_VIEWS,
} from "@photonsurge/shared/director-rois";
import { COUNTRY_SHOTS, countryShot } from "@photonsurge/shared/director-countries";
import { REGION_SHOTS, regionShot } from "@photonsurge/shared/director-regions";
import { adMediaPath } from "@photonsurge/shared/ads/types";
import { alertRepPoint } from "@photonsurge/shared/alerts/geo";
import { alertCountryCode } from "@photonsurge/shared/alerts/country";
import { quakeLiveWindowSince } from "@photonsurge/shared/seismic";
import { mmsiCountry, countryNameFlag } from "@photonsurge/shared/tracks/flags";
import { ROUNDUP_ID_FOR_PERIOD } from "@photonsurge/shared/roundup-settings";
import { roundupStaleAfterMs } from "@photonsurge/shared/roundup-schedule";
import { tleGroups } from "../jobs/tracks";
import { cachedRoundupSettings } from "../lib/roundupSettings";
import {
  make,
  countryCandidate,
  regionCandidate,
  summaryCandidate,
  quakeCandidate,
  volcanoCandidate,
  stormCandidate,
  worldSpinCandidate,
  SUMMARY_PERIODS,
} from "./builders";

// The single-item builders live in ./builders; re-exported so existing
// importers of this module keep working.
export {
  countryCandidate,
  regionCandidate,
  summaryCandidate,
  quakeCandidate,
  volcanoCandidate,
  stormCandidate,
  summaryTourHoldMs,
  pointCandidate,
  latestWorldRoundup,
} from "./builders";

type Detail = { label: string; value: string };

/*
 * Pool numbers come from the channel's config (`pools`, shared/director-tuning),
 * defaults unchanged:
 *  - `notableBoost` / `vipBoost` (45 / 80): score for the two tiers of
 *    catalogued craft — a plain notable clears the fillers, a VIP (Air Force
 *    One) tops them, both below severe-weather/quake headlines.
 *  - `alertPoolCap` (40): how many severe-weather candidates the storm pool holds.
 *  - `alertCountryCap` (3): per-country storm-candidate cap. `db.alerts.list`
 *    ranks by severity then recency GLOBALLY, so one prolific met service can
 *    outnumber the whole pool by itself (live incident: Kazhydromet ran 66
 *    simultaneous sev-4 warnings — the top-40 slice came back 36× Kazakhstan).
 *    Walking the ranked list and keeping at most this many per country
 *    preserves "biggest stories first" while letting the rest of the world on air.
 */

/** How deep into the globally severity-ranked alert list we scan to fill the
 *  storm pool. A query guard, not programme policy, so it stays a constant. */
const ALERT_SCAN_LIMIT = 300;

/** The default per-country storm cap (`pools.alertCountryCap`), for callers
 *  without a channel config (scripted-short templates). */
export const ALERT_COUNTRY_CAP = DEFAULT_DIRECTOR_POOLS.alertCountryCap;

/**
 * Merge a notable catalog entry with the live meta into the on-air TrackInfo card
 * payload. Operator overrides win; catalog values win over live gap-fills.
 */
function notableTrackInfo(
  n: iVehicle,
  live: { type?: string; operator?: string; registration?: string; flag?: string; country?: string },
): TrackInfo {
  const override = n.photoUrlOverride?.trim();
  return {
    label: vehicleLabel(n),
    category: n.category,
    photoUrl: override || n.photoUrl,
    photoCredit: override ? undefined : n.photoCredit,
    photoLink: override ? undefined : n.photoLink,
    manufacturer: n.manufacturer,
    type: n.type || live.type,
    operator: n.operator || live.operator,
    registration: n.registration || live.registration,
    flag: n.flag || live.flag,
    country: n.country || live.country,
    extract: n.blurbOverride?.trim() || n.wikiExtract,
    notable: true,
    vip: Boolean(n.vip),
  };
}

/**
 * Curated filler: the one-time intro opener + the recurring global spin (same
 * world map-type tour) + the ocean spin + operator-favourite country spotlights.
 */
function fillerCandidates(cfg: DirectorConfig): Candidate[] {
  const out: Candidate[] = [];
  if (cfg.kinds.intro) {
    // The session opener — selectNext only airs it on the very first cut, then
    // retires it (see director-select). Still built every tick so that cut has it.
    out.push({
      score: 6,
      segment: make("intro", "global", "Global Weather", undefined, GLOBAL_VIEW.center, GLOBAL_VIEW.zoom, kindHoldMs(cfg, "intro"), cfg),
    });
  }
  if (cfg.kinds.global) out.push(worldSpinCandidate(cfg));
  if (cfg.kinds.ocean) {
    // One global ocean spin that TOURS the ingested ocean fields (SST → swell →
    // salinity) within the shot, instead of a separate cut per field. It opens on
    // the first map type (SST); the client (useDirectorCut) rotates + relabels the
    // rest on the spin clock and drops any field that isn't ingested.
    out.push({
      score: 6,
      segment: make(
        "ocean",
        "world",
        "Ocean Conditions",
        "Sea surface & swell",
        GLOBAL_VIEW.center,
        OCEAN_VIEW_ZOOM,
        kindHoldMs(cfg, "ocean"),
        cfg,
        { activeVariable: globalMapTour("ocean", cfg.mapTypes.ocean)?.[0]?.patch.activeVariable ?? "sst" },
      ),
    });
  }
  if (cfg.kinds.orbital) {
    // Only air constellations whose TLEs the worker actually ingests
    // (SATELLITE_GROUPS), so an orbital shot is never empty.
    const ingested = new Set(tleGroups());
    for (const view of ORBITAL_VIEWS) {
      if (!ingested.has(view.group)) continue;
      out.push({
        score: 6,
        segment: make(
          "orbital",
          view.group,
          view.title,
          view.subtitle,
          GLOBAL_VIEW.center,
          orbitalViewZoom(view),
          kindHoldMs(cfg, "orbital"),
          cfg,
          { satelliteGroup: view.group },
        ),
      });
    }
  }
  // Country ("national") + Region ("area") spotlights both need a DB read now —
  // their tour stops come from the precomputed city dossiers — so they're built
  // in the async countryCandidates / regionCandidates below, not here.
  return out;
}

/**
 * Operator-favourite country spotlights — one countryCandidate per curated
 * shot. Unknown ids (stale config) are skipped. Mirrors regionCandidates.
 */
async function countryCandidates(db: AppDb, cfg: DirectorConfig): Promise<Candidate[]> {
  if (!cfg.kinds.country) return [];
  const out: Candidate[] = [];
  for (const id of COUNTRY_SHOTS.map((shot) => shot.id)) {
    const shot = countryShot(id);
    if (!shot) continue;
    out.push(await countryCandidate(db, shot, cfg));
  }
  return out;
}

/**
 * Operator-favourite Areas — one regionCandidate per curated shot. Unknown ids
 * are skipped.
 */
async function regionCandidates(db: AppDb, cfg: DirectorConfig): Promise<Candidate[]> {
  if (!cfg.kinds.region) return [];
  const out: Candidate[] = [];
  const regionIds = REGION_SHOTS.map((r) => r.id);
  for (const id of regionIds) {
    const r = regionShot(id);
    if (!r) continue;
    out.push(await regionCandidate(db, r, cfg));
  }
  return out;
}

/**
 * Build a full-frame ad interstitial, or null when no active ad exists. Unlike
 * the other kinds this doesn't go through the scored pool — the loop injects it
 * on a fixed cadence (adEveryNShots), so we pick the ad here directly, rotating
 * through every active ad before any repeats. The globe is covered by the ad
 * card, so the camera just holds where the previous shot left it and no layers
 * change.
 */
export async function buildAdSegment(
  db: AppDb,
  cfg: DirectorConfig,
  prevCamera?: Segment["camera"],
  excludeAdId?: string,
): Promise<Segment | null> {
  const ad = await db.ads.pickForAir(undefined, excludeAdId);
  if (!ad) return null;
  const camera = prevCamera ?? { center: GLOBAL_VIEW.center, zoom: GLOBAL_VIEW.zoom };
  return {
    id: `ad:${ad.adId}`,
    kind: "ad",
    title: ad.title,
    subtitle: ad.advertiser,
    camera,
    patch: { camera },
    holdMs: kindHoldMs(cfg, "ad"),
    ad: {
      adId: ad.adId,
      title: ad.title,
      mediaType: ad.mediaType,
      mediaUrl: adMediaPath(ad.adId, ad.updatedAt),
      advertiser: ad.advertiser,
      clickUrl: ad.clickUrl,
    },
  };
}

/**
 * One round-up candidate per period whose latest EventSummary has a real
 * narrative (see summaryCandidate), hasn't already aired this session
 * (`seenCounts`), and isn't stale (the director was off for a while and the
 * round-up is no longer "current"). Exported for the script resolver's
 * `global:roundup` target, which applies the same rules.
 */
export async function summaryCandidates(
  db: AppDb,
  cfg: DirectorConfig,
  seenCounts?: Map<string, number>,
  now: number = Date.now(),
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  // Stale-after follows the operator's slots (3 gaps), so a thinned schedule
  // keeps its round-up on air between slots instead of blanking it.
  const settings = await cachedRoundupSettings(db);
  for (const { period, staleAfterMs } of SUMMARY_PERIODS) {
    let doc;
    try {
      doc = await db.eventSummaries.latest(period);
    } catch {
      continue; // not ingested yet — skip
    }
    if (!doc) continue;
    const id = `global:${doc.id}`;
    if (seenCounts?.get(id)) continue; // already aired this session
    const maxAge = roundupStaleAfterMs(settings[ROUNDUP_ID_FOR_PERIOD[period]], staleAfterMs);
    if (now - new Date(doc.generatedAt).getTime() > maxAge) continue;
    const cand = summaryCandidate(doc, period, cfg);
    if (cand) out.push(cand);
  }
  return out;
}


export interface BuildCandidatesOpts {
  /** Only build these kinds (still subject to the channel's own `kinds`), so a
   *  "show me a quake" request doesn't scan everything. */
  kinds?: readonly SegmentKind[];
}

export async function buildCandidates(
  db: AppDb,
  channelCfg: DirectorConfig,
  seenCounts?: Map<string, number>,
  opts?: BuildCandidatesOpts,
): Promise<Candidate[]> {
  const only = opts?.kinds ? new Set(opts.kinds) : null;
  const cfg: DirectorConfig = only
    ? {
        ...channelCfg,
        kinds: Object.fromEntries(
          Object.entries(channelCfg.kinds).map(([k, on]) => [k, on && only.has(k as SegmentKind)]),
        ) as DirectorConfig["kinds"],
      }
    : channelCfg;
  const pool: Candidate[] = fillerCandidates(cfg);
  const now = Date.now();
  // Round-ups ride the recurring global spin, so they only make sense when the
  // `global` kind is airing at all.
  if (cfg.kinds.global) pool.push(...(await summaryCandidates(db, cfg, seenCounts)));

  // Country spotlights (national tours) + Areas (region tours) — each favourite
  // flies round its precomputed biggest cities.
  pool.push(...(await countryCandidates(db, cfg)));
  pool.push(...(await regionCandidates(db, cfg)));

  // Notable-tracks catalog (enabled) — matched by `${kind}:${code}` to boost the
  // genuinely interesting craft onto air and hang the on-air Track Info card off
  // them. Loaded once; only when a track kind is eligible so we skip the query.
  let notableByKey = new Map<string, iVehicle>();
  if (cfg.kinds.flight || cfg.kinds.ship) {
    const cat = await db.vehicles.notableCatalog();
    notableByKey = new Map(cat.map((n) => [vehicleId(n.kind, n.code), n]));
  }

  // --- Earthquakes: magnitude is the headline; recent + big ranks highest. ---
  if (cfg.kinds.quake) {
    try {
      // Same window the globe overlay draws (shared/seismic). A quake the
      // overlay has aged out must not stay cuttable, or the show pans to an
      // empty patch of ocean and talks about a ring that isn't there.
      const quakes = await db.quakes.list({
        minMag: cfg.minQuakeMag,
        limit: 40,
        sinceMs: quakeLiveWindowSince(now),
      });
      for (const q of quakes) pool.push(quakeCandidate(q, cfg, now));
    } catch {
      /* no quakes cached yet — fillers carry the show */
    }
  }

  // --- Volcanoes: erupting/unrest only; dormant carries no headline. ---
  if (cfg.kinds.volcano) {
    try {
      for (const v of await db.volcanoes.list()) {
        const cand = volcanoCandidate(v, cfg, now);
        if (cand) pool.push(cand);
      }
    } catch {
      /* no volcanoes cached yet — fillers carry the show */
    }
  }

  // --- Ocean monitoring points: DB-backed catalog (currents/features plus
  // real depth-monitoring regions — Niño boxes, Atlantic MDR, North Sea, Med,
  // Indian Ocean Dipole). Same "ocean" kind, fair-rotated alongside the global
  // spin filler above, but holding steady (autoSpin off, or a slow drift for
  // depth-cycle shots) so a real, specific location is on camera instead of
  // wherever the spin happened to drift to (the sea-temp-at-depth
  // profile/map need an actual ocean point). Managed at /admin/sea-points —
  // `enabled: false` points are simply skipped, no favourites list needed. ---
  if (cfg.kinds.ocean) {
    try {
      const seaPoints = (await db.seaPoints.list()).filter((p) => p.enabled);
      for (const p of seaPoints) {
        const patch = p.depthCycle
          ? { activeVariable: "sst", autoSpin: true, spinSpeed: 2.5 }
          : { activeVariable: "sst", autoSpin: false };
        const seg = make("ocean", p.pointId, p.name, `Ocean temperature · ${p.blurb}`, [p.lng, p.lat], p.zoom, kindHoldMs(cfg, "ocean"), cfg, patch);
        seg.depthCycle = p.depthCycle;
        pool.push({ score: 6, segment: seg });
      }
    } catch {
      /* no sea points seeded yet — fillers carry the show */
    }
  }

  // --- Severe weather: normalised severity ranks; centroid from the polygon.
  //     Scanned deep but capped per country (pools.alertCountryCap) so the pool
  //     spans the world's active warnings, not one chatty source's. ---
  if (cfg.kinds.storm) {
    try {
      const alerts = await db.alerts.list({ activeOnly: true, severityMin: cfg.minAlertSeverity, limit: ALERT_SCAN_LIMIT });
      const perCountry = new Map<string, number>();
      let stormCount = 0;
      for (const a of alerts as any[]) {
        if (stormCount >= cfg.pools.alertPoolCap) break;
        const info = Array.isArray(a.info) ? a.info[0] : undefined;
        const area = info?.area?.[0];
        const center = alertRepPoint(area?.geometry);
        if (!center) continue; // geocode-only alert (no polygon) — can't frame it
        // Country is the editorial area for alert rotation AND the pool cap. A
        // numeric camera distance alone is too weak here: large countries
        // (notably Kazakhstan) can have alerts many degrees apart while still
        // looking like the same repeated destination on air. Alerts whose
        // source encodes no country bucket by the selector's own coarse cell so
        // an undecodable source can't flood the pool either.
        const countryCode = alertCountryCode(a);
        const capKey = countryCode ? `country:${countryCode}` : coarseGeoCell(center) ?? "cell:unknown";
        const used = perCountry.get(capKey) ?? 0;
        if (used >= cfg.pools.alertCountryCap) continue;
        const cand = stormCandidate(a, info, area, cfg, now);
        if (!cand) continue;
        perCountry.set(capKey, used + 1);
        stormCount += 1;
        pool.push(cand);
      }
    } catch {
      /* alerts not ingested — skip */
    }
  }

  // --- Notable aircraft: ONLY craft matching the enriched catalog (any altitude —
  //     a VIP on approach still counts). Every flight segment therefore carries a
  //     Track Info card; plain unenriched blips never make the pool. ---
  if (cfg.kinds.flight) {
    try {
      const { rows } = await db.trackSnapshots.latest({ kind: "aircraft" });
      const chosen = rows.filter((r) => notableByKey.has(vehicleId("aircraft", r.externalId)));
      // Join the cached hexdb metadata (registration/type/operator) by ICAO24 —
      // same lookup the public aircraft route uses, keyed by lowercase hex.
      const icaos = [...new Set(chosen.map((r) => r.externalId.toLowerCase()))];
      const metaRes = icaos.length
        ? await db.aircraftMeta.getAll({ id: { $in: icaos } }, { limit: icaos.length, sort: null })
        : { data: [] };
      const metaById = new Map((metaRes.data ?? []).map((m) => [m.id, m]));
      for (const r of chosen) {
        const notable = notableByKey.get(vehicleId("aircraft", r.externalId))!;
        const name = vehicleLabel(notable);
        const hasAlt = typeof r.altM === "number";
        const altKft = hasAlt ? Math.round(((r.altM as number) * 3.281) / 100) / 10 : 0;
        const m = metaById.get(r.externalId.toLowerCase());
        // Flag from OpenSky origin_country; lead the subtitle with it when known.
        const flag = countryNameFlag(r.country);
        const subtitle = `${flag ? `${flag} ` : ""}Aircraft${hasAlt ? ` · FL${Math.round(altKft * 10)}` : ""}`;
        const seg = make("flight", r.externalId, name, subtitle, [r.lng, r.lat], 6, kindHoldMs(cfg, "flight"), cfg);
        const details: Detail[] = [];
        if (m?.type) details.push({ label: "Type", value: m.type });
        if (m?.operator) details.push({ label: "Operator", value: m.operator });
        if (m?.registration) details.push({ label: "Registration", value: m.registration });
        if (r.country) details.push({ label: "Origin", value: `${flag ? `${flag} ` : ""}${r.country}` });
        if (hasAlt) details.push({ label: "Altitude", value: `FL${Math.round(altKft * 10)} · ${Math.round(r.altM as number).toLocaleString()} m` });
        if (typeof r.speed === "number") {
          const kt = Math.round((r.speed as number) * 1.94384);
          details.push({ label: "Speed", value: `${kt} kn · ${Math.round(kt * 1.852)} km/h` });
        }
        if (typeof r.headingDeg === "number") details.push({ label: "Heading", value: `${Math.round(r.headingDeg)}°` });
        // Climb/descent — only when it's meaningfully off level (~100 fpm), rounded
        // to the nearest 50 fpm so a live jitter doesn't read as spurious precision.
        if (typeof r.verticalRateMS === "number" && Math.abs(r.verticalRateMS) >= 0.5) {
          const fpm = Math.round((Math.abs(r.verticalRateMS as number) * 196.85) / 50) * 50;
          const climbing = (r.verticalRateMS as number) > 0;
          details.push({ label: "Vert. rate", value: `${climbing ? "▲" : "▼"} ${fpm.toLocaleString()} fpm` });
        }
        // Live ADS-B callsign (e.g. flight number) — distinct from the catalog name.
        const call = r.name?.trim();
        if (call && call.toUpperCase() !== name.toUpperCase()) details.push({ label: "Callsign", value: call });
        seg.details = details;
        seg.trackInfo = notableTrackInfo(notable, { type: m?.type, operator: m?.operator, registration: m?.registration, flag, country: r.country });
        pool.push({ score: notable.vip ? cfg.pools.vipBoost : cfg.pools.notableBoost, segment: seg });
      }
    } catch {
      /* no aircraft frame — skip */
    }
  }

  // --- Notable ships: ONLY vessels matching the enriched catalog (any speed).
  //     Every ship segment therefore carries a Track Info card; plain unenriched
  //     AIS blips never make the pool. ---
  if (cfg.kinds.ship) {
    try {
      const { rows } = await db.trackSnapshots.latest({ kind: "ship" });
      const chosen = rows.filter((r) => notableByKey.has(vehicleId("ship", r.externalId)));
      for (const r of chosen) {
        const notable = notableByKey.get(vehicleId("ship", r.externalId))!;
        // Flag country from the MMSI MID (first 3 digits) — no feed call needed.
        const country = mmsiCountry(r.externalId);
        const name = vehicleLabel(notable);
        const spd = typeof r.speed === "number" ? Math.round(r.speed) : undefined;
        const subtitle = `${country?.flag ? `${country.flag} ` : ""}Vessel${spd != null ? ` · ${spd} kn` : ""}`;
        const seg = make("ship", r.externalId, name, subtitle, [r.lng, r.lat], 6.5, kindHoldMs(cfg, "ship"), cfg);
        const details: Detail[] = [];
        if (spd != null) details.push({ label: "Speed", value: `${spd} kn` });
        if (typeof r.headingDeg === "number") details.push({ label: "Course", value: `${Math.round(r.headingDeg)}°` });
        if (country) details.push({ label: "Flag", value: `${country.flag ? `${country.flag} ` : ""}${country.name}` });
        details.push({ label: "MMSI", value: r.externalId });
        seg.details = details;
        seg.trackInfo = notableTrackInfo(notable, { flag: country?.flag, country: country?.name });
        pool.push({ score: notable.vip ? cfg.pools.vipBoost : cfg.pools.notableBoost, segment: seg });
      }
    } catch {
      /* no ship frame — skip */
    }
  }

  return pool;
}
