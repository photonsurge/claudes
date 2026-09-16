/**
 * Auto-director contract — shared by the worker (which runs the director loop),
 * /watch (which cuts to each segment) and /control (which configures it).
 *
 * The director is a "robot operator": each tick it scores live events (severe
 * weather, big quakes, notable flights/ships) plus curated establishing shots,
 * picks the next Segment, and pushes a DirectorState over the socket. A Segment
 * carries a ControlState `patch` (camera + layer preset) which /watch applies
 * exactly like an operator's CONTROL_STATE — so no new rendering is needed, the
 * globe just flies and toggles layers. The `segment` metadata (title/kind/up
 * next/countdown) drives the operator override panel and the on-air graphics.
 *
 * DirectorConfig is the operator's durable control surface: persisted to Mongo
 * by /control via /api/director/config and read by the worker each tick. Same
 * cold-start-from-Mongo pattern as the broadcast ControlState.
 */
import type { ControlState, WindSettings } from "./control";
import { DEFAULT_WIND_SETTINGS, WIND_PRESETS } from "./control";
import type { HazardType } from "./alerts/hazard";
import type { AdMediaType } from "./ads/types";
import type { SummaryPeriod, iSummaryStats } from "./db/event-summary-model";
import type { SeverityRank } from "./db/alert-model";
import { DEFAULT_DIRECTOR_COUNTRIES, sanitizeDirectorCountries } from "./director-countries";
import { DEFAULT_DIRECTOR_REGIONS, sanitizeDirectorRegions } from "./director-regions";
import { isSatImgLook, SATIMG_FEEDS, type SatImgFeedState } from "./satimg/types";
import { QUAKE_MAGNITUDE_BANDS, quakeMagnitudeClass, type QuakeMagnitudeClass } from "./seismic";
import type { VolcanoStatus } from "./volcanoes/types";
// Value import (not just a type) — safe despite director-rois.ts importing
// SegmentKind back from here, since that reverse import is `import type`
// (erased at runtime), so there's no actual circular runtime dependency.
import { OVERLAY_KEYS } from "./director-rois";

/** Socket event: worker → every browser. The current on-air segment + queue. */
export const DIRECTOR_STATE = "director:state" as const;

/** What kind of thing a segment is showing — also the OBS-scene key (phase 2). */
export type SegmentKind =
  | "intro" // one-time session opener — the establishing world spin, shown once at the top of a session
  | "global" // the recurring world spin (same map-type tour as the intro), aired as ordinary global filler
  | "ocean" // global spin coloured by an ocean field (SST / waves)
  | "country" // an operator-favourited country spotlight (national weather check)
  | "region" // an operator-favourited region/area spotlight (regional weather check) — the Region catalog cousin of `country`
  | "point" // a manually-clicked map point (the /sandbox inspector) — NOT director-scheduled, see SEGMENT_KINDS
  | "storm" // a severe-weather alert area
  | "volcano" // an erupting or unrest volcano (Smithsonian/USGS bulletin)
  | "quake" // a recent significant earthquake
  | "flight" // a notable aircraft
  | "ship" // a notable vessel
  | "orbital" // a satellite constellation's orbits, spun on a world view
  | "ad"; // a full-frame advertisement interstitial (a "commercial break")

/**
 * The kinds the auto-director can schedule (drives the operator's per-kind
 * enable/hold/look UI). Deliberately a SUBSET of `SegmentKind`: `point` is a
 * segment the /sandbox inspector produces on a map click, not a director mode,
 * so it is omitted here and never appears as an operator toggle or candidate.
 */
export const SEGMENT_KINDS: SegmentKind[] = [
  "intro",
  "global",
  "ocean",
  "orbital",
  "country",
  "region",
  "storm",
  "volcano",
  "quake",
  "flight",
  "ship",
  "ad",
];

export interface DirectorCamera {
  /** [lng, lat] */
  center: [number, number];
  zoom: number;
}

/**
 * The focus subject a segment id carries: everything after its kind. The
 * subject itself can contain colons — a storm id is `storm:<source>:<identifier>`
 * and a volcano id `volcano:gvp:211060` — so split on the FIRST colon only.
 * `split(":")[1]` handed the focus composer the SOURCE ("meteoalarm") or "gvp"
 * as the subject, and the storm / volcano target never resolved.
 * Null for an id with no subject part.
 */
export function focusSubjectOf(segmentId: string): string | null {
  const i = segmentId.indexOf(":");
  return i === -1 ? null : segmentId.slice(i + 1) || null;
}

/** A storm subject split back into its alert key, or null for a bare id. */
export function splitAlertSubject(subject: string): { source: string; identifier: string } | null {
  const i = subject.indexOf(":");
  return i > 0 ? { source: subject.slice(0, i), identifier: subject.slice(i + 1) } : null;
}

/**
 * One on-air beat. `patch` is merged onto /watch's ControlState (camera + layer
 * toggles) the instant the segment goes live; `id` is stable per subject so the
 * selector can apply a cooldown and not show the same quake twice in a row.
 */
export interface Segment {
  /** Stable id, e.g. "quake:us7000abcd" or "country:japan". */
  id: string;
  kind: SegmentKind;
  /** Big on-air label, e.g. "Severe Storm". */
  title: string;
  /** Optional emoji shown before the title (e.g. the hazard glyph 🔥 for a storm). */
  icon?: string;
  /** Smaller context line, e.g. "Gulf of Mexico · Hurricane Warning". */
  subtitle?: string;
  /**
   * For `ocean` segments: true when this shot is a monitoring-region
   * depth-cycle scene (Niño boxes, Atlantic MDR, North Sea, Med, IOD) — the
   * client cycles sst→sst100→sst500→sst2000→sst5000 instead of the normal
   * ocean field tour. See `cutSteps` in `public/src/lib/director.ts`.
   */
  depthCycle?: boolean;
  camera: DirectorCamera;
  /** ControlState fields to assert while this segment is on air. */
  patch: Partial<ControlState>;
  /** How long to hold this shot, in ms. */
  holdMs: number;
  /**
   * For `storm` segments: the classified hazard behind the alert. Drives the
   * per-hazard map plan (which fields cycle + how long) via hazardMapPlan — a
   * heat warning reads through humidity/temp, a tornado through CAPE/radar/gust.
   */
  hazard?: HazardType;
  /**
   * For `quake` segments: the USGS tsunami flag. When set, the shot reads the
   * ocean story (sst → wave) instead of the neutral land backdrop (temp → sst) —
   * see quakeMapPlan. No weather field is meteorologically relevant to a quake,
   * so the map is a backdrop, never a forecast.
   */
  tsunami?: boolean;
  /**
   * For `quake` segments: the raw seismic numbers behind the card, carried so the
   * on-air + operator QuakeReport panels can classify magnitude/depth and frame
   * the nearest cities without re-fetching or string-parsing the detail rows.
   */
  quake?: { mag: number; depthKm: number };
  /** Kind-specific detail rows for the operator info box (severity, depth, …). */
  details?: { label: string; value: string }[];
  /**
   * For `flight`/`ship` segments: rich identity for the on-air Track Info card —
   * photo + story + type/operator. Present when the craft matched the notable
   * catalog (photo/story) or the aircraftMeta cache (type/operator). Rides on the
   * segment, so it reaches /watch over the existing director socket with no extra
   * plumbing. See TrackInfo.
   */
  trackInfo?: TrackInfo;
  /**
   * For `ad` segments: the advertisement to display full-frame. Rides on the
   * segment (like trackInfo) so /watch renders the ad interstitial straight from
   * the director cut — no ad fetch on the client. See SegmentAd.
   */
  ad?: SegmentAd;
  /**
   * The generated round-up narrative a world spin presents. When set on a
   * `global` spin (see worker/src/director/candidates.ts `summaryCandidates`)
   * the spin BECOMES the round-up: it tours the round-up's hotspot `stops` and
   * shows the narrative + stats as on-air graphics, instead of the plain
   * map-type cycle. Rides on the segment (like `ad`) so /watch renders it
   * straight from the director cut — no extra fetch. See SegmentSummary.
   */
  summary?: SegmentSummary;
  /**
   * The camera stops an Areas (`region`) shot tours — the "go round a place"
   * flythrough. The worker populates them from the region's biggest cities —
   * the curated `topCities` dossier, scoped to its member countries (see
   * worker/src/director/candidates.ts `regionCandidates`) — so the client flies
   * the camera to each in turn and captions it, glowing whichever country the
   * stop lands in (a UK area tours UK cities, never a neighbour). Empty/absent when
   * the area has no populated cities — the shot then falls back to a single
   * framed spotlight. Kept separate from `summary` (which is round-up prose): a
   * region tour carries places, not a narrative. See cutSteps in the client.
   */
  tourStops?: SegmentSummaryStop[];
}

