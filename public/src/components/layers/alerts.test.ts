/**
 * Tests for the alert overlay builders. `alertsLayer` clones every layer to set
 * visibility, so the deck layer classes are mocked in-file with a `clone` the
 * shared prop-capturing mock lacks. Complements onAirPulse.test.ts (which covers
 * the area-vs-marker branch of `onAirPulseLayers`) with the badge/severity/
 * colour mapping and the pulse-phase math.
 */
jest.mock("@deck.gl/layers", () => {
  class MockLayer {
    props: Record<string, unknown>;
    constructor(props: Record<string, unknown> = {}) {
      this.props = props;
    }
    clone(next: Record<string, unknown>) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new (this.constructor as any)({ ...this.props, ...next });
    }
  }
  return {
    // @deck.gl/core and @deck.gl/layers both map to the shared mock file, so
    // this factory replaces BOTH — keep the shared exports (LayerExtension for
    // breathe-extension.ts) and only override the layer classes.
    ...jest.requireActual<Record<string, unknown>>("../../test/mocks/deckgl"),
    GeoJsonLayer: class extends MockLayer {},
    PathLayer: class extends MockLayer {},
    SolidPolygonLayer: class extends MockLayer {},
    ScatterplotLayer: class extends MockLayer {},
    TextLayer: class extends MockLayer {},
  };
});

import { PathLayer, SolidPolygonLayer } from "@deck.gl/layers";
import { alertsLayer, HAZARD_GLYPHS, onAirPulseLayers, pulseIsPoint } from "./alerts";
import { NO_PARTS, NO_RINGS, outlineRings, polygonParts } from "./outline-rings";
import { BREATHE } from "./breathe-extension";
import type { AlertFeature } from "../../lib/alerts";
import type { SeverityRank } from "@photonsurge/shared/db/alert-model";
import { HAZARDS, type HazardType } from "../../lib/hazard";

/** Minimal AlertFeature; hazard drives hue, severityRank drives intensity. */
function feature(
  geometry: AlertFeature["geometry"],
  over: { hazard?: HazardType; severityRank?: SeverityRank } = {},
): AlertFeature {
  return {
    type: "Feature",
    geometry,
    properties: {
      id: "a1",
      source: "test",
      identifier: "TEST-1",
      event: "Test",
      severityRank: over.severityRank ?? 3,
      hazard: over.hazard ?? "flood",
    },
  };
}

/** Square around [10,20] — repPoint (mean of ALL 5 ring vertices) = [9.8,19.8]. */
const square = (over: Parameters<typeof feature>[1] = {}) =>
  feature(
    {
      type: "Polygon",
      coordinates: [
        [
          [9, 19],
          [11, 19],
          [11, 21],
          [9, 21],
          [9, 19],
        ],
      ],
    },
    over,
  );

const point = (coords: [number, number], over: Parameters<typeof feature>[1] = {}) =>
  feature({ type: "Point", coordinates: coords }, over);

