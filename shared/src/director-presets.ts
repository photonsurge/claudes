/**
 * One-click director CONTENT bundles for the per-channel admin card — the
 * DirectorConfig cousin of REPORT_PRESETS (broadcast-report.ts). Each preset is
 * a plain `Partial<DirectorConfig>` staged through the page's Save bar like any
 * hand edit, so nothing airs on click.
 *
 * Presets touch content fields ONLY (`kinds` / `kindWeights` / `countries` /
 * `regions`) — never `mode`, holds, or looks: applying one re-themes what a
 * channel covers without arming the director or disturbing live pacing.
 * `kinds` records are complete (every schedulable kind stated) so a preset
 * fully replaces the previous mix rather than layering on it.
 */
import { type DirectorConfig, type SegmentKind } from "./director";
import { COUNTRY_SHOTS } from "./director-countries";

export interface DirectorPreset {
  id: string;
  name: string;
  /** One-line admin-card tooltip/subtitle. */
  description: string;
  patch: Partial<DirectorConfig>;
}

/** A complete kinds record: everything off except `on` (intro stays on — it's
 *  the one-time session opener, not recurring filler). */
const kindsOnly = (...on: SegmentKind[]): Record<SegmentKind, boolean> => ({
  intro: true,
  global: on.includes("global"),
  ocean: on.includes("ocean"),
  orbital: on.includes("orbital"),
  country: on.includes("country"),
  region: on.includes("region"),
  point: false,
  storm: on.includes("storm"),
  volcano: on.includes("volcano"),
  quake: on.includes("quake"),
  flight: on.includes("flight"),
  ship: on.includes("ship"),
  ad: on.includes("ad"),
});

export const DIRECTOR_PRESETS: DirectorPreset[] = [
  {
    id: "world-mix",
    name: "World mix",
    description: "The default variety channel — spins, countries, live events, tracks.",
    patch: {
      kinds: kindsOnly("global", "ocean", "orbital", "country", "storm", "volcano", "quake", "flight", "ship"),
      kindWeights: {},
    },
  },
  {
    id: "storms-only",
    name: "Storms only",
    description: "Severe weather, quakes and volcanoes, broken up by the world spin.",
    patch: {
      kinds: kindsOnly("global", "storm", "volcano", "quake"),
      kindWeights: { storm: 2 },
    },
  },
  {
    id: "europe-focus",
    name: "Europe focus",
    description: "European countries and areas, with country shots airing often.",
    patch: {
      kinds: kindsOnly("global", "country", "region", "storm", "quake"),
      kindWeights: { country: 2, region: 2 },
      countries: [
        "iceland", "ireland", "uk", "portugal", "spain", "france",
        "germany", "italy", "norway", "sweden", "greece", "turkey",
      ],
      regions: ["uk", "scandinavia", "iberia", "central_europe", "balkans", "eastern_europe"],
    },
  },
  {
    id: "world-tour",
    name: "World tour",
    description: "Every country in the catalog on heavy rotation — no event kinds.",
    patch: {
      kinds: kindsOnly("global", "country"),
      kindWeights: { country: 3 },
      countries: COUNTRY_SHOTS.map((c) => c.id),
    },
  },
  {
    id: "ocean-channel",
    name: "Ocean channel",
    description: "Sea-state world views with ship traffic and storm interruptions.",
    patch: {
      kinds: kindsOnly("global", "ocean", "storm", "ship"),
      kindWeights: { ocean: 2 },
    },
  },
];