/**
 * The advertisement a full-frame `ad` interstitial shows, attached to its
 * segment by the worker. `mediaUrl` is the ready-to-use, cache-busted serve URL
 * (`/api/ads/<id>/media?v=…`) so the client just drops it into an <img>/<video>.
 */
export interface SegmentAd {
  adId: string;
  title: string;
  mediaType: AdMediaType;
  mediaUrl: string;
  advertiser?: string;
  clickUrl?: string;
}

/**
 * The round-up narrative a `global` spin presents, attached to its segment
 * by the worker (see worker/src/director/candidates.ts `summaryCandidates`).
 * `id` is the source EventSummary doc id — used to avoid re-airing the same
 * round-up twice in a session.
 */
export interface SegmentSummary {
  id: string;
  period: SummaryPeriod;
  narrative: string;
  /** ISO timestamp the round-up was generated. */
  generatedAt: string;
  /**
   * Places the round-up touches on, in narrative order — the client flies the
   * camera to each in turn and shows a small info card (place/hazard/severity)
   * alongside the ticker. Empty when the round-up's stats/topEvents carried no
   * coordinates (camera stays on the global view).
   */
  stops?: SegmentSummaryStop[];
  /** Headline numbers behind the narrative (active alerts, quake count/max
   *  magnitude, cyclones, notable tracks) — the same tally shown on
   *  /admin/summaries, surfaced on-air alongside the narrative. */
  stats?: iSummaryStats;
  /** Adapter/source provenance for this round-up, e.g. ["nws","meteoalarm"]. */
  sources?: string[];
}

/**
 * One camera stop within a tour — a round-up spin's hotspot (from the
 * EventSummary doc's `hotspots`/`topEvents`, see `summaryCandidates`) OR an
 * Areas tour's city (from the region's curated, member-country-scoped biggest
 * cities, see `regionCandidates`). Drives both the camera fly-to and the on-air
 * info card.
 */
export interface SegmentSummaryStop {
  /** Place/cluster label, e.g. "Southern Europe" or a city name. */
  label: string;
  /** Secondary line, e.g. hazard type/event count, or a city's country. */
  subtitle?: string;
  lng: number;
  lat: number;
  /** Hazard severity for an event stop; omitted for a plain place (a city). */
  severity?: SeverityRank;
  /**
   * ISO-3166 alpha-2 of the country this stop sits in — set on an Areas
   * (`region`) tour so the globe glows the exact country under the stop
   * (`activeCountryIso`), including countries outside the curated `country`
   * catalog. Absent on round-up hotspots (which glow via the curated lookup).
   */
  iso2?: string;
  /**
   * Zoom the camera flies to for this stop, overriding the default tour stop
   * zoom (`SUMMARY_STOP_ZOOM`). A `country` tour uses it to open on a WIDE
   * establishing "middle of the country" stop before zooming into the city
   * stops (see worker `countryTourStops`); region/round-up stops leave it unset.
   */
  zoom?: number;
}

/**
 * Rich on-air identity for an aircraft/ship, attached to its segment. Everything
 * optional — a craft with no catalog match still carries whatever the live snapshot
 * + aircraftMeta cache know. `notable`/`vip` drive on-air emphasis (a VIP such as
 * Air Force One is the top tier).
 */
export interface TrackInfo {
  /** Catalog display name, e.g. "Air Force One". */
  label?: string;
  /** Catalog grouping, e.g. "government" | "research" | "cruise". */
  category?: string;
  /** Photo URL (planespotters airframe shot, else the Wikipedia lead image). */
  photoUrl?: string;
  /** Photographer credit (planespotters requires attribution). */
  photoCredit?: string;
  /** Link back to the photo page. */
  photoLink?: string;
  /** Aircraft type / vessel type, e.g. "Boeing VC-25A". */
  type?: string;
  /** Builder, e.g. "Boeing" or the shipyard — shown only when distinct from `type`. */
  manufacturer?: string;
  operator?: string;
  registration?: string;
  flag?: string;
  country?: string;
  /** Short Wikipedia blurb. */
  extract?: string;
  /** Matched the curated notable-tracks catalog. */
  notable?: boolean;
  /** Top-tier VIP (e.g. Air Force One). */
  vip?: boolean;
  /** Volcano-only: a few extra photos for a second-slide gallery strip. */
  gallery?: string[];
  /** Volcano-only: "stratovolcano · 3,357 m · last known eruption 2021" — pre-joined so the panel stays generic. */
  facts?: string;
  /** Volcano-only: USGS VONA near-real-time alert (only set for the US-monitored subset). */
  alert?: { level?: string; colorCode?: string; synopsis?: string; noticeUrl?: string; updatedAt?: number };
  /** Volcano-only: LLM-parsed facts from this week's bulletin, e.g. "VEI 2 · plume 3,000 m". */
  reportFacts?: string;
  /** Volcano-only: status + report date range + how long the status has held, pre-joined,
   *  e.g. "Erupting · report 25 Jun-1 Jul 2026 · status held 6d 4h". */
  statusLine?: string;
  /** Volcano-only: link to the Smithsonian GVP volcano page. */
  sourceUrl?: string;
}

/**
 * Live director state pushed to /watch. Emitted on every cut and on a heartbeat
 * (same `seq`) so a freshly-loaded /watch can join mid-segment. /watch only
 * flies the camera when `seq` changes — heartbeats just refresh the countdown.
 */
export interface DirectorState {
  /** Which scene/output this director drives (matches a scene / /watch id). */
  sceneId: string;
  /** Monotonic cut counter. A change means "this is a new shot — fly to it". */
  seq: number;
  /** Whether the director is currently driving (false when mode is "off"). */
  active: boolean;
  segment: Segment | null;
  /** Wall-clock ms when the current segment started / will end. */
  startedAt: number;
  endsAt: number;
  /** The next few queued segments — titles drive the "coming up" rail; the
   *  optional focus params (camera + subject id) let /watch PRE-WARM the focus
   *  bundle for the upcoming cut so its /api/focus fetch is a Redis hit when it
   *  airs (zero-flash). Optional/back-compat: older workers omit them. */
  upNext: {
    kind: SegmentKind;
    title: string;
    /** The segment's locating detail ("M5.6 · Southern Sumatra") so the rail
     *  says WHERE, not just what kind of thing, is coming up. */
    subtitle?: string;
    center?: [number, number];
    zoom?: number;
    subject?: string | null;
  }[];
  /**
   * Wall-clock ms this exact segment last aired earlier in the session, or
   * undefined if it's the first time. Operator-only readout ("last shown 4m
   * ago") to spot a location/mode recurring too often — not shown on /watch.
   */
  lastShownAt?: number;
  /** How many times this exact segment has aired this session (incl. now). */
  timesShown?: number;
}