// Hazard hues from the shared table: flood #38bdf8, fire #fb7185.
const FLOOD: [number, number, number] = [56, 189, 248];
const FIRE: [number, number, number] = [251, 113, 133];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ids = (layers: any[]) => layers.map((l) => l.props.id);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const byId = (layers: any[], id: string) => layers.find((l) => l.props.id === id)!;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const visibleIds = (layers: any[]) => layers.filter((l) => l.props.visible !== false).map((l) => l.props.id);
/** A PathLayer ring datum for `f` — the stroke passes' accessors take these, not features. */
const ring = (f: AlertFeature) => ({ path: [] as number[][], feature: f });
/** The colour a pass paints `f`: the fill accessor on the fill, the ring accessor on a stroke pass. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const paint = (p: any, f: AlertFeature): number[] => (p.getFillColor ? p.getFillColor(f) : p.getColor(ring(f)));

const AREA_IDS = ["alerts-glow-wide", "alerts-glow-mid", "alerts-fill", "alerts-edge"];
const BADGE_IDS = ["alerts-badge-halo", "alerts-badge-core", "alerts-badge-glyph"];

describe("alertsLayer — badge glyph atlas", () => {
  it("fixes the glyph layer's character set to the whole hazard catalog, not \"auto\"", () => {
    // "auto" grew the SDF atlas on the main thread whenever a cut surfaced a new
    // hazard icon (round 53); a complete set up front is built once.
    for (const h of HAZARDS) for (const cp of Array.from(h.icon)) expect(HAZARD_GLYPHS).toContain(cp);
    const glyphs = byId(alertsLayer([point([30, 40], { hazard: "fire" })]), "alerts-badge-glyph");
    expect(glyphs.props.characterSet).toBe(HAZARD_GLYPHS);
  });
});

describe("alertsLayer — layer selection", () => {
  it("polygon alerts draw the four area passes and NO badge (the area is the marker)", () => {
    expect(ids(alertsLayer([square()]))).toEqual(AREA_IDS);
  });

  it("MultiPolygon counts as a drawn area — still no badge", () => {
    const multi = feature({
      type: "MultiPolygon",
      coordinates: [[[[9, 19], [11, 19], [11, 21], [9, 21], [9, 19]]]],
    });
    expect(ids(alertsLayer([multi]))).toEqual(AREA_IDS);
  });

  it("point-only alerts add the halo/core/glyph badge stack", () => {
    expect(ids(alertsLayer([point([30, 40])]))).toEqual([...AREA_IDS, ...BADGE_IDS]);
  });

  it("badges carry only the point-only features, anchored at their coordinates", () => {
    const layers = alertsLayer([square(), point([30, 40], { hazard: "fire" })]);
    const badges = byId(layers, "alerts-badge-core").props.data as Array<{
      pos: [number, number];
      color: [number, number, number];
      icon: string;
      rank: number;
    }>;
    expect(badges).toHaveLength(1); // the polygon got no badge
    expect(badges[0].pos).toEqual([30, 40]);
    expect(badges[0].color).toEqual(FIRE); // hazard hue, not severity hue
    expect(badges[0].icon).toBe("🔥");
    expect(badges[0].rank).toBe(3);
  });

  it("skips a badge when the geometry yields no representative point", () => {
    const broken = feature({ type: "Point", coordinates: [] });
    expect(ids(alertsLayer([broken]))).toEqual(AREA_IDS);
  });

  it("passes the features array by reference so deck never re-tessellates", () => {
    const features = [square()];
    const layers = alertsLayer(features);
    expect(byId(layers, "alerts-fill").props.data).toBe(features);
  });
});

describe("alertsLayer — hazard hue + severity intensity", () => {
  const rank0 = square({ severityRank: 0 });
  const rank4 = square({ severityRank: 4 });

  it("fills with the hazard colour; opacity climbs with severity", () => {
    const fill = byId(alertsLayer([rank0]), "alerts-fill").props;
    expect(fill.getFillColor(rank0)).toEqual([...FLOOD, 22]); // 22 + 0·10
    expect(fill.getFillColor(rank4)).toEqual([...FLOOD, 62]); // 22 + 4·10
    const fire = square({ hazard: "fire" });
    expect(fill.getFillColor(fire)).toEqual([...FIRE, 22 + 3 * 10]);
  });

  /**
   * The fill has to stay light enough to see the weather THROUGH it.
   *
   * These numbers were tuned when an alert area was a single county. The worker
   * now dissolves touching areas, so one shape is the whole of France — and at the
   * old 45+rank*16 (36% for an amber warning) it stopped reading as a warning over
   * a temperature map and became a grey slab that hid the map underneath. The fill
   * is also only one of FOUR passes over the same shape, and they stack.
   */
  it("keeps the fill translucent enough to read the map through, even at rank 4", () => {
    const fill = byId(alertsLayer([rank0]), "alerts-fill").props;

    // The outline carries the shape; the fill only has to say "inside".
    expect(fill.getFillColor(rank4)[3]).toBeLessThan(64); // < 25% of 255
    // ...but it must still be visible, or the area reads as an empty outline.
    expect(fill.getFillColor(rank0)[3]).toBeGreaterThan(12);
  });

  it("glow width scales with severity (wide halo 6+3r, crisp edge 1.6+0.35r)", () => {
    const layers = alertsLayer([rank0]);
    const wide = byId(layers, "alerts-glow-wide").props;
    expect(wide.getWidth(ring(rank0))).toBe(6);
    expect(wide.getWidth(ring(rank4))).toBe(18);
    const edge = byId(layers, "alerts-edge").props;
    expect(edge.getWidth(ring(rank0))).toBeCloseTo(1.6);
    expect(edge.getWidth(ring(rank4))).toBeCloseTo(3.0);
  });

  it("the outline stays stronger than the fill — it is what carries the shape", () => {
    // Lightening the fill without this is how a big blob becomes invisible.
    const layers = alertsLayer([rank4]);
    const edgeAlpha = byId(layers, "alerts-edge").props.getColor(ring(rank4))[3];
    const fillAlpha = byId(layers, "alerts-fill").props.getFillColor(rank4)[3];

    expect(edgeAlpha).toBeGreaterThan(fillAlpha * 3);
  });

  it("glow strokes are the hazard colour lightened toward white, faint outside, bright edge", () => {
    const f = square(); // flood
    const layers = alertsLayer([f]);
    // lighten(FLOOD, 0.35) @ alpha 26.
    expect(byId(layers, "alerts-glow-wide").props.getColor(ring(f))).toEqual([126, 212, 250, 26]);
    // lighten(FLOOD, 0.55) @ alpha 240 — the crisp lit edge.
    expect(byId(layers, "alerts-edge").props.getColor(ring(f))).toEqual([165, 225, 252, 240]);
  });

  it("strokes are PathLayers over the polygon rings — no GeoJsonLayer fill sublayer to earcut", () => {
    // GeoJsonLayer always builds a polygons-fill sublayer that tessellates every
    // polygon even with `filled: false`; the three stroke passes must not.
    const f = square();
    const features = [f];
    const layers = alertsLayer(features);
    const rings = outlineRings(features); // memoised on the SAME array instance
    expect(rings).toHaveLength(1);
    for (const id of ["alerts-glow-wide", "alerts-glow-mid", "alerts-edge"]) {
      const l = byId(layers, id);
      expect(l).toBeInstanceOf(PathLayer);
      expect(l.props.data).toBe(rings);
      expect(l.props.getPath(rings[0])).toBe(rings[0].path);
      expect(l.props.filled).toBeUndefined();
    }
    expect(byId(layers, "alerts-fill")).not.toBeInstanceOf(PathLayer);
  });

  it("only the fill and the crisp edge are pickable (click-to-select surface)", () => {
    const layers = alertsLayer([square()]);
    expect(byId(layers, "alerts-fill").props.pickable).toBe(true);
    expect(byId(layers, "alerts-edge").props.pickable).toBe(true);
    expect(byId(layers, "alerts-glow-wide").props.pickable).toBeUndefined();
    expect(byId(layers, "alerts-glow-mid").props.pickable).toBeUndefined();
  });

  it("badge sizing: core 6+1.6r px, halo 2.6× the core, glyph 11+1.5r px", () => {
    const layers = alertsLayer([point([30, 40], { severityRank: 3 })]);
    const badge = byId(layers, "alerts-badge-core").props.data[0];
    expect(byId(layers, "alerts-badge-core").props.getRadius(badge)).toBeCloseTo(10.8);
    expect(byId(layers, "alerts-badge-halo").props.getRadius(badge)).toBeCloseTo(28.08);
    expect(byId(layers, "alerts-badge-glyph").props.getSize(badge)).toBeCloseTo(15.5);
    expect(byId(layers, "alerts-badge-glyph").props.getText(badge)).toBe("🌊");
    expect(byId(layers, "alerts-badge-core").props.getFillColor(badge)).toEqual([...FLOOD, 235]);
  });
});

