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
    GeoJsonLayer: class extends MockLayer {},
    ScatterplotLayer: class extends MockLayer {},
    TextLayer: class extends MockLayer {},
  };
});

import { alertsLayer, onAirPulseLayers } from "./alerts";
import type { AlertFeature } from "../../lib/alerts";
import type { SeverityRank } from "@photonsurge/shared/db/alert-model";
import type { HazardType } from "../../lib/hazard";

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

const AREA_IDS = ["alerts-glow-wide", "alerts-glow-mid", "alerts-fill", "alerts-edge"];
const BADGE_IDS = ["alerts-badge-halo", "alerts-badge-core", "alerts-badge-glyph"];

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
    expect(wide.getLineWidth(rank0)).toBe(6);
    expect(wide.getLineWidth(rank4)).toBe(18);
    const edge = byId(layers, "alerts-edge").props;
    expect(edge.getLineWidth(rank0)).toBeCloseTo(1.6);
    expect(edge.getLineWidth(rank4)).toBeCloseTo(3.0);
  });

  it("the outline stays stronger than the fill — it is what carries the shape", () => {
    // Lightening the fill without this is how a big blob becomes invisible.
    const layers = alertsLayer([rank4]);
    const edgeAlpha = byId(layers, "alerts-edge").props.getLineColor(rank4)[3];
    const fillAlpha = byId(layers, "alerts-fill").props.getFillColor(rank4)[3];

    expect(edgeAlpha).toBeGreaterThan(fillAlpha * 3);
  });

  it("glow strokes are the hazard colour lightened toward white, faint outside, bright edge", () => {
    const f = square(); // flood
    const layers = alertsLayer([f]);
    // lighten(FLOOD, 0.35) @ alpha 26.
    expect(byId(layers, "alerts-glow-wide").props.getLineColor(f)).toEqual([126, 212, 250, 26]);
    // lighten(FLOOD, 0.55) @ alpha 240 — the crisp lit edge.
    expect(byId(layers, "alerts-edge").props.getLineColor(f)).toEqual([165, 225, 252, 240]);
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

describe("onAirPulseLayers — matching tolerance", () => {
  // NB: alertRepPoint averages EVERY outer-ring vertex, including the repeated
  // closing point — so the square's rep point is [9.8, 19.8], not [10, 20].
  it("matches an alert within the ~0.5° tolerance and pulses its area", () => {
    // d² = 0.3² + 0.3² = 0.18 — inside ON_AIR_EPS2 (0.25).
    const layers = onAirPulseLayers([square()], [10.1, 20.1], 0);
    expect(ids(layers)).toEqual(["alerts-onair-fill"]);
  });

  it("falls back to the marker just outside the tolerance", () => {
    const layers = onAirPulseLayers([square()], [10.4, 19.8], 0); // d² = 0.36
    expect(ids(layers)).toEqual(["alerts-onair-ping", "alerts-onair-dot"]);
  });

  it("a MultiPolygon is located by its FIRST part only (second-part framing misses)", () => {
    const twoPart = feature({
      type: "MultiPolygon",
      coordinates: [
        [[[9, 19], [11, 19], [11, 21], [9, 21], [9, 19]]], // centroid ≈ [10,20]
        [[[99, -1], [101, -1], [101, 1], [99, 1], [99, -1]]], // centroid ≈ [100,0]
      ],
    });
    expect(ids(onAirPulseLayers([twoPart], [10, 20], 0))).toEqual(["alerts-onair-fill"]);
    expect(ids(onAirPulseLayers([twoPart], [100, 0], 0))).toEqual([
      "alerts-onair-ping",
      "alerts-onair-dot",
    ]);
  });
});

describe("onAirPulseLayers — pulse phase (now drives every accessor)", () => {
  const HALF = 750; // half the 1500 ms period: breathe 0→1, ping 0→0.5

  it("breathes the on-air area: fill alpha 40→150, edge width 1.5→5.5", () => {
    const f = square();
    const rest = byId(onAirPulseLayers([f], [10, 20], 0), "alerts-onair-fill").props;
    expect(rest.getFillColor()).toEqual([...FLOOD, 40]);
    expect(rest.getLineWidth()).toBeCloseTo(1.5);
    expect(rest.updateTriggers.getFillColor).toBe(0);
    const peak = byId(onAirPulseLayers([f], [10, 20], HALF), "alerts-onair-fill").props;
    expect(peak.getFillColor()).toEqual([...FLOOD, 150]);
    expect(peak.getLineWidth()).toBeCloseTo(5.5);
    expect(peak.updateTriggers.getFillColor).toBe(HALF);
  });

  it("expands and fades the sonar ring over the period", () => {
    const f = point([30, 40]);
    const at0 = byId(onAirPulseLayers([f], [30, 40], 0), "alerts-onair-ping").props;
    expect(at0.getRadius()).toBeCloseTo(14);
    expect(at0.getLineColor()[3]).toBe(230);
    const atHalf = byId(onAirPulseLayers([f], [30, 40], HALF), "alerts-onair-ping").props;
    expect(atHalf.getRadius()).toBeCloseTo(52); // 14 + 76·0.5
    expect(atHalf.getLineColor()[3]).toBe(115); // 230·(1−0.5)
    expect(atHalf.getLineWidth()).toBeCloseTo(3.75);
  });

  it("breathes the core dot in the matched hazard's colour", () => {
    const f = point([30, 40]); // flood
    const at0 = byId(onAirPulseLayers([f], [30, 40], 0), "alerts-onair-dot").props;
    expect(at0.getRadius()).toBeCloseTo(6);
    expect(at0.getFillColor()).toEqual([...FLOOD, 150]);
    const atHalf = byId(onAirPulseLayers([f], [30, 40], HALF), "alerts-onair-dot").props;
    expect(atHalf.getRadius()).toBeCloseTo(10);
    expect(atHalf.getFillColor()).toEqual([...FLOOD, 230]);
  });

  it("uses the fallback red when nothing matches the framing point", () => {
    const dot = byId(onAirPulseLayers([], [0, 0], 0), "alerts-onair-dot").props;
    expect(dot.getFillColor()).toEqual([255, 95, 95, 150]);
  });
});