export type UpNextItem = DirectorState["upNext"][number];

/** One "coming up" line — kind titles alone ("Earthquake") say nothing about
 *  where, so append the locating subtitle whenever the segment carries one. */
export function upNextLabel(u: UpNextItem): string {
  return u.subtitle ? `${u.title} — ${u.subtitle}` : u.title;
}

export type DirectorMode = "off" | "auto";

/**
 * Storm hold levels — one named tier per normalised alert severityRank (0–4),
 * so the operator can dwell on an Extreme warning far longer than a Minor one.
 * Named keys (not the numeric rank) so the Mongo doc reads as prose and can
 * never be mistaken for an array. Strongest first, matching the UI order.
 */
export const STORM_LEVELS = [
  { key: "extreme", rank: 4, label: "Extreme" },
  { key: "severe", rank: 3, label: "Severe" },
  { key: "moderate", rank: 2, label: "Moderate" },
  { key: "minor", rank: 1, label: "Minor" },
  { key: "info", rank: 0, label: "None / info" },
] as const;

export type StormLevel = (typeof STORM_LEVELS)[number]["key"];

/** Bucket a normalised alert severityRank (0–4) into its hold level. */
export function stormLevelForRank(rank: number): StormLevel {
  const hit = STORM_LEVELS.find((l) => rank >= l.rank);
  return (hit ?? STORM_LEVELS[STORM_LEVELS.length - 1]).key;
}

/** Ordered quake hold levels (strongest first) — the magnitude classes on air. */
export const QUAKE_LEVELS: QuakeMagnitudeClass[] = QUAKE_MAGNITUDE_BANDS.map((b) => b.cls);

/**
 * Volcano hold levels — one named tier per schedulable status, strongest
 * first. Unlike storm/quake there's no VEI or other intensity number in the
 * source bulletin, so this tracks the Smithsonian/USGS status directly rather
 * than a numeric band; `dormant` never reaches here (excluded upstream, see
 * candidates.ts) so it isn't a level.
 */
export const VOLCANO_LEVELS = [
  { key: "erupting", status: "erupting", label: "Erupting" },
  { key: "unrest", status: "unrest", label: "Unrest" },
] as const satisfies { key: string; status: VolcanoStatus; label: string }[];

export type VolcanoLevel = (typeof VOLCANO_LEVELS)[number]["key"];

/** Bucket a volcano status into its hold level (dormant never airs, see above). */
export function volcanoLevelForStatus(status: VolcanoStatus): VolcanoLevel {
  return status === "erupting" ? "erupting" : "unrest";
}

/**
 * Operator-set, durable director configuration. Persisted to Mongo; the worker
 * re-reads it every tick so changes take effect within one tick with no socket
 * plumbing in the operator→worker direction.
 */
export interface DirectorConfig {
  mode: DirectorMode;
  /**
   * Hold per segment KIND, seconds — every action type gets its own duration.
   * For the event kinds this is only the fallback: `quake` and `storm` shots
   * take their hold from the per-level maps below instead, so an Extreme
   * warning can dwell far longer than a Minor one.
   */
  kindHoldSeconds: Record<SegmentKind, number>;
  /** Hold per quake magnitude class (micro … great), seconds. */
  quakeHoldSeconds: Record<QuakeMagnitudeClass, number>;
  /** Hold per storm severity level (info … extreme), seconds. */
  stormHoldSeconds: Record<StormLevel, number>;
  /** Hold per volcano status level (unrest / erupting), seconds. */
  volcanoHoldSeconds: Record<VolcanoLevel, number>;
  /**
   * Fixed camera-flight time between shots, seconds — the "set" transition. The
   * worker stamps `holdMs`→hold and this→`cutTransitionMs` on every cut, so each
   * shot flies in for the same deliberate pace regardless of travel distance.
   */
  transitionSeconds: number;
  /** Which kinds are eligible to be scheduled. */
  kinds: Record<SegmentKind, boolean>;
  /**
   * How often each enabled kind airs relative to the others — a multiplier on
   * the director's random kind pick (absent kind = 1). Clamped to 0.1–10 so a
   * weight can bias the rotation but never starve or monopolise it.
   */
  kindWeights: Partial<Record<SegmentKind, number>>;
  /**
   * Favourite country ids (see COUNTRY_SHOTS) the `country` kind rotates
   * through with a 5× preference; all other countries remain eligible. Catalog-ordered.
   */
  countries: string[];
  /**
   * Favourite region ids (see REGION_SHOTS) the `region` kind rotates through —
   * with a 5× preference; all other areas remain eligible. Catalog-ordered.
   */
  regions: string[];
  /** Only schedule quakes at/above this magnitude. */
  minQuakeMag: number;
  /** Only schedule storms at/above this normalised severity (0–4). */
  minAlertSeverity: number;
  /**
   * Dwell per step of the on-globe alert cycle (`ControlState.alertCycle`), in
   * seconds — how long one hazard type stays lit before the next takes over.
   * A beat, like the map-type tour's own per-look dwell. Min 2.
   */
  alertCycleSeconds: number;
  /**
   * When the `ad` kind is enabled, force a full-frame ad interstitial every this
   * many shots (a "commercial break" cadence). Min 1. Ignored when `kinds.ad`
   * is off. A random ACTIVE ad is picked (weighted by its `weight`) each time.
   */
  adEveryNShots: number;
  /**
   * Bump to force-cut the current segment immediately. The worker remembers the
   * last value it acted on; any increase skips. (Monotonic, operator-driven.)
   */
  skipNonce: number;
  /**
   * Which basemap/"map type" looks each touring kind (intro/global/ocean/quake) cycles
   * through, by id (see GlobalMapType.id in director-rois). A kind absent here,
   * or given an empty list, tours its full catalog (today's behaviour) — this is
   * purely a subtractive filter, never additive.
   */
  mapTypes: Partial<Record<SegmentKind, string[]>>;
  /**
   * Per-kind boolean overlay overrides layered onto PRESETS[kind] (see
   * OVERLAY_KEYS in director-rois) — e.g. turn off a quake's plate-boundary
   * overlay without touching any other kind. Empty = today's PRESETS untouched.
   */
  overlayOverrides: Partial<Record<SegmentKind, Partial<Record<string, boolean>>>>;
  /**
   * Per-kind basemap + wind-particle look overrides, layered onto whatever's
   * globally live — e.g. give storm shots a denser, faster wind look than a
   * country spotlight. Absent kind/field falls back to the live operator
   * setting (today's behaviour, unchanged).
   */
  kindLooks: Partial<Record<SegmentKind, KindLook>>;
  /**
   * Named, saved looks ("slides") per kind — a library the operator saves to
   * and loads from. The look actually APPLIED to a kind still lives in
   * `kindLooks`/`overlayOverrides` above; loading a slide just copies its
   * fields into those. Slides themselves are never read by the worker.
   */
  kindSlides: Partial<Record<SegmentKind, KindSlide[]>>;
  /**
   * Which saved slide (by id) is currently loaded per kind, if any — lets the
   * operator's "Update"/"Delete" buttons target the right one. Purely a UI
   * convenience; not read by the worker. `null` clears back to "no slide
   * selected" (see `mergeActiveSlideId`).
   */
  activeSlideId: Partial<Record<SegmentKind, string | null>>;
}

/**
 * A named, saved snapshot of a KindLook + its overlay toggles for one kind
 * (see `DirectorConfig.kindSlides`) — e.g. "Cinematic dark" or "Daytime
 * clean". Captured from the live map when the operator hits "Save as new".
 */