describe("alertsLayer — visibility cloning", () => {
  it("hides every pass via clone (visible:false) instead of dropping layers", () => {
    const layers = alertsLayer([square(), point([30, 40])], false);
    expect(layers).toHaveLength(7);
    for (const l of layers) expect(l.props.visible).toBe(false);
    // Ids survive the clone, so deck can diff against the visible version.
    expect(ids(layers)).toEqual([...AREA_IDS, ...BADGE_IDS]);
  });

  it("defaults to visible", () => {
    for (const l of alertsLayer([square()])) expect(l.props.visible).toBe(true);
  });
});

describe("alertsLayer — hazard cycle ghosting", () => {
  const FOCUS = { hazard: "flood" as HazardType, prevHazard: null, fade: 1, pinned: null };
  const lit = square({ hazard: "flood" });
  const ghost = square({ hazard: "fire" });

  it("keeps the data array reference so a step never re-tessellates", () => {
    const features = [lit, ghost];
    const rings = outlineRings(features);
    for (const l of alertsLayer(features, true, FOCUS)) {
      if (l.props.id.startsWith("alerts-badge")) continue;
      expect(l.props.data).toBe(l.props.id === "alerts-fill" ? features : rings);
    }
  });

  it("drops the bloom + fill of an off-step hazard, keeping a dim hairline edge", () => {
    const layers = alertsLayer([lit, ghost], true, FOCUS);
    const wide = byId(layers, "alerts-glow-wide").props;
    const fill = byId(layers, "alerts-fill").props;
    const edge = byId(layers, "alerts-edge").props;

    expect(wide.getColor(ring(ghost))[3]).toBe(0);
    expect(fill.getFillColor(ghost)[3]).toBe(0);
    // The one surviving pass: dim, and hairline rather than severity-scaled.
    expect(edge.getColor(ring(ghost))[3]).toBe(38);
    expect(edge.getWidth(ring(ghost))).toBe(1);
  });

  it("leaves the lit hazard exactly as it draws with no cycle at all", () => {
    const withCycle = alertsLayer([lit, ghost], true, FOCUS);
    const without = alertsLayer([lit, ghost], true, null);
    for (const id of AREA_IDS) {
      const a = byId(withCycle, id).props;
      const b = byId(without, id).props;
      expect(paint(a, lit)).toEqual(paint(b, lit));
    }
  });

  it("cross-fades: mid-step both types are half lit", () => {
    const mid = { ...FOCUS, prevHazard: "fire" as HazardType, fade: 0.5 };
    const fill = byId(alertsLayer([lit, ghost], true, mid), "alerts-fill").props;
    const full = byId(alertsLayer([lit, ghost], true, FOCUS), "alerts-fill").props;
    expect(fill.getFillColor(lit)[3]).toBeCloseTo(full.getFillColor(lit)[3] / 2);
    expect(fill.getFillColor(ghost)[3]).toBeCloseTo(full.getFillColor(lit)[3] / 2);
  });

  it("never ghosts the pinned on-air subject", () => {
    const pinned = { ...FOCUS, pinned: "fire" as HazardType };
    const fill = byId(alertsLayer([lit, ghost], true, pinned), "alerts-fill").props;
    expect(fill.getFillColor(ghost)[3]).toBeGreaterThan(0);
  });

  it("fades out a ghosted point-only badge entirely (it has no outline to keep)", () => {
    const layers = alertsLayer([point([30, 40], { hazard: "fire" })], true, FOCUS);
    const badge = byId(layers, "alerts-badge-core").props.data[0];
    expect(badge.lit).toBe(0);
    expect(byId(layers, "alerts-badge-core").props.getFillColor(badge)[3]).toBe(0);
  });

  it("keys every colour accessor on the focus so deck re-uploads on a step", () => {
    const a = byId(alertsLayer([lit, ghost], true, FOCUS), "alerts-fill").props;
    const b = byId(
      alertsLayer([lit, ghost], true, { ...FOCUS, hazard: "fire" as HazardType }),
      "alerts-fill",
    ).props;
    expect(a.updateTriggers.getFillColor).not.toEqual(b.updateTriggers.getFillColor);
  });
});

