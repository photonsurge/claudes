/**
 * The on-globe hazard cycle. What's worth pinning here is editorial, not
 * cosmetic: the cycle must stay inert when there's nothing to cycle, must never
 * ghost the warning a shot is ABOUT, and must land on the same step for every
 * client (an OBS scene and the operator preview drift apart the moment the index
 * stops being derived from the shared epoch clock).
 */
import { act, renderHook } from "@testing-library/react";
import { hazardsInView, litWeight, alertFocusKey, useAlertHazardStep } from "./alert-cycle";
import type { AlertFeature } from "./alerts";
import type { HazardType } from "./hazard";
import type { Segment } from "@photonsurge/shared/director";

/** Minimal drawable feature — hazard + severity are all the cycle reads. */
function feature(hazard: HazardType, severityRank = 2, population = 0): AlertFeature {
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
    properties: {
      id: `${hazard}-${severityRank}-${population}`,
      source: "test",
      identifier: "T-1",
      event: hazard,
      severityRank: severityRank as AlertFeature["properties"]["severityRank"],
      hazard,
      population,
    },
  };
}

/** A cut whose epoch is `now` — the same clock every client derives its step from. */
function stormCut(hazard: HazardType | undefined, spinEpoch: number): Segment {
  return {
    id: "storm:test",
    kind: "storm",
    title: "Test",
    subtitle: "",
    camera: { center: [0, 0], zoom: 4 },
    holdMs: 30_000,
    patch: { spinEpoch },
    hazard,
  } as Segment;
}

const CAMERA = { center: [0, 0] as [number, number], zoom: 3 };

/** Render the hook at a fixed wall-clock, so the derived step is deterministic. */
function stepAt(
  now: number,
  over: Partial<Parameters<typeof useAlertHazardStep>[0]> = {},
) {
  jest.setSystemTime(now);
  return renderHook(() =>
    useAlertHazardStep({
      alerts: [feature("wind", 3), feature("rain", 2), feature("snow-ice", 1)],
      enabled: true,
      camera: CAMERA,
      spinning: true, // whole-set: keeps these tests off the bbox geometry
      cut: null,
      dwellMs: 6000,
      ...over,
    }),
  );
}

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("hazardsInView", () => {
  it("orders by worst severity, then count, then id", () => {
    const list = hazardsInView([
      feature("rain", 1),
      feature("rain", 1),
      feature("wind", 4),
      feature("snow-ice", 1),
    ]);
    // wind is the most severe; rain outranks snow on count at equal severity.
    expect(list).toEqual(["wind", "rain", "snow-ice"]);
  });

  it("dedupes — a hazard drawn as ten shapes is still one step", () => {
    expect(hazardsInView([feature("wind"), feature("wind"), feature("wind")])).toEqual(["wind"]);
  });
});

describe("litWeight", () => {
  const focus = { hazard: "wind" as HazardType, prevHazard: null, fade: 1, pinned: null };

  it("lights the current hazard and ghosts everything else", () => {
    expect(litWeight(focus, "wind")).toBe(1);
    expect(litWeight(focus, "rain")).toBe(0);
  });

  it("cross-fades between the outgoing and incoming types", () => {
    const mid = { ...focus, prevHazard: "rain" as HazardType, fade: 0.5 };
    expect(litWeight(mid, "wind")).toBe(0.5);
    expect(litWeight(mid, "rain")).toBe(0.5);
    expect(litWeight(mid, "snow-ice")).toBe(0); // an uninvolved type stays ghosted throughout
  });

  it("never ghosts the pinned subject, whatever the step is", () => {
    const pinned = { ...focus, pinned: "flood" as HazardType };
    expect(litWeight(pinned, "flood")).toBe(1);
  });

  it("draws everything lit when there's no cycle", () => {
    expect(litWeight(null, "wind")).toBe(1);
  });
});