export interface KindSlide {
  id: string;
  name: string;
  look: KindLook;
  overlays: Partial<Record<string, boolean>>;
}

/**
 * A per-kind basemap + wind-particle override (see `DirectorConfig.kindLooks`).
 * A field set to `null` in a patch clears it back to "inherit the live
 * setting" (see `mergeKindLooks`) — `undefined` just means "not touched".
 */
export interface KindLook {
  basemap?: string | null;
  wind?: Partial<WindSettings> | null;
  /** Force the satellite overlay on/off for this shot type (null/undefined = inherit live). */
  showSatImg?: boolean | null;
  /** Composite look every disc shows for this shot type (SATIMG_LOOKS id; null = inherit). */
  satImgLook?: string | null;
  /** The scalar weather field shown for this shot type (null/undefined = inherit live). */
  activeVariable?: string | null;
  /** Per-feed satellite state (on/opacity/composite look), keyed by feed id (null/undefined = inherit live). */
  satImgFeeds?: Partial<Record<string, Partial<SatImgFeedState>>> | null;
  /** Aurora oval overlay opacity for this shot type (null/undefined = inherit live). */
  auroraOpacity?: number | null;
  /** Geomagnetic-field overlay opacity for this shot type (null/undefined = inherit live). */
  magneticFieldOpacity?: number | null;
}

/**
 * Default hold per kind. The world spins (intro/global/ocean/orbital) run long —
 * they tour several map types within the one shot (was the old holdSeconds × 1.4).
 */
export const DEFAULT_KIND_HOLD_SECONDS: Record<SegmentKind, number> = {
  intro: 17,
  global: 17,
  ocean: 17,
  orbital: 17,
  country: 12,
  region: 12,
  point: 12, // sandbox-only kind (not director-scheduled); entry kept for the exhaustive Record
  storm: 12,
  volcano: 12,
  quake: 12,
  flight: 12,
  ship: 12,
  ad: 12,
};

/** Default hold per quake magnitude class — the bigger the quake, the longer the dwell. */
export const DEFAULT_QUAKE_HOLD_SECONDS: Record<QuakeMagnitudeClass, number> = {
  micro: 8,
  minor: 8,
  light: 10,
  moderate: 12,
  strong: 16,
  major: 22,
  great: 30,
};

/** Default hold per storm severity level — Extreme headlines linger. */
export const DEFAULT_STORM_HOLD_SECONDS: Record<StormLevel, number> = {
  info: 10,
  minor: 10,
  moderate: 12,
  severe: 16,
  extreme: 24,
};

/** Default hold per volcano status level — an active eruption lingers longer than mere unrest. */
export const DEFAULT_VOLCANO_HOLD_SECONDS: Record<VolcanoLevel, number> = {
  unrest: 14,
  erupting: 22,
};

/** Every overlay toggle off — the base a seed slide's `on` list layers onto. */
const SEED_OVERLAYS_OFF: Partial<Record<string, boolean>> = Object.fromEntries(
  OVERLAY_KEYS.map((k) => [k, false]),
);

/**
 * The satellite-clouds snapshot a plain "Satellite View / Satellite Clouds" slide
 * applies: the global true-colour mosaic ON, every regional geostationary disc (and
 * the lightning overlay) OFF — so airing one shows the clean whole-planet cloud layer
 * rather than the cluttered stack of GOES / Himawari / Meteosat discs. Only each feed's
 * `on` is set, so a feed keeps its own opacity from the live state (global's included).
 * The disc-specific looks (IR / water-vapour / dust / storm-eye) deliberately omit this —
 * those products only exist on a disc, so they leave the per-feed state alone.
 */
const GLOBAL_ONLY_SATIMG: Partial<Record<string, Partial<SatImgFeedState>>> = Object.fromEntries(
  SATIMG_FEEDS.map((f) => [f.id, { on: f.id === "global" }]),
);

/**
 * A background-only wind look for slides where wind isn't the point — thin,
 * slow, and translucent so it never competes with the actual subject (the
 * scalar field / satellite photo / cities). The dramatic `WIND_PRESETS.storm`
 * look (and the flight kind's jet-stream slide) stays at full strength
 * un-toned-down — for those, showing prominent wind IS the point of the shot.
 */
const SUBTLE_WIND: WindSettings = { numParticles: 2500, speedFactor: 4, maxAge: 35, width: 1, opacity: 0.1, color: "#ffffff" };

/**
 * The dedicated wind-showcase look — denser and faster than the base
 * `WIND_PRESETS.storm`, for the handful of slides where dramatic wind IS the
 * point (storm chaser, rough seas, the jet stream). Kept a touch above the
 * general seed cap (0.3 vs 0.2) and exempted from it by reference below, so the
 * showcase reads as stronger wind without blasting full opacity.
 */
const GUST_WIND: WindSettings = { ...WIND_PRESETS.storm, numParticles: 14000, speedFactor: 20, opacity: 0.3 };

/**
 * Seed slides never blast wind particles at full strength — over an
 * establishing/global shot they read as noise. Cap particle opacity at 0.2 for
 * every seeded look (current and future). This is a seed-slide rule only, NOT a
 * general runtime clamp — an operator can still crank particles up live. The
 * `GUST_WIND` showcase preset is the one deliberate exception (0.3).
 */
const SEED_MAX_WIND_OPACITY = 0.2;

function seedSlide(id: string, name: string, look: KindLook, on: readonly string[]): KindSlide {
  const overlays = { ...SEED_OVERLAYS_OFF };
  for (const k of on) overlays[k] = true;
  const overCap =
    look.wind &&
    look.wind !== GUST_WIND &&
    (look.wind.opacity ?? 0) > SEED_MAX_WIND_OPACITY;
  const capped = overCap ? { ...look, wind: { ...look.wind, opacity: SEED_MAX_WIND_OPACITY } } : look;
  return { id, name, look: capped, overlays };
}

/**
 * The full land-spotlight look library, shared by the `country` and `region`
 * ("area") kinds — same seeded slides, id-prefixed per kind so the two catalogs
 * stay independent. One slide per LAND map type so a fresh config already covers
 * the whole instrument: every land-relevant scalar field, both wind renders,
 * each satellite look, the terrain/night basemaps and the magnetic field. Ocean
 * fields (sst/wave/salinity/current) and the polar aurora are deliberately
 * omitted — they read as empty over a land spotlight. Land chrome (alerts +
 * elevation contours + cities) rides under every weather look; satellite/basemap
 * looks drop the field-only overlays that would fight the imagery.
 */