describe("onAirPulseLayers — matching tolerance", () => {
  // NB: alertRepPoint averages EVERY outer-ring vertex, including the repeated
  // closing point — so the square's rep point is [9.8, 19.8], not [10, 20].
  it("matches an alert within the ~0.5° tolerance and pulses its area", () => {
    // d² = 0.3² + 0.3² = 0.18 — inside ON_AIR_EPS2 (0.25).
    const layers = onAirPulseLayers([square()], [10.1, 20.1], 0);
    expect(visibleIds(layers)).toEqual(["alerts-onair-fill", "alerts-onair-edge"]);
  });

  it("falls back to the marker just outside the tolerance", () => {
    const layers = onAirPulseLayers([square()], [10.4, 19.8], 0); // d² = 0.36
    expect(visibleIds(layers)).toEqual(["alerts-onair-ping", "alerts-onair-dot"]);
  });

  it("a MultiPolygon is located by its FIRST part only (second-part framing misses)", () => {
    const twoPart = feature({
      type: "MultiPolygon",
      coordinates: [
        [[[9, 19], [11, 19], [11, 21], [9, 21], [9, 19]]], // centroid ≈ [10,20]
        [[[99, -1], [101, -1], [101, 1], [99, 1], [99, -1]]], // centroid ≈ [100,0]
      ],
    });
    expect(visibleIds(onAirPulseLayers([twoPart], [10, 20], 0))).toEqual(["alerts-onair-fill", "alerts-onair-edge"]);
    expect(visibleIds(onAirPulseLayers([twoPart], [100, 0], 0))).toEqual([
      "alerts-onair-ping",
      "alerts-onair-dot",
    ]);
  });
});

