import { GeoJsonLayer } from "@deck.gl/layers";
import { COUNTRIES_URL } from "./basemap";
import { DEPTH_TEST } from "./depth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CountryFeature = any;

/** Lazily fetched + parsed once, indexed by ISO-3166 alpha-2 (`iso_a2`) — the
 *  same countries.geojson `basemap.ts`'s borders layer already serves straight
 *  to deck.gl as a URL (never parsed for reuse until now). Module-level cache:
 *  every Globe instance shares one fetch. */
let cache: Promise<Map<string, CountryFeature>> | null = null;

function loadCountryFeatures(): Promise<Map<string, CountryFeature>> {
  if (!cache) {
    cache = fetch(COUNTRIES_URL)
      .then((r) => r.json())
      .then((fc: { features?: CountryFeature[] }) => {
        const byIso = new Map<string, CountryFeature>();
        for (const f of fc.features ?? []) {
          const iso = String(f?.properties?.iso_a2 ?? "").toUpperCase();
          if (iso) byIso.set(iso, f);
        }
        return byIso;
      })
      .catch(() => new Map<string, CountryFeature>());
  }
  return cache;
}

/** Resolve a spotlighted country's ISO-3166 alpha-2 to its boundary feature, or
 *  null while loading / on a miss. Callers poll this each render (cheap: the
 *  underlying fetch+parse only ever happens once). */
export async function countryFeatureFor(iso2: string): Promise<CountryFeature | null> {
  const byIso = await loadCountryFeatures();
  return byIso.get(iso2.toUpperCase()) ?? null;
}

/** One full breath of the glow, in ms. */
const GLOW_PERIOD_MS = 2600;

function lighten(c: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(c[0] + (255 - c[0]) * t),
    Math.round(c[1] + (255 - c[1]) * t),
    Math.round(c[2] + (255 - c[2]) * t),
  ];
}
const withA = (c: [number, number, number], a: number): [number, number, number, number] => [c[0], c[1], c[2], a];

/** Same teal family as KIND_COLOR.country (components/broadcast/kinds.ts) but
 *  brighter/more saturated — that muted tone reads fine as a small UI badge,
 *  but a globe-spanning glow needs more punch to actually shine against the
 *  weather raster from a wide shot. */
const GLOW_COLOR: [number, number, number] = [70, 225, 225];

/**
 * A breathing multi-pass halo around the spotlighted country's boundary — wide
 * soft glow, mid glow, translucent fill, crisp lit edge — reusing the same
 * layering technique alertsLayer/onAirPulseLayers use to make an on-air weather
 * area "shine out" against the basemap, so a country spotlight reads as
 * visually distinct on the globe instead of relying on the camera move alone.
 * Returns [] until the feature has resolved (still loading, or an id with no
 * geojson match).
 */
export function countryGlowLayers(feature: CountryFeature | null, now: number): unknown[] {
  if (!feature) return [];
  const phase = (now % GLOW_PERIOD_MS) / GLOW_PERIOD_MS;
  const breathe = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
  const lit = lighten(GLOW_COLOR, 0.6);
  const data = [feature];

  return [
    // 1 ─ Outer bloom — very wide, low-opacity, so it reads from a whole-globe shot.
    new GeoJsonLayer({
      id: "country-glow-bloom",
      data,
      filled: false,
      stroked: true,
      getLineColor: () => withA(lighten(GLOW_COLOR, 0.4), 30 + 22 * breathe),
      getLineWidth: () => 26 + 14 * breathe,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 20,
      parameters: DEPTH_TEST,
      updateTriggers: { getLineColor: now, getLineWidth: now },
    }),
    // 2 ─ Wide soft halo.
    new GeoJsonLayer({
      id: "country-glow-wide",
      data,
      filled: false,
      stroked: true,
      getLineColor: () => withA(lighten(GLOW_COLOR, 0.35), 70 + 50 * breathe),
      getLineWidth: () => 14 + 8 * breathe,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 11,
      parameters: DEPTH_TEST,
      updateTriggers: { getLineColor: now, getLineWidth: now },
    }),
    // 3 ─ Mid glow.
    new GeoJsonLayer({
      id: "country-glow-mid",
      data,
      filled: false,
      stroked: true,
      getLineColor: () => withA(lighten(GLOW_COLOR, 0.2), 140 + 90 * breathe),
      getLineWidth: () => 7 + 4 * breathe,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 5,
      parameters: DEPTH_TEST,
      updateTriggers: { getLineColor: now, getLineWidth: now },
    }),
    // 4 ─ Translucent fill so the whole country reads as lit, not just its edge.
    new GeoJsonLayer({
      id: "country-glow-fill",
      data,
      filled: true,
      stroked: false,
      getFillColor: () => withA(GLOW_COLOR, 26 + 34 * breathe),
      parameters: DEPTH_TEST,
      updateTriggers: { getFillColor: now },
    }),
    // 5 ─ Crisp lit edge on top, near-solid at the breath's peak.
    new GeoJsonLayer({
      id: "country-glow-edge",
      data,
      filled: false,
      stroked: true,
      getLineColor: () => withA(lit, 220 + 35 * breathe),
      getLineWidth: () => 2.5 + 2.5 * breathe,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 2,
      parameters: DEPTH_TEST,
      updateTriggers: { getLineColor: now, getLineWidth: now },
    }),
  ];
}