function landSpotlightSlides(prefix: string): KindSlide[] {
  const s = (id: string, name: string, look: KindLook, on: readonly string[]) =>
    seedSlide(`${prefix}-${id}`, name, look, on);
  // Land chrome carried under the weather-field looks.
  const FIELD = ["showWind", "showAlerts", "showElevation", "showCities"] as const;
  const FIELD_RADAR = ["showWind", "showRadar", "showAlerts", "showElevation", "showCities"] as const;
  const FULL = ["showWind", "showPressure", "showRadar", "showAlerts", "showElevation", "showCities"] as const;
  const IMG = ["showSatImg", "showAlerts", "showCities"] as const;
  const p = (activeVariable?: string): KindLook => ({ wind: SUBTLE_WIND, activeVariable });
  return [
    // ── Scalar weather fields ────────────────────────────────────────────────
    s("national-check", "National Weather Check", p(), FULL),
    s("humidity-heat", "Humidity & Heat", p("humidity"), FIELD),
    s("dewpoint", "Dewpoint", p("dewpoint"), FIELD),
    s("rainfall", "Rainfall", p("rain"), FIELD_RADAR),
    s("cloud-cover", "Cloud Cover", p("cloud"), FIELD),
    s("snow-ice", "Snow & Ice", p("snow"), FIELD),
    s("pressure-systems", "Pressure Systems", p("pressure"), ["showWind", "showPressure", "showAlerts", "showElevation", "showCities"]),
    s("storm-energy", "Storm Energy", p("storm"), FIELD_RADAR),
    s("storm-cap", "Storm Cap", p("cin"), FIELD_RADAR),
    s("visibility", "Visibility", p("visibility"), FIELD),
    s("soil-moisture", "Soil Moisture", p("soil"), FIELD),
    s("feels-like", "Feels Like", p("feelslike"), FIELD),
    s("precipitable-water", "Precipitable Water", p("pwat"), FIELD),
    s("uv", "UV", p("uvindex"), FIELD),
    s("severe-alert", "Severe Alert", { wind: GUST_WIND, activeVariable: "gust" }, ["showWind", "showPressure", "showRadar", "showAlerts", "showCities"]),
    s("radar-focus", "Radar Focus", p("radar"), ["showWind", "showPressure", "showRadar", "showAlerts", "showCities"]),
    // ── Live satellite looks ─────────────────────────────────────────────────
    s("satellite-view", "Satellite View", { showSatImg: true, satImgLook: "geocolor", satImgFeeds: GLOBAL_ONLY_SATIMG }, IMG),
    s("satellite-ir", "Satellite IR", { showSatImg: true, satImgLook: "ir" }, IMG),
    s("water-vapour", "Water Vapour", { showSatImg: true, satImgLook: "watervapour" }, IMG),
    s("dust-haze", "Dust & Haze", { showSatImg: true, satImgLook: "dust" }, IMG),
    // ── Terrain / basemap looks ──────────────────────────────────────────────
    s("terrain-relief", "Terrain Relief", { basemap: "relief", wind: SUBTLE_WIND }, FULL),
    s("topo-map", "Topo Map", { basemap: "terrain" }, ["showElevation", "showAlerts", "showCities"]),
    s("city-lights", "City Lights", { basemap: "night" }, ["showAlerts", "showCities"]),
    s("magnetic-field", "Magnetic Field", { basemap: "dark" }, ["showMagneticField", "showAlerts", "showCities"]),
  ];
}

/**
 * The whole-planet establishing-shot library, shared by the `intro` (one-time
 * opener) and `global` (recurring world spin) kinds — same seeded slides,
 * id-prefixed per kind so the two catalogs stay independent. Mirrors
 * `landSpotlightSlides` but for the globe: a handful of cinematic basemap looks
 * plus one slide per NON-SEA scalar field, so a fresh config's globe rotation
 * already showcases every land-and-atmosphere variable the instrument carries
 * (temperature, humidity, dewpoint, rain, cloud, snow, pressure, CAPE, CIN,
 * visibility, soil, gust). Ocean fields (sst/wave/salinity/current) and the
 * nest-only radar are omitted — they read as empty or absent over a global spin.
 * Every field look rides a subtle background wind + city labels; the cinematic
 * basemap looks (city lights / aurora / magnetic) drop the field so the imagery
 * leads.
 */
function establishingSlides(prefix: string): KindSlide[] {
  const s = (id: string, name: string, look: KindLook, on: readonly string[]) =>
    seedSlide(`${prefix}-${id}`, name, look, on);
  const FIELD = ["showWind", "showCities"] as const;
  const p = (activeVariable?: string): KindLook => ({ wind: SUBTLE_WIND, activeVariable });
  return [
    // ── Cinematic establishing looks ─────────────────────────────────────────
    s("cinematic-dark", "Cinematic Dark", { basemap: "dark", wind: SUBTLE_WIND }, ["showWind", "showPressure", "showCities"]),
    s("city-lights", "City Lights", { basemap: "night", wind: { ...WIND_PRESETS.calm, opacity: 0.5 } }, ["showCities"]),
    s("aurora-glow", "Aurora Glow", { wind: { ...WIND_PRESETS.calm, opacity: 0.5 } }, ["showAurora", "showCities"]),
    s("magnetic-field", "Magnetic Field", { basemap: "dark" }, ["showMagneticField", "showCities"]),
    // ── Scalar weather fields — one slide per non-sea variable ───────────────
    s("temperature", "Temperature", p("temp"), FIELD),
    s("humidity-heat", "Humidity & Heat", p("humidity"), FIELD),
    s("dewpoint", "Dewpoint", p("dewpoint"), FIELD),
    s("rainfall", "Rainfall", p("rain"), FIELD),
    s("cloud-cover", "Cloud Cover", p("cloud"), FIELD),
    s("snow-ice", "Snow & Ice", p("snow"), FIELD),
    s("pressure-systems", "Pressure Systems", p("pressure"), ["showWind", "showPressure", "showCities"]),
    s("storm-energy", "Storm Energy", p("storm"), FIELD),
    s("storm-cap", "Storm Cap", p("cin"), FIELD),
    s("visibility", "Visibility", p("visibility"), FIELD),
    s("soil-moisture", "Soil Moisture", p("soil"), FIELD),
    s("feels-like", "Feels Like", p("feelslike"), FIELD),
    s("precipitable-water", "Precipitable Water", p("pwat"), FIELD),
    s("uv", "UV", p("uvindex"), FIELD),
    s("severe-wind", "Severe Wind", { wind: GUST_WIND, activeVariable: "gust" }, FIELD),
  ];
}

/**
 * Starter "look" library per kind (see `DirectorConfig.kindSlides`) — two
 * curated slides each, so a fresh "Look per shot type" panel isn't empty.
 * `ad` is skipped: an ad is a full-frame card (the map underneath never shows),
 * so it has no single fixed look worth saving (see its PRESETS comment).
 *
 * Purely a saved-slide seed — none of these are pre-loaded into `kindLooks`/
 * `overlayOverrides`, so a fresh config's actual on-air look is unchanged
 * until the operator picks one.
 */