describe("onAirPulseLayers — the pulse rides GPU uniforms over constant attributes", () => {
  const HALF = 750; // half the 1500 ms period: breathe 0→1, ping 0→0.5

  it("breathes the on-air area on the GPU: static layers carrying a BreatheExtension spec", () => {
    const f = square();
    const rest = onAirPulseLayers([f], [10, 20], 0);
    const fill0 = byId(rest, "alerts-onair-fill").props;
    const edge0 = byId(rest, "alerts-onair-edge").props;
    // Attributes are constants baked at the breath's PEAK …
    expect(fill0.getFillColor).toEqual([...FLOOD, 150]);
    expect(edge0.getColor[3]).toBe(220);
    expect(edge0.getWidth).toBe(1.5);
    // … and the extension's spec takes them to the trough (fill alpha 40, edge
    // 1.5 px) and back over the period, with NO per-commit uniform in sight.
    expect(fill0.extensions).toEqual([BREATHE]);
    expect(fill0.breathe).toEqual({ periodMs: 1500, alpha: [40 / 150, 1] });
    expect(fill0.opacity).toBeUndefined();
    expect(edge0.extensions).toEqual([BREATHE]);
    expect(edge0.breathe).toEqual({ periodMs: 1500, size: [1, 5.5 / 1.5] });
    expect(edge0.widthScale).toBeUndefined();
    // The clock no longer changes the layers at all.
    const peak = onAirPulseLayers([f], [10, 20], HALF);
    expect(byId(peak, "alerts-onair-fill").props.breathe).toEqual(fill0.breathe);
    expect(byId(peak, "alerts-onair-edge").props.breathe).toEqual(edge0.breathe);
  });

  it("pulseIsPoint: an area on air needs no pulse loop, a point (or no match) does", () => {
    expect(pulseIsPoint([square()], [10, 20])).toBe(false);
    expect(pulseIsPoint([square()], [10.4, 19.8])).toBe(true);
    expect(pulseIsPoint([], [0, 0])).toBe(true);
  });

  it("hands deck the SAME data array every frame (a fresh one re-tessellates the whole polygon)", () => {
    const f = square();
    const a = byId(onAirPulseLayers([f], [10, 20], 0), "alerts-onair-fill").props.data;
    const b = byId(onAirPulseLayers([f], [10, 20], HALF), "alerts-onair-fill").props.data;
    expect(b).toBe(a);
    expect(a).toBe(polygonParts(f));
    const e0 = byId(onAirPulseLayers([f], [10, 20], 0), "alerts-onair-edge").props.data;
    expect(byId(onAirPulseLayers([f], [10, 20], HALF), "alerts-onair-edge").props.data).toBe(e0);
    const p0 = byId(onAirPulseLayers([], [30, 40], 0), "alerts-onair-ping").props.data;
    const p1 = byId(onAirPulseLayers([], [30, 40], HALF), "alerts-onair-dot").props.data;
    expect(p1).toBe(p0);
    // Nothing is keyed on `now`.
    for (const l of [...onAirPulseLayers([f], [10, 20], HALF), ...onAirPulseLayers([], [30, 40], HALF)]) {
      expect(l.props.updateTriggers ?? {}).toEqual({});
    }
  });

  it("expands and fades the sonar ring over the period", () => {
    const f = point([30, 40]);
    const at0 = byId(onAirPulseLayers([f], [30, 40], 0), "alerts-onair-ping").props;
    expect(at0.getRadius).toBe(1);
    expect(at0.radiusScale).toBeCloseTo(14);
    expect(at0.getLineColor[3]).toBe(230);
    expect(at0.opacity).toBeCloseTo(1);
    const atHalf = byId(onAirPulseLayers([f], [30, 40], HALF), "alerts-onair-ping").props;
    expect(atHalf.radiusScale).toBeCloseTo(52); // 14 + 76·0.5
    expect(atHalf.opacity).toBeCloseTo(0.5); // 230·(1−0.5) / 230
    expect(atHalf.lineWidthScale).toBeCloseTo(3.75 / 2.5);
  });

  it("breathes the core dot in the matched hazard's colour", () => {
    const f = point([30, 40]); // flood
    const at0 = byId(onAirPulseLayers([f], [30, 40], 0), "alerts-onair-dot").props;
    expect(at0.getFillColor).toEqual([...FLOOD, 230]);
    expect(at0.getRadius).toBe(6);
    expect(at0.radiusScale).toBeCloseTo(1);
    expect(at0.opacity).toBeCloseTo(150 / 230);
    const atHalf = byId(onAirPulseLayers([f], [30, 40], HALF), "alerts-onair-dot").props;
    expect(atHalf.radiusScale).toBeCloseTo(10 / 6);
    expect(atHalf.opacity).toBeCloseTo(1);
  });

  it("uses the fallback red when nothing matches the framing point", () => {
    const dot = byId(onAirPulseLayers([], [0, 0], 0), "alerts-onair-dot").props;
    expect(dot.getFillColor).toEqual([255, 95, 95, 230]);
  });

  it("uses the scene map-highlight colour for a point with no hazard polygon", () => {
    const dot = byId(onAirPulseLayers([], [0, 0], 0, [18, 52, 86]), "alerts-onair-dot").props;
    expect(dot.getFillColor).toEqual([18, 52, 86, 230]);
  });
});