describe("useAlertHazardStep", () => {
  it("is inert with only one hazard type — nothing to cycle through", () => {
    const { result } = stepAt(0, { alerts: [feature("wind", 3), feature("wind", 1)] });
    expect(result.current).toBeNull();
  });

  it("is inert when the operator switches it off", () => {
    const { result } = stepAt(0, { enabled: false });
    expect(result.current).toBeNull();
  });

  it("opens on the most severe hazard and steps to the next after the dwell", () => {
    const { result, rerender } = stepAt(0);
    expect(result.current?.hazard).toBe("wind");
    // The opening step doesn't cross-fade — there's nothing to fade out of.
    expect(result.current?.fade).toBe(1);
    expect(result.current?.total).toBe(3);

    act(() => {
      jest.setSystemTime(6000);
      jest.advanceTimersByTime(100); // one tick — the clock is the source of truth
    });
    rerender();
    expect(result.current?.hazard).toBe("rain");
    expect(result.current?.prevHazard).toBe("wind"); // cross-fading out of the last type
  });

  it("wraps back round to the first hazard", () => {
    const { result, rerender } = stepAt(0);
    act(() => {
      jest.setSystemTime(18_000); // 3 dwells → back to index 0
      jest.advanceTimersByTime(100);
    });
    rerender();
    expect(result.current?.hazard).toBe("wind");
    expect(result.current?.index).toBe(0);
  });

  it("puts a storm's own hazard first and pins it lit for the whole shot", () => {
    const { result } = stepAt(0, { cut: stormCut("snow-ice", 0) });
    // `snow` is the LEAST severe here, so only the pin can put it on step 0.
    expect(result.current?.hazard).toBe("snow-ice");
    expect(result.current?.pinned).toBe("snow-ice");
    // …and it stays fully lit even while another type has the step.
    expect(litWeight({ ...result.current!, hazard: "wind" }, "snow-ice")).toBe(1);
  });

  it("pins nothing on a non-storm cut — a country shot is about the area, not one warning", () => {
    const cut = { ...stormCut("snow-ice", 0), kind: "country" } as Segment;
    const { result } = stepAt(0, { cut });
    expect(result.current?.pinned).toBeNull();
    expect(result.current?.hazard).toBe("wind"); // plain severity order
  });

  it("derives the same step for two clients off the cut's epoch", () => {
    const cut = stormCut(undefined, 100_000);
    // Two "clients" mounting at different moments of the same shot.
    const a = stepAt(107_000, { cut });
    const b = stepAt(107_500, { cut });
    expect(a.result.current?.index).toBe(b.result.current?.index);
    expect(a.result.current?.hazard).toBe(b.result.current?.hazard);
  });

  it("counts the step's shapes and the people under them", () => {
    const { result } = stepAt(0, {
      alerts: [feature("wind", 3, 1000), feature("wind", 3, 500), feature("rain", 2, 90)],
    });
    expect(result.current?.hazard).toBe("wind");
    expect(result.current?.count).toBe(2);
    expect(result.current?.people).toBe(1500);
  });

  it("keeps cycling when the alert poll hands back an equivalent fresh array", () => {
    const alerts = [feature("wind", 3), feature("rain", 2), feature("snow-ice", 1)];
    const { result, rerender } = stepAt(6000, { alerts });
    const before = result.current?.hazard;
    // A poll returns new objects for the same hazards — the sequence must not
    // restart (which would jump the shot back to step 0 for no reason).
    rerender();
    expect(result.current?.hazard).toBe(before);
    expect(result.current?.index).toBe(1);
  });
});

describe("alertFocusKey", () => {
  it("changes whenever the paint changes, so deck re-uploads colours", () => {
    const base = { hazard: "wind" as HazardType, prevHazard: null, fade: 1, pinned: null };
    expect(alertFocusKey(base)).not.toBe(alertFocusKey({ ...base, fade: 0.5 }));
    expect(alertFocusKey(base)).not.toBe(alertFocusKey({ ...base, hazard: "rain" as HazardType }));
    expect(alertFocusKey(null)).toBe("");
  });
});