export const DEFAULT_KIND_SLIDES: Partial<Record<SegmentKind, KindSlide[]>> = {
  // One-time opener: the full whole-planet establishing library (see
  // `establishingSlides` — cinematic basemaps + one slide per non-sea variable).
  intro: establishingSlides("intro"),
  // The recurring world spin shares the intro opener's look library — same
  // establishing-shot looks, just aired as ordinary global filler rather than once.
  global: establishingSlides("global"),
  ocean: [
    seedSlide(
      "ocean-storm-seas",
      "Storm Seas",
      { wind: GUST_WIND, activeVariable: "wave" },
      ["showWind", "showCities"],
    ),
    seedSlide("ocean-satellite-view", "Satellite View", { showSatImg: true, satImgLook: "geocolor", satImgFeeds: GLOBAL_ONLY_SATIMG }, [
      "showSatImg",
      "showCities",
    ]),
    seedSlide(
      "ocean-salinity",
      "Ocean Salinity",
      { wind: SUBTLE_WIND, activeVariable: "salinity" },
      ["showWind", "showCities"],
    ),
    seedSlide(
      "ocean-sea-surface-temp",
      "Sea Surface Temp",
      { wind: SUBTLE_WIND, activeVariable: "sst" },
      ["showWind", "showCities"],
    ),
    seedSlide(
      "ocean-currents",
      "Ocean Currents",
      { wind: SUBTLE_WIND, activeVariable: "current" },
      ["showWind", "showCities"],
    ),
  ],
  // Space mode always rides the default (dark) basemap — a satellite constellation
  // reads best against the plain dark globe, not a terrain/satellite/night photo
  // backdrop. The two seeded looks differ by their aurora overlay, not the basemap.
  orbital: [
    seedSlide("orbital-classic", "Constellation Classic", { basemap: "dark" }, [
      "showSatellites",
      "showOrbits",
      "showTrackLabels",
      "showCities",
    ]),
    seedSlide("orbital-aurora-backdrop", "Aurora Backdrop", { basemap: "dark" }, [
      "showSatellites",
      "showOrbits",
      "showTrackLabels",
      "showAurora",
      "showCities",
    ]),
    seedSlide(
      "orbital-uv",
      "UV",
      { basemap: "dark", activeVariable: "uvindex" },
      ["showSatellites", "showOrbits", "showTrackLabels", "showCities"],
    ),
  ],
  country: landSpotlightSlides("country"),
  // Region ("area") spotlights share the country's land look library — same
  // seeded slides, region-scoped ids so the two catalogs stay independent.
  region: landSpotlightSlides("region"),
  storm: [
    seedSlide("storm-chaser", "Storm Chaser", { wind: GUST_WIND }, [
      "showWind",
      "showPressure",
      "showRadar",
      "showAlerts",
      "showCities",
    ]),
    seedSlide("storm-satellite-eye", "Satellite Eye", { showSatImg: true, satImgLook: "ir" }, [
      "showSatImg",
      "showAlerts",
      "showCities",
    ]),
    seedSlide(
      "storm-radar-focus",
      "Radar Focus",
      { wind: SUBTLE_WIND, activeVariable: "rain" },
      ["showWind", "showPressure", "showContours", "showRadar", "showAlerts", "showCities"],
    ),
    seedSlide("storm-water-vapour", "Water Vapour", { showSatImg: true, satImgLook: "watervapour" }, [
      "showSatImg",
      "showAlerts",
      "showCities",
    ]),
    seedSlide(
      "storm-heat-advisory",
      "Heat Advisory",
      { wind: SUBTLE_WIND, activeVariable: "temp" },
      ["showWind", "showAlerts", "showCities"],
    ),
    seedSlide("storm-dust-storm", "Dust Storm", { showSatImg: true, satImgLook: "dust" }, [
      "showSatImg",
      "showAlerts",
      "showCities",
    ]),
  ],
  quake: [
    seedSlide("quake-terrain-contours", "Terrain Contours", { basemap: "dark" }, [
      "showElevation",
      "showSeismic",
      "showCables",
      "showFaults",
      "showCities",
    ]),
    seedSlide("quake-city-lights", "City Lights", { basemap: "night" }, [
      "showElevation",
      "showSeismic",
      "showCables",
      "showFaults",
      "showCities",
    ]),
    seedSlide("quake-shaded-relief", "Shaded Relief", { basemap: "relief" }, [
      "showElevation",
      "showSeismic",
      "showCables",
      "showFaults",
      "showCities",
    ]),
    seedSlide("quake-topo-map", "Topo Map", { basemap: "terrain" }, [
      "showElevation",
      "showSeismic",
      "showCables",
      "showFaults",
      "showCities",
    ]),
    seedSlide(
      "quake-temperature",
      "Temperature",
      { wind: SUBTLE_WIND, activeVariable: "temp" },
      ["showWind", "showSeismic", "showCables", "showFaults", "showCities"],
    ),
    seedSlide(
      "quake-rainfall",
      "Rainfall",
      { wind: SUBTLE_WIND, activeVariable: "rain" },
      ["showWind", "showSeismic", "showCables", "showFaults", "showCities"],
    ),
    seedSlide(
      "quake-cloud-cover",
      "Cloud Cover",
      { wind: SUBTLE_WIND, activeVariable: "cloud" },
      ["showWind", "showSeismic", "showCables", "showFaults", "showCities"],
    ),
  ],
  volcano: [
    seedSlide("volcano-terrain-contours", "Terrain Contours", { basemap: "dark" }, [
      "showElevation",
      "showVolcanoes",
      "showCables",
      "showFaults",
      "showCities",
    ]),
    seedSlide("volcano-city-lights", "City Lights", { basemap: "night" }, [
      "showElevation",
      "showVolcanoes",
      "showCables",
      "showFaults",
      "showCities",
    ]),
    seedSlide("volcano-shaded-relief", "Shaded Relief", { basemap: "relief" }, [
      "showElevation",
      "showVolcanoes",
      "showCables",
      "showFaults",
      "showCities",
    ]),
    seedSlide("volcano-topo-map", "Topo Map", { basemap: "terrain" }, [
      "showElevation",
      "showVolcanoes",
      "showCables",
      "showFaults",
      "showCities",
    ]),
    seedSlide("volcano-magnetic-signature", "Magnetic Signature", { basemap: "dark" }, [
      "showElevation",
      "showVolcanoes",
      "showCables",
      "showFaults",
      "showMagneticField",
      "showCities",
    ]),
    seedSlide(
      "volcano-temperature",
      "Temperature",
      { wind: SUBTLE_WIND, activeVariable: "temp" },
      ["showWind", "showVolcanoes", "showCables", "showFaults", "showCities"],
    ),
    seedSlide(
      "volcano-rainfall",
      "Rainfall",
      { wind: SUBTLE_WIND, activeVariable: "rain" },
      ["showWind", "showVolcanoes", "showCables", "showFaults", "showCities"],
    ),
    seedSlide(
      "volcano-cloud-cover",
      "Cloud Cover",
      { wind: SUBTLE_WIND, activeVariable: "cloud" },
      ["showWind", "showVolcanoes", "showCables", "showFaults", "showCities"],
    ),
  ],
  flight: [
    seedSlide("flight-jet-stream", "Jet Stream", { wind: GUST_WIND }, [
      "showWind",
      "showAircraft",
      "showTrails",
      "showTrackLabels",
      "showCities",
    ]),
    seedSlide("flight-satellite-view", "Satellite View", { showSatImg: true, satImgLook: "geocolor", satImgFeeds: GLOBAL_ONLY_SATIMG }, [
      "showSatImg",
      "showAircraft",
      "showTrails",
      "showTrackLabels",
      "showCities",
    ]),
    seedSlide(
      "flight-cloud-cover",
      "Cloud Cover",
      { wind: SUBTLE_WIND, activeVariable: "cloud" },
      ["showWind", "showAircraft", "showTrails", "showTrackLabels", "showCities"],
    ),
    seedSlide("flight-storm-avoidance", "Storm Avoidance", { wind: SUBTLE_WIND }, [
      "showWind",
      "showRadar",
      "showAircraft",
      "showTrails",
      "showTrackLabels",
      "showCities",
    ]),
  ],
  ship: [
    seedSlide("ship-rough-seas", "Rough Seas", { wind: GUST_WIND }, [
      "showWind",
      "showShips",
      "showTrails",
      "showTrackLabels",
      "showCities",
    ]),
    seedSlide("ship-satellite-view", "Satellite View", { showSatImg: true, satImgLook: "geocolor", satImgFeeds: GLOBAL_ONLY_SATIMG }, [
      "showSatImg",
      "showShips",
      "showTrails",
      "showTrackLabels",
      "showCities",
    ]),
    seedSlide(
      "ship-calm-passage",
      "Calm Passage",
      { wind: SUBTLE_WIND },
      ["showWind", "showShips", "showTrails", "showTrackLabels", "showCities"],
    ),
    seedSlide(
      "ship-current-tracker",
      "Current Tracker",
      { wind: SUBTLE_WIND, activeVariable: "current" },
      ["showWind", "showShips", "showTrails", "showTrackLabels", "showCities"],
    ),
    seedSlide(
      "ship-fog-watch",
      "Fog Watch",
      { wind: SUBTLE_WIND, activeVariable: "humidity" },
      ["showWind", "showShips", "showTrails", "showTrackLabels", "showCities"],
    ),
  ],
};

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  mode: "off",
  kindHoldSeconds: DEFAULT_KIND_HOLD_SECONDS,
  quakeHoldSeconds: DEFAULT_QUAKE_HOLD_SECONDS,
  stormHoldSeconds: DEFAULT_STORM_HOLD_SECONDS,
  volcanoHoldSeconds: DEFAULT_VOLCANO_HOLD_SECONDS,
  transitionSeconds: 4,
  kinds: {
    intro: true,
    global: true,
    ocean: true,
    orbital: true,
    country: true,
    // Off by default: the region kind is opt-in — the operator enables it and
    // picks favourite areas, like introducing any new mode.
    region: false,
    point: false, // sandbox-only kind (not director-scheduled); never surfaced as an operator toggle
    storm: true,
    volcano: true,
    quake: true,
    flight: true,
    ship: true,
    // Off by default: ads only air once the operator enables them (and has
    // uploaded some). Opt-in, like a paid feature should be.
    ad: false,
  },
  kindWeights: {},
  countries: DEFAULT_DIRECTOR_COUNTRIES,
  regions: DEFAULT_DIRECTOR_REGIONS,
  minQuakeMag: 4.5,
  minAlertSeverity: 3,
  alertCycleSeconds: 6,
  adEveryNShots: 6,
  skipNonce: 0,
  mapTypes: {},
  overlayOverrides: {},
  kindLooks: {},
  kindSlides: DEFAULT_KIND_SLIDES,
  activeSlideId: {},
};

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/**
 * Merge a partial hold map (untrusted) onto a base — unknown keys dropped,
 * non-numbers ignored, and every hold clamped to the same 3s floor as before.
 */