describe("onAirPulseLayers — the area pair stays mounted", () => {
  // deck keeps a hidden layer's models, so luma keeps its shader pipelines: a
  // polygon cut then costs one tessellation, not a shader link on top.
  it("with nothing on air returns just the area pair, empty and hidden", () => {
    const layers = onAirPulseLayers([], null, 0);
    expect(ids(layers)).toEqual(["alerts-onair-fill", "alerts-onair-edge"]);
    expect(visibleIds(layers)).toEqual([]);
    expect(byId(layers, "alerts-onair-fill").props.data).toBe(NO_PARTS);
    expect(byId(layers, "alerts-onair-edge").props.data).toBe(NO_RINGS);
  });

  it("a point cut keeps the hidden area pair under the marker; an area cut draws no marker", () => {
    const pt = onAirPulseLayers([point([30, 40])], [30, 40], 0);
    expect(ids(pt)).toEqual(["alerts-onair-fill", "alerts-onair-edge", "alerts-onair-ping", "alerts-onair-dot"]);
    expect(visibleIds(pt)).toEqual(["alerts-onair-ping", "alerts-onair-dot"]);
    const area = onAirPulseLayers([square()], [10, 20], 0);
    expect(ids(area)).toEqual(["alerts-onair-fill", "alerts-onair-edge"]);
    expect(visibleIds(area)).toEqual(["alerts-onair-fill", "alerts-onair-edge"]);
  });

  it("the on-air fill is a direct SolidPolygonLayer and the edge a PathLayer, never GeoJsonLayer", () => {
    const f = square();
    const layers = onAirPulseLayers([f], [10, 20], 0);
    const fill = byId(layers, "alerts-onair-fill");
    const edge = byId(layers, "alerts-onair-edge");
    expect(fill).toBeInstanceOf(SolidPolygonLayer);
    expect(edge).toBeInstanceOf(PathLayer);
    expect(fill.props.getPolygon(fill.props.data[0])).toBe(fill.props.data[0]);
    // The edge strokes the same feature's rings, and hands deck the memoised ring list.
    expect(edge.props.data).toHaveLength(1);
    expect(edge.props.data[0].feature).toBe(f);
    expect(edge.props.getPath(edge.props.data[0])).toBe(edge.props.data[0].path);
  });
});
