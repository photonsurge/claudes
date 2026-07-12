import {
  pointToSegment,
  quakeToSegment,
  alertFeatureToSegment,
  volcanoToSegment,
} from "./select-segment";
import type { Quake } from "@photonsurge/shared/tracks/types";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import type { AlertFeature } from "./alerts";

describe("pointToSegment", () => {
  it("frames a plain clicked coordinate as a sandbox 'point' shot", () => {
    const seg = pointToSegment(-122.42, 37.77, "San Francisco", "12 km W");
    expect(seg.kind).toBe("point");
    expect(seg.id).toBe("point:-122.420,37.770"); // id rounds to 3 dp
    expect(seg.title).toBe("San Francisco");
    expect(seg.subtitle).toBe("12 km W");
    expect(seg.camera).toEqual({ center: [-122.42, 37.77], zoom: 5 });
    expect(seg.patch).toEqual({});
    expect(seg.holdMs).toBe(0);
  });

  it("omits the subtitle when none is given", () => {
    expect(pointToSegment(0, 0, "Null Island").subtitle).toBeUndefined();
  });
});

describe("quakeToSegment", () => {
  const quake: Quake = {
    id: "us7000abcd",
    mag: 6.2,
    place: "24 km SSW of Somewhere",
    time: Date.parse("2026-07-10T00:00:00Z"),
    lng: -70.7,
    lat: -33.4,
    depthKm: 15,
    tsunami: false,
  };
  const seg = quakeToSegment(quake);

  it("maps a quake onto a 'quake' segment with the shared frame", () => {
    expect(seg.id).toBe("quake:us7000abcd");
    expect(seg.kind).toBe("quake");
    expect(seg.camera).toEqual({ center: [-70.7, -33.4], zoom: 5 });
    expect(seg.quake).toEqual({ mag: 6.2, depthKm: 15 });
    expect(seg.patch).toEqual({});
    expect(seg.holdMs).toBe(0);
    expect(seg.title).toBeTruthy(); // content comes from the shared builder
  });

  it("carries the tsunami flag through", () => {
    expect(seg.tsunami).toBe(false);
    expect(quakeToSegment({ ...quake, tsunami: true }).tsunami).toBe(true);
  });
});

describe("alertFeatureToSegment", () => {
  const feature = (geometry: AlertFeature["geometry"]): AlertFeature => ({
    type: "Feature",
    geometry,
    properties: {
      id: "abc",
      source: "nws",
      identifier: "URN-oid-2.49.0.1.840.0.xyz",
      event: "Tornado Warning",
      severityRank: 4,
      hazard: "tornado",
      areaDesc: "Some County",
      level: "Extreme",
      since: "2026-07-10T00:00:00Z",
    },
  });
  // Square ring [0,0]..[2,2] → centroid of its 5 vertices is (0.8, 0.8).
  const square: AlertFeature["geometry"] = {
    type: "Polygon",
    coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
  };

  it("maps an alert onto a 'storm' segment framed on the polygon centroid", () => {
    const seg = alertFeatureToSegment(feature(square))!;
    expect(seg).not.toBeNull();
    expect(seg.id).toBe("storm:nws:URN-oid-2.49.0.1.840.0.xyz");
    expect(seg.kind).toBe("storm");
    expect(seg.camera).toEqual({ center: [0.8, 0.8], zoom: 4.5 });
    expect(seg.patch).toEqual({});
    expect(seg.holdMs).toBe(0);
    expect(seg.title).toBeTruthy();
  });

  it("returns null when the geometry has no usable centroid", () => {
    expect(alertFeatureToSegment(feature({ type: "Polygon", coordinates: [] }))).toBeNull();
  });
});

describe("volcanoToSegment", () => {
  const volcano: Volcano = {
    id: "211060",
    name: "Etna",
    country: "Italy",
    lat: 37.75,
    lng: 14.99,
    status: "erupting",
    firstDate: Date.parse("2026-07-01T00:00:00Z"),
    lastDate: Date.parse("2026-07-10T00:00:00Z"),
    statusChangedAt: Date.parse("2026-07-05T00:00:00Z"),
    latestReport: "Strombolian activity continued at the summit craters.",
  };

  it("maps a volcano onto a 'volcano' segment sharing the director's id + frame", () => {
    const seg = volcanoToSegment(volcano);
    expect(seg.id).toBe("volcano:211060"); // same id an auto-directed cut uses
    expect(seg.kind).toBe("volcano");
    expect(seg.camera).toEqual({ center: [14.99, 37.75], zoom: 5 });
    expect(seg.patch).toEqual({});
    expect(seg.holdMs).toBe(0);
    // Reuses the notable-tracks TrackInfo card (populated once enriched/reporting).
    expect(seg.trackInfo?.label).toBe("Etna");
    expect(seg.title).toBeTruthy();
  });

  it("omits the TrackInfo card for an un-enriched, non-reporting volcano", () => {
    const bare = { ...volcano, latestReport: undefined };
    expect(volcanoToSegment(bare).trackInfo).toBeUndefined();
  });
});