function mergeHolds<K extends string>(
  keys: readonly K[],
  base: Record<K, number>,
  patch: Partial<Record<K, number>> | undefined,
): Record<K, number> {
  const out = { ...base };
  if (patch) {
    for (const k of keys) {
      const v = patch[k];
      if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.max(3, v);
    }
  }
  return out;
}

/**
 * Merge a per-kind string-array map (untrusted) onto a base — unknown kinds
 * dropped, non-string-array values ignored. Used for `mapTypes`.
 */
function mergeStringArrayMap(
  base: Partial<Record<SegmentKind, string[]>>,
  patch: Partial<Record<SegmentKind, string[]>> | undefined,
): Partial<Record<SegmentKind, string[]>> {
  const out = { ...base };
  if (patch) {
    for (const k of SEGMENT_KINDS) {
      const v = patch[k];
      if (Array.isArray(v) && v.every((id) => typeof id === "string")) out[k] = v;
    }
  }
  return out;
}

/**
 * Merge a per-kind boolean-map map (untrusted) onto a base — unknown kinds
 * dropped, non-boolean values ignored, each kind's inner map merged (not
 * replaced) so a single-toggle patch doesn't wipe its siblings. Used for
 * `overlayOverrides`.
 */
function mergeBoolMapMap(
  base: Partial<Record<SegmentKind, Partial<Record<string, boolean>>>>,
  patch: Partial<Record<SegmentKind, Partial<Record<string, boolean>>>> | undefined,
): Partial<Record<SegmentKind, Partial<Record<string, boolean>>>> {
  const out = { ...base };
  if (patch) {
    for (const k of SEGMENT_KINDS) {
      const inner = patch[k];
      if (!inner || typeof inner !== "object") continue;
      const cur = { ...(out[k] ?? {}) };
      for (const key of Object.keys(inner)) {
        const v = inner[key];
        if (typeof v === "boolean") cur[key] = v;
      }
      out[k] = cur;
    }
  }
  return out;
}

const WIND_KEYS = ["numParticles", "speedFactor", "maxAge", "width", "opacity", "color"] as const;
const SATIMG_FEED_IDS = new Set(SATIMG_FEEDS.map((f) => f.id));

/**
 * Sanitize an untrusted satImgFeeds patch — unknown feed ids dropped, each
 * feed's on/opacity/look validated field-by-field. Returns undefined for a
 * missing/invalid patch (clears back to "inherit live").
 */
function sanitizeSatImgFeedsPatch(raw: unknown): Partial<Record<string, Partial<SatImgFeedState>>> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Partial<Record<string, Partial<SatImgFeedState>>> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!SATIMG_FEED_IDS.has(id) || !v || typeof v !== "object") continue;
    const fv = v as Record<string, unknown>;
    const entry: Partial<SatImgFeedState> = {};
    if (typeof fv.on === "boolean") entry.on = fv.on;
    if (typeof fv.opacity === "number" && Number.isFinite(fv.opacity)) entry.opacity = fv.opacity;
    if (typeof fv.look === "string") entry.look = fv.look;
    out[id] = entry;
  }
  return out;
}

/**
 * Merge a per-kind look map (untrusted) onto a base — unknown kinds dropped,
 * each kind's `basemap`/`wind` merged field-by-field (not
 * replaced), so a patch touching one wind slider doesn't wipe the kind's
 * other fields. Since patches travel as JSON (where an `undefined` value is
 * indistinguishable from an absent key), a key must be explicitly present —
 * checked with `in`, not `!== undefined` — to be touched at all; send `null`
 * to clear a field back to "inherit the live setting". Used for `kindLooks`.
 */
function mergeKindLooks(
  base: Partial<Record<SegmentKind, KindLook>>,
  patch: Partial<Record<SegmentKind, KindLook>> | undefined,
): Partial<Record<SegmentKind, KindLook>> {
  const out = { ...base };
  if (patch) {
    for (const k of SEGMENT_KINDS) {
      const inner = patch[k] as Record<string, unknown> | null | undefined;
      if (!inner || typeof inner !== "object") continue;
      const curBase = out[k] ?? {};
      const cur: KindLook = { ...curBase };

      if ("basemap" in inner) {
        cur.basemap = typeof inner.basemap === "string" ? inner.basemap : undefined;
      }
      if ("wind" in inner) {
        const windPatch = inner.wind as Record<string, unknown> | null | undefined;
        if (!windPatch || typeof windPatch !== "object") {
          cur.wind = undefined;
        } else {
          const w: Partial<WindSettings> = { ...curBase.wind };
          for (const key of WIND_KEYS) {
            if (!(key in windPatch)) continue;
            const v = windPatch[key];
            if (key === "color") {
              if (typeof v === "string") w.color = v;
            } else if (typeof v === "number" && Number.isFinite(v)) {
              (w as Record<string, number>)[key] = v;
            }
          }
          cur.wind = w;
        }
      }
      if ("showSatImg" in inner) {
        cur.showSatImg = typeof inner.showSatImg === "boolean" ? inner.showSatImg : undefined;
      }
      if ("satImgLook" in inner) {
        cur.satImgLook = isSatImgLook(inner.satImgLook) ? (inner.satImgLook as string) : undefined;
      }
      if ("activeVariable" in inner) {
        cur.activeVariable = typeof inner.activeVariable === "string" ? inner.activeVariable : undefined;
      }
      if ("satImgFeeds" in inner) {
        cur.satImgFeeds = sanitizeSatImgFeedsPatch(inner.satImgFeeds);
      }
      if ("auroraOpacity" in inner) {
        cur.auroraOpacity =
          typeof inner.auroraOpacity === "number" && Number.isFinite(inner.auroraOpacity)
            ? inner.auroraOpacity
            : undefined;
      }
      if ("magneticFieldOpacity" in inner) {
        cur.magneticFieldOpacity =
          typeof inner.magneticFieldOpacity === "number" && Number.isFinite(inner.magneticFieldOpacity)
            ? inner.magneticFieldOpacity
            : undefined;
      }
      out[k] = cur;
    }
  }
  return out;
}

/**
 * Sanitize one untrusted slide object into a valid KindSlide, or null if it's
 * missing an id/name. Reuses mergeKindLooks/the overlay-boolean rule so a
 * slide's `look`/`overlays` are validated exactly like a live kindLooks/
 * overlayOverrides patch would be.
 */
function sanitizeKindSlide(kind: SegmentKind, raw: unknown): KindSlide | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== "string" || typeof s.name !== "string") return null;
  const look = mergeKindLooks({}, { [kind]: s.look as KindLook })[kind] ?? {};
  const overlaysRaw = s.overlays;
  const overlays: Partial<Record<string, boolean>> = {};
  if (overlaysRaw && typeof overlaysRaw === "object") {
    for (const [key, v] of Object.entries(overlaysRaw as Record<string, unknown>)) {
      if (typeof v === "boolean") overlays[key] = v;
    }
  }
  return { id: s.id, name: s.name, look, overlays };
}

/**
 * Merge a per-kind slide-list map (untrusted) onto a base — unknown kinds
 * dropped, non-array values ignored. Unlike kindLooks/overlayOverrides this
 * REPLACES a kind's list wholesale rather than merging item-by-item, since
 * save/update/delete already send the kind's full intended list. Used for
 * `kindSlides`.
 */
function mergeKindSlides(
  base: Partial<Record<SegmentKind, KindSlide[]>>,
  patch: Partial<Record<SegmentKind, KindSlide[]>> | undefined,
): Partial<Record<SegmentKind, KindSlide[]>> {
  const out = { ...base };
  if (patch) {
    for (const k of SEGMENT_KINDS) {
      const list = patch[k];
      if (!Array.isArray(list)) continue;
      out[k] = list.map((s) => sanitizeKindSlide(k, s)).filter((s): s is KindSlide => s !== null);
    }
  }
  return out;
}

/**
 * Merge a per-kind slide-id map (untrusted) onto a base — unknown kinds
 * dropped, non-string values ignored, `null` clears back to "no slide
 * selected". Used for `activeSlideId`.
 */
function mergeActiveSlideId(
  base: Partial<Record<SegmentKind, string | null>>,
  patch: Partial<Record<SegmentKind, string | null>> | undefined,
): Partial<Record<SegmentKind, string | null>> {
  const out = { ...base };
  if (patch) {
    for (const k of SEGMENT_KINDS) {
      if (!(k in patch)) continue;
      const v = patch[k];
      if (v === null) delete out[k];
      else if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

/**
 * Merge a partial (untrusted) kind-weight map onto a base — unknown kinds
 * dropped, non-finite values ignored, weights clamped to 0.1–10. A weight of
 * exactly 1 is elided back to "absent" so the stored map stays sparse.
 */
function mergeKindWeights(
  base: Partial<Record<SegmentKind, number>>,
  patch: Partial<Record<SegmentKind, number>> | undefined,
): Partial<Record<SegmentKind, number>> {
  const src = patch && typeof patch === "object" ? patch : undefined;
  const out = { ...(base ?? {}) };
  if (src) {
    for (const k of SEGMENT_KINDS) {
      const v = src[k];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const clamped = Math.min(10, Math.max(0.1, v));
      if (clamped === 1) delete out[k];
      else out[k] = clamped;
    }
  }
  return out;
}

/**
 * Merge a partial (possibly untrusted, from HTTP) director-config patch onto a
 * base. Pure — used by the API route and unit-tested. Mirrors mergeControlState.
 */
export function mergeDirectorConfig(
  base: DirectorConfig,
  patch: Partial<DirectorConfig>,
): DirectorConfig {
  const kinds = { ...base.kinds };
  if (patch.kinds) {
    for (const k of SEGMENT_KINDS) {
      if (typeof patch.kinds[k] === "boolean") kinds[k] = patch.kinds[k] as boolean;
    }
  }
  return {
    mode: patch.mode === "off" || patch.mode === "auto" ? patch.mode : base.mode,
    kindHoldSeconds: mergeHolds(SEGMENT_KINDS, base.kindHoldSeconds, patch.kindHoldSeconds),
    quakeHoldSeconds: mergeHolds(QUAKE_LEVELS, base.quakeHoldSeconds, patch.quakeHoldSeconds),
    stormHoldSeconds: mergeHolds(
      STORM_LEVELS.map((l) => l.key),
      base.stormHoldSeconds,
      patch.stormHoldSeconds,
    ),
    volcanoHoldSeconds: mergeHolds(
      VOLCANO_LEVELS.map((l) => l.key),
      base.volcanoHoldSeconds,
      patch.volcanoHoldSeconds,
    ),
    transitionSeconds: Math.max(0.5, num(patch.transitionSeconds, base.transitionSeconds)),
    kinds,
    kindWeights: mergeKindWeights(base.kindWeights, patch.kindWeights),
    countries: sanitizeDirectorCountries(patch.countries) ?? base.countries,
    regions: sanitizeDirectorRegions(patch.regions) ?? base.regions,
    minQuakeMag: num(patch.minQuakeMag, base.minQuakeMag),
    minAlertSeverity: num(patch.minAlertSeverity, base.minAlertSeverity),
    // Floor at 2s: below that the cycle strobes rather than reads.
    alertCycleSeconds: Math.max(2, num(patch.alertCycleSeconds, base.alertCycleSeconds)),
    adEveryNShots: Math.max(1, Math.round(num(patch.adEveryNShots, base.adEveryNShots))),
    skipNonce: num(patch.skipNonce, base.skipNonce),
    mapTypes: mergeStringArrayMap(base.mapTypes, patch.mapTypes),
    overlayOverrides: mergeBoolMapMap(base.overlayOverrides, patch.overlayOverrides),
    kindLooks: mergeKindLooks(base.kindLooks, patch.kindLooks),
    kindSlides: mergeKindSlides(base.kindSlides, patch.kindSlides),
    activeSlideId: mergeActiveSlideId(base.activeSlideId, patch.activeSlideId),
  };
}

/** Configured hold for a segment kind, in ms. */
export function kindHoldMs(cfg: DirectorConfig, kind: SegmentKind): number {
  return Math.round(num(cfg.kindHoldSeconds?.[kind], DEFAULT_KIND_HOLD_SECONDS[kind]) * 1000);
}

/** Configured hold for a quake of this magnitude, in ms (per magnitude class). */
export function quakeHoldMs(cfg: DirectorConfig, mag: number): number {
  const cls = quakeMagnitudeClass(mag);
  return Math.round(num(cfg.quakeHoldSeconds?.[cls], DEFAULT_QUAKE_HOLD_SECONDS[cls]) * 1000);
}

/** Configured hold for a storm alert of this severityRank, in ms (per level). */
export function stormHoldMs(cfg: DirectorConfig, severityRank: number): number {
  const level = stormLevelForRank(severityRank);
  return Math.round(num(cfg.stormHoldSeconds?.[level], DEFAULT_STORM_HOLD_SECONDS[level]) * 1000);
}

/** Configured hold for a volcano of this status, in ms (per level). */
export function volcanoHoldMs(cfg: DirectorConfig, status: VolcanoStatus): number {
  const level = volcanoLevelForStatus(status);
  return Math.round(num(cfg.volcanoHoldSeconds?.[level], DEFAULT_VOLCANO_HOLD_SECONDS[level]) * 1000);
}

export const INITIAL_DIRECTOR_STATE: DirectorState = {
  sceneId: "default",
  seq: 0,
  active: false,
  segment: null,
  startedAt: 0,
  endsAt: 0,
  upNext: [],
};
