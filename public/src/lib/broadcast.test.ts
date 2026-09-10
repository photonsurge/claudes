import { nearby, nearest, GeoGrid } from "./geo";
import {
  quakeTicker,
  alertTicker,
  nearestNotableCity,
  nearbyCities,
  nearestCities,
  notableCities,
  trackTicker,
  volcanoTicker,
  hazardFilteredAlerts,
  buildTicker,
  dedupeAlerts,
  sortedAlerts,
  freshAlerts,
  issuedAgoLabel,
  expiresInLabel,
  alertDetail, dedupeSentences,
  topAlerts,
  topAlert,
  alertBannerText,
  alertSummary,
  scopeAlertsToBbox,
  scopeQuakesToBbox,
  scopeVolcanoesToBbox,
  scopeAlertsToRadius,
  scopeQuakesToRadius,
  scopeVolcanoesToRadius,
  EVENT_SCOPE_RADIUS_KM,
  worldWatchSummary,
  worldWatchFeed,
  weaveSponsors,
  sponsorLine,
} from "./broadcast";
import type { Alert, AlertFeature } from "./alerts";
import type { Quake, Track } from "./tracks/types";
import type { City } from "./cities";
import type { Volcano } from "@photonsurge/shared/volcanoes/types";

const quake = (over: Partial<Quake> = {}): Quake => ({
  id: "q1",
  mag: 5.9,
  place: "12km SSW of Somewhere",
  time: 0,
  lng: 10,
  lat: 20,
  depthKm: 10,
  ...over,
});

const volcano = (over: Partial<Volcano> = {}): Volcano => ({
  id: "gvp:1",
  name: "Etna",
  country: "Italy",
  lat: 37.75,
  lng: 15.0,
  status: "erupting",
  firstDate: 0,
  lastDate: 0,
  statusChangedAt: 0,
  ...over,
});

const alert = (rank: number, over: Partial<AlertFeature["properties"]> = {}): AlertFeature =>
  ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: {
      id: `a${rank}`,
      source: "test",
      identifier: "x",
      event: "Tsunami Watch",
      severityRank: rank as AlertFeature["properties"]["severityRank"],
      hazard: "tsunami" as AlertFeature["properties"]["hazard"],
      areaDesc: "Fiji Region",
      ...over,
    },
  }) as AlertFeature;

const track = (over: Partial<Track> = {}): Track =>
  ({ kind: "aircraft", name: "GLOBAL THUNDER-26", flag: "🇺🇸", ...over }) as Track;

describe("ticker line builders", () => {
  it("formats a quake with tsunami flag", () => {
    expect(quakeTicker(quake({ tsunami: true }))).toBe(
      "SEISMIC M5.9 · 12km SSW of Somewhere · TSUNAMI POTENTIAL",
    );
  });
  it("falls back to coords when a quake has no place", () => {
    expect(quakeTicker(quake({ place: undefined }))).toContain("20.0, 10.0");
  });
  it("prefixes an alert with its severity label", () => {
    expect(alertTicker(alert(3))).toBe("SEVERE: Tsunami Watch · Fiji Region");
  });
  it("prepends the nearest notable city's flag when cities are supplied", () => {
    const near = { id: "c", name: "Null Island City", lat: 0, lng: 0, cc: "FR", population: 5000 } as City;
    expect(alertTicker(alert(3), [near])).toBe("🇫🇷 SEVERE: Tsunami Watch · Fiji Region");
  });
  it("omits the flag when no notable city is within range", () => {
    const far = { id: "c", name: "Sydney", lat: -33.87, lng: 151.21, cc: "AU", population: 5_000_000 } as City;
    expect(alertTicker(alert(3), [far])).toBe("SEVERE: Tsunami Watch · Fiji Region");
  });
  it("flags by the NEAREST candidate, using the list as given (the crawl pre-filters)", () => {
    const hamlet = { id: "h", name: "Hamlet", lat: 0.2, lng: 0.2, cc: "GB" } as City;
    const city = { id: "c", name: "City", lat: 1, lng: 1, cc: "FR", population: 5000 } as City;
    const cities = [city, hamlet];
    expect(alertTicker(alert(3), cities)).toBe("🇬🇧 SEVERE: Tsunami Watch · Fiji Region");
    expect(alertTicker(alert(3), notableCities(cities))).toBe("🇫🇷 SEVERE: Tsunami Watch · Fiji Region");
    // The notable subset is memoised per input array, so grids key off one identity.
    expect(notableCities(cities)).toBe(notableCities(cities));
    expect(notableCities(cities)).toEqual([city]);
  });
  it("names the hazard itself rather than echoing the source bulletin", () => {
    expect(alertTicker(alert(3, { event: "台风红色预警", translatedHeadline: "Typhoon Red Alert" }))).toBe(
      "SEVERE: Tsunami Warning · Fiji Region",
    );
  });
  it("formats a track with flag + kind", () => {
    expect(trackTicker(track())).toBe("🇺🇸 GLOBAL THUNDER-26 · AIRCRAFT");
  });
  it("formats a volcano with status + country", () => {
    expect(volcanoTicker(volcano())).toBe("VOLCANO ERUPTING: Etna · Italy");
    expect(volcanoTicker(volcano({ status: "unrest", country: undefined }))).toBe(
      "VOLCANO UNREST: Etna",
    );
  });
});

describe("hazardFilteredAlerts", () => {
  it("returns the same array when the off-list is empty (stable memo key)", () => {
    const alerts = [alert(2)];
    expect(hazardFilteredAlerts(alerts, [])).toBe(alerts);
  });
  it("drops alerts whose hazard is on the off-list", () => {
    const keep = alert(2);
    const drop = alert(3, { hazard: "heat" as AlertFeature["properties"]["hazard"] });
    expect(hazardFilteredAlerts([keep, drop], ["heat"])).toEqual([keep]);
  });
});

describe("buildTicker", () => {
  it("orders seismic → volcanoes → alerts → tracks and de-dupes", () => {
    const items = buildTicker({
      quakes: [quake(), quake()], // identical → one line
      volcanoes: [volcano()],
      alerts: [alert(2)],
      tracks: [track()],
    });
    expect(items[0]).toContain("SEISMIC");
    expect(items[1]).toBe("VOLCANO ERUPTING: Etna · Italy");
    expect(items.some((i) => i.includes("Tsunami"))).toBe(true);
    expect(items.some((i) => i.includes("GLOBAL THUNDER"))).toBe(true);
    // The two identical quakes collapse to one.
    expect(items.filter((i) => i.startsWith("SEISMIC")).length).toBe(1);
  });
  it("skips dormant volcanoes", () => {
    expect(buildTicker({ volcanoes: [volcano({ status: "dormant" })] })).toEqual([]);
  });
  it("returns [] with no data", () => {
    expect(buildTicker({})).toEqual([]);
  });
});

describe("weaveSponsors", () => {
  it("leaves the feed untouched with no sponsors", () => {
    expect(weaveSponsors(["A", "B"], [])).toEqual(["A", "B"]);
  });

  it("returns the mentions alone with no live items", () => {
    expect(weaveSponsors([], ["Acme"])).toEqual([
      { text: "Sponsored by Acme", ad: true },
    ]);
  });

  it("spreads each sponsor once, evenly through the crawl", () => {
    const out = weaveSponsors(["A", "B", "C", "D"], ["S1", "S2"]);
    expect(out).toEqual([
      "A",
      "B",
      sponsorLine("S1"),
      "C",
      "D",
      sponsorLine("S2"),
    ]);
  });

  it("places every sponsor even when they outnumber the items", () => {
    const out = weaveSponsors(["A"], ["S1", "S2", "S3"]);
    expect(out.filter((e) => typeof e !== "string").length).toBe(3);
    expect(out.filter((e) => typeof e === "string")).toEqual(["A"]);
  });
});

describe("dedupeAlerts / topAlerts", () => {
  it("collapses the same area (multi-language repeats) keeping the most severe", () => {
    const de = alert(2, { event: "Heftige Gewitter", areaDesc: "Marthalen" });
    const fr = alert(4, { event: "Orages violents", areaDesc: "marthalen" }); // same area, higher sev
    const it = alert(1, { event: "Temporali", areaDesc: "MARTHALEN" });
    const other = alert(3, { areaDesc: "Fiji Region" });
    const deduped = dedupeAlerts([de, fr, it, other]);
    expect(deduped.length).toBe(2);
    // Marthalen kept at the most-severe (rank 4).
    const marthalen = deduped.find((a) => a.properties.areaDesc?.toLowerCase() === "marthalen");
    expect(marthalen?.properties.severityRank).toBe(4);
  });
  it("returns top N by severity", () => {
    const list = topAlerts([alert(1), alert(4, { areaDesc: "A" }), alert(2, { areaDesc: "B" })], 2);
    expect(list.map((a) => a.properties.severityRank)).toEqual([4, 2]);
  });
  it("sortedAlerts keeps the whole list, most-severe first (no cap)", () => {
    const list = sortedAlerts([
      alert(1, { areaDesc: "A" }),
      alert(4, { areaDesc: "B" }),
      alert(2, { areaDesc: "C" }),
    ]);
    expect(list.map((a) => a.properties.severityRank)).toEqual([4, 2, 1]);
  });
});

describe("freshAlerts", () => {
  const NOW = Date.parse("2026-07-10T12:00:00Z");
  const at = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();

  it("keeps alerts issued within the window and drops older ones", () => {
    const list = freshAlerts(
      [
        alert(4, { areaDesc: "Fresh", sent: at(20) }),
        alert(2, { areaDesc: "Stale", sent: at(90) }), // >60m → gone even though active
        alert(3, { areaDesc: "Edge", sent: at(59) }),
      ],
      60,
      NOW,
    );
    expect(list.map((a) => a.properties.areaDesc).sort()).toEqual(["Edge", "Fresh"]);
  });

  it("falls back to `since` when no issue time is present, and drops undated alerts", () => {
    const list = freshAlerts(
      [
        alert(3, { areaDesc: "BySince", sent: undefined, since: at(10) }),
        alert(3, { areaDesc: "Undated", sent: undefined, since: undefined }),
      ],
      60,
      NOW,
    );
    expect(list.map((a) => a.properties.areaDesc)).toEqual(["BySince"]);
  });

  it("respects a custom window", () => {
    const list = freshAlerts([alert(3, { areaDesc: "A", sent: at(20) })], 10, NOW);
    expect(list).toHaveLength(0);
  });
});

describe("issuedAgoLabel", () => {
  const NOW = Date.parse("2026-07-10T12:00:00Z");
  const at = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();
  it("formats minutes, hours, and just-now", () => {
    expect(issuedAgoLabel(at(0), NOW)).toBe("just now");
    expect(issuedAgoLabel(at(12), NOW)).toBe("12m ago");
    expect(issuedAgoLabel(at(63), NOW)).toBe("1h 3m ago");
    expect(issuedAgoLabel(at(120), NOW)).toBe("2h ago");
  });
  it("returns empty for a missing/unparseable timestamp", () => {
    expect(issuedAgoLabel(undefined, NOW)).toBe("");
    expect(issuedAgoLabel("not-a-date", NOW)).toBe("");
  });
});

describe("expiresInLabel", () => {
  const NOW = Date.parse("2026-07-10T12:00:00Z");
  const inMins = (m: number) => new Date(NOW + m * 60_000).toISOString();
  it("formats minutes, hours and days", () => {
    expect(expiresInLabel(inMins(45), NOW)).toBe("45m");
    expect(expiresInLabel(inMins(180), NOW)).toBe("3h");
    expect(expiresInLabel(inMins(60 * 72), NOW)).toBe("3d");
  });
  it("returns empty for a lapsed, missing or unparseable expiry", () => {
    expect(expiresInLabel(inMins(-5), NOW)).toBe("");
    expect(expiresInLabel(undefined, NOW)).toBe("");
    expect(expiresInLabel("not-a-date", NOW)).toBe("");
  });
});

describe("dedupeSentences", () => {
  it("drops only whole repeated sentences, keeping decimals and short fragments intact", () => {
    expect(dedupeSentences("Waves of 1.5 m expected. Waves of 1.5 m expected. Stay ashore!")).toBe(
      "Waves of 1.5 m expected. Stay ashore!",
    );
    // Matching is case/punctuation-insensitive; short fragments (e.g. abbreviations) never count.
    expect(dedupeSentences("Take care near rivers. take care near rivers! Avoid low roads, e.g. underpasses, e.g. tunnels."))
      .toBe("Take care near rivers. Avoid low roads, e.g. underpasses, e.g. tunnels.");
    expect(dedupeSentences("no terminator at all")).toBe("no terminator at all");
  });
});

describe("alertDetail", () => {
  it("prefers the source's advice, translated where there is a translation", () => {
    expect(alertDetail(alert(3, { instruction: "Move to higher ground." }).properties))
      .toEqual({ label: "OFFICIAL ADVICE", text: "Move to higher ground." });
    expect(
      alertDetail(alert(3, { instruction: "Nach oben.", translatedInstruction: "Move up." }).properties),
    ).toEqual({ label: "OFFICIAL ADVICE", text: "Move up." });
  });

  it("collapses advice a source repeats verbatim", () => {
    const twice =
      "Do not go out in a small boat: High risk of dangerous situations when in a small boat at sea. " +
      "Do not go out in a small boat: High risk of dangerous situations when in a small boat at sea. " +
      "If the boat is small, stay ashore.";
    expect(alertDetail(alert(3, { instruction: twice }).properties)?.text).toBe(
      "Do not go out in a small boat: High risk of dangerous situations when in a small boat at sea. " +
        "If the boat is small, stay ashore.",
    );
  });

  it("falls back to a headline that adds something the card has not said", () => {
    const p = alert(3, { headline: "Waves of up to four metres expected along the coast" }).properties;
    expect(alertDetail(p, "Fiji Region")).toEqual({
      label: "DETAILS",
      text: "Waves of up to four metres expected along the coast",
    });
  });

  it("prints nothing when the alert carries no usable body copy", () => {
    // A headline restating the title/area, a too-short one, and none at all —
    // each leaves the card to shrink rather than opening an empty section.
    expect(alertDetail(alert(3, { headline: "TSUNAMI WATCH — FIJI REGION" }).properties, "Fiji Region")).toBeNull();
    expect(alertDetail(alert(3, { headline: "Tsunami watch" }).properties, "Fiji Region")).toBeNull();
    expect(alertDetail(alert(3).properties, "Fiji Region")).toBeNull();
  });
});

describe("alertSummary", () => {
  it("counts distinct alerts by severity and hazard, quakes separately", () => {
    const s = alertSummary(
      [
        alert(4, { areaDesc: "A", hazard: "fire" as any }),
        alert(4, { areaDesc: "a", hazard: "fire" as any, event: "Feu" }), // same area+hazard → 1
        alert(3, { areaDesc: "B", hazard: "flood" as any }),
        alert(2, { areaDesc: "C", hazard: "fire" as any }),
      ],
      [quake(), quake()],
    );
    expect(s.total).toBe(3); // A/fire, B/flood, C/fire (the duplicate A collapsed)
    expect(s.quakeCount).toBe(2);
    // Severity buckets, most severe first.
    expect(s.bySeverity[0].rank).toBe(4);
    expect(s.bySeverity.find((b) => b.rank === 4)?.count).toBe(1);
    // Hazard buckets, most common first: fire (2) before flood (1).
    expect(s.byHazard[0].hazard).toBe("fire");
    expect(s.byHazard[0].count).toBe(2);
  });
  it("is empty with no hazards", () => {
    const s = alertSummary([], []);
    expect(s.total).toBe(0);
    expect(s.bySeverity).toEqual([]);
    expect(s.byHazard).toEqual([]);
    expect(s.volcanoCount).toBe(0);
  });

  it("counts erupting/unrest volcanoes but excludes dormant ones", () => {
    const s = alertSummary(
      [],
      [],
      [volcano({ status: "erupting" }), volcano({ id: "gvp:2", status: "unrest" }), volcano({ id: "gvp:3", status: "dormant" })],
    );
    expect(s.volcanoCount).toBe(2);
  });
});

describe("scopeAlertsToBbox / scopeQuakesToBbox", () => {
  // Roughly Portugal's mainland bbox.
  const portugal: [number, number, number, number] = [-9.6, 36.8, -6.1, 42.2];

  it("keeps only alerts whose representative point falls inside the bbox", () => {
    const inside = { ...alert(3, { areaDesc: "Lisboa" }), geometry: { type: "Point", coordinates: [-9.14, 38.72] } };
    const outside = { ...alert(3, { areaDesc: "Paris" }), geometry: { type: "Point", coordinates: [2.35, 48.86] } };
    expect(scopeAlertsToBbox([inside, outside], portugal)).toEqual([inside]);
  });

  it("drops alerts with no derivable representative point", () => {
    const noGeometry = { ...alert(2), geometry: { type: "Point", coordinates: [] } } as AlertFeature;
    expect(scopeAlertsToBbox([noGeometry], portugal)).toEqual([]);
  });

  it("keeps only quakes inside the bbox", () => {
    const inside = quake({ id: "in", lng: -9.14, lat: 38.72 });
    const outside = quake({ id: "out", lng: 2.35, lat: 48.86 });
    expect(scopeQuakesToBbox([inside, outside], portugal)).toEqual([inside]);
  });

  it("keeps only volcanoes inside the bbox", () => {
    const inside = volcano({ id: "in", lng: -9.14, lat: 38.72 });
    const outside = volcano({ id: "out", lng: 2.35, lat: 48.86 });
    expect(scopeVolcanoesToBbox([inside, outside], portugal)).toEqual([inside]);
  });
});

describe("scopeAlertsToRadius / scopeQuakesToRadius / scopeVolcanoesToRadius", () => {
  // Etna (Sicily). ~500km reaches Naples/Tunis but not Rome (~550km) or Athens.
  const center: [number, number] = [15.0, 37.75];

  it("keeps a quake within the radius and drops one beyond it", () => {
    const near = quake({ id: "near", lng: 15.6, lat: 38.1 }); // ~60km
    const far = quake({ id: "far", lng: 23.7, lat: 37.98 }); // Athens, ~765km
    expect(scopeQuakesToRadius([near, far], center)).toEqual([near]);
  });

  it("keeps a volcano within the radius and drops one beyond it", () => {
    const near = volcano({ id: "near", lng: 14.43, lat: 40.82 }); // Vesuvius, ~340km
    const far = volcano({ id: "far", lng: 25.4, lat: 36.4 }); // Santorini, ~930km
    expect(scopeVolcanoesToRadius([near, far], center)).toEqual([near]);
  });

  it("keeps an alert whose rep point is inside and drops geometry-less ones", () => {
    const near = { ...alert(3), geometry: { type: "Point", coordinates: [15.6, 38.1] } };
    const far = { ...alert(3), geometry: { type: "Point", coordinates: [23.7, 37.98] } };
    const noGeo = { ...alert(2), geometry: { type: "Point", coordinates: [] } } as AlertFeature;
    expect(scopeAlertsToRadius([near, far, noGeo], center)).toEqual([near]);
  });

  it("honours a custom radius argument", () => {
    const q = quake({ id: "q", lng: 23.7, lat: 37.98 }); // ~765km away
    expect(scopeQuakesToRadius([q], center, 100)).toEqual([]);
    expect(scopeQuakesToRadius([q], center, 1000)).toEqual([q]);
  });

  it("defaults to the 500km event scope", () => {
    expect(EVENT_SCOPE_RADIUS_KM).toBe(500);
  });
});

describe("worldWatchSummary", () => {
  const raw = (rank: number, over: Partial<Alert> = {}): Alert =>
    ({
      id: over.id ?? `a${rank}-${Math.random()}`,
      source: "test",
      identifier: "x",
      sender: "s",
      sent: "2026-07-02T00:00:00Z",
      msgType: "Alert",
      status: "Actual",
      active: true,
      maxSeverityRank: rank as Alert["maxSeverityRank"],
      info: [],
      ...over,
    }) as Alert;

  it("buckets active alerts by severity (non-zero, most severe first) and totals them", () => {
    const s = worldWatchSummary(
      [raw(4), raw(3), raw(3), raw(0), raw(2)],
      [quake({ mag: 4.1 }), quake({ mag: 6.3, place: "off Japan" })],
    );
    expect(s.alertTotal).toBe(5); // rank-0 still counts toward the total…
    // …but is dropped from the severity breakdown.
    expect(s.bySeverity.map((b) => [b.rank, b.count])).toEqual([
      [4, 1],
      [3, 2],
      [2, 1],
    ]);
    expect(s.quakeCount).toBe(2);
    expect(s.byMagClass.map((b) => [b.cls, b.count])).toEqual([
      ["strong", 1], // 6.3
      ["light", 1], // 4.1
    ]);
    expect(s.maxMag).toBe(6.3);
    expect(s.maxQuake?.place).toBe("off Japan");
  });

  it("counts a cross-source cluster once (keeps the representative)", () => {
    const rep = raw(4, { id: "g1", groupId: "g1" });
    const member = raw(4, { id: "g1-member", groupId: "g1" });
    const solo = raw(2, { id: "solo" }); // no groupId → passes through
    const s = worldWatchSummary([rep, member, solo], []);
    expect(s.alertTotal).toBe(2);
  });

  it("is quiet with no data", () => {
    const s = worldWatchSummary([], []);
    expect(s).toMatchObject({
      alertTotal: 0,
      bySeverity: [],
      quakeCount: 0,
      maxMag: 0,
      maxQuake: null,
      byContinent: [],
    });
  });

  /**
   * Placing an alert needs a POINT, and the panel gets one of two ways: off the
   * polygon, or from the server's precomputed `repPoint`.
   *
   * This used to be a hard blocker on the whole-planet feed — ~20MB, 60% of it
   * coordinates, carried so the client could take one point off each ring. The
   * route now answers that question before it strips the rings, so `omitCoordinates`
   * is usable here. These two tests are the before and after, and the first still
   * matters: a stripped alert with NO repPoint doesn't throw, it silently vanishes
   * from the breakdown it belongs in.
   */
  const strippedAlert = (over: Record<string, unknown> = {}) =>
    raw(4, {
      id: "eu1",
      info: [
        {
          event: "Storm",
          severityRank: 4,
          // Exactly what ?omitCoordinates=1 returns: the type, no coordinates.
          area: [{ areaDesc: "Spain", geometry: { type: "Polygon" } as never, geocodes: [] }],
        },
      ],
      ...over,
    });

  it("silently drops an alert that has neither coordinates nor a repPoint", () => {
    const s = worldWatchSummary([strippedAlert()], []);

    // Silent, which is what makes it dangerous — no throw, just a missing bar.
    expect(s.byContinent).toEqual([]);
  });

  it("places a stripped alert from the server's repPoint — the 60% payload cut", () => {
    const s = worldWatchSummary([strippedAlert({ repPoint: [-3, 40] })], []);

    expect(s.byContinent.map((c) => c.continent)).toEqual(["Europe"]);
    expect(s.byContinent[0].alertCount).toBe(1);
  });

  it("prefers the real polygon when it's there — the two feeds must agree", () => {
    // The full-geometry feed sends no repPoint; the stripped one sends no rings.
    // If both ever arrived, the shape is the source of truth.
    const both = raw(4, {
      id: "eu2",
      repPoint: [-3, 40], // Spain
      info: [
        {
          event: "Storm",
          severityRank: 4,
          area: [{ areaDesc: "Japan", geometry: { type: "Point", coordinates: [139, 35] }, geocodes: [] }],
        },
      ],
    });

    const s = worldWatchSummary([both], []);

    expect(s.byContinent.map((c) => c.continent)).toEqual(["Asia"]);
  });

  it("buckets alerts and quakes by continent, busiest first", () => {
    const spain = raw(4, {
      id: "eu1",
      info: [
        {
          event: "Storm",
          severityRank: 4,
          area: [{ areaDesc: "Spain", geometry: { type: "Point", coordinates: [-3, 40] }, geocodes: [] }],
        },
      ],
    });
    // Geocode-only NWS alert has no geometry — falls back to the source's home region.
    const nws = raw(3, { id: "us1", source: "nws" });
    const s = worldWatchSummary(
      [spain, nws],
      [quake({ id: "q1", lng: -3, lat: 40 }), quake({ id: "q2", lng: -3, lat: 40 })],
    );
    expect(s.byContinent[0]).toMatchObject({ continent: "Europe", alertCount: 1, quakeCount: 2, total: 3 });
    expect(s.byContinent[0].bySeverity).toEqual([{ rank: 4, label: "Extreme", color: "#ef4444", count: 1 }]);
    expect(s.byContinent[0].byMagClass).toEqual([
      { cls: "moderate", label: "Moderate", color: "#eab308", count: 2 }, // both quakes default to mag 5.9
    ]);
    expect(s.byContinent.find((c) => c.continent === "North America")).toMatchObject({
      alertCount: 1,
      quakeCount: 0,
      total: 1,
      bySeverity: [{ rank: 3, label: "Severe", color: "#f97316", count: 1 }],
      byMagClass: [],
    });
  });

  it("counts erupting/unrest volcanoes but excludes dormant ones", () => {
    const s = worldWatchSummary(
      [],
      [],
      [volcano({ status: "erupting" }), volcano({ id: "gvp:2", status: "unrest" }), volcano({ id: "gvp:3", status: "dormant" })],
    );
    expect(s.volcanoCount).toBe(2);
    expect(s.byVolcanoStatus).toEqual([
      { status: "erupting", label: "Erupting", color: "#ef4444", count: 1 },
      { status: "unrest", label: "Unrest", color: "#f97316", count: 1 },
    ]);
  });

  it("folds active volcanoes into the per-continent tally, dormant excluded", () => {
    const s = worldWatchSummary(
      [],
      [],
      [
        volcano({ id: "gvp:1", status: "erupting", lng: 15, lat: 37.75 }), // Europe
        volcano({ id: "gvp:2", status: "dormant", lng: 15, lat: 37.75 }), // Europe, but excluded
      ],
    );
    const europe = s.byContinent.find((c) => c.continent === "Europe");
    expect(europe).toMatchObject({ volcanoCount: 1, total: 1 });
    expect(europe?.byVolcanoStatus).toEqual([{ status: "erupting", label: "Erupting", color: "#ef4444", count: 1 }]);
  });
});

describe("worldWatchFeed", () => {
  const raw = (rank: number, event: string, area: string, over: Partial<Alert> = {}): Alert =>
    ({
      id: over.id ?? `${event}-${area}`,
      source: "test",
      identifier: "x",
      sender: "s",
      sent: "2026-07-02T00:00:00Z",
      msgType: "Alert",
      status: "Actual",
      active: true,
      maxSeverityRank: rank as Alert["maxSeverityRank"],
      info: [{ event, severityRank: rank, area: [{ areaDesc: area, geocodes: [] }] }],
      ...over,
    }) as Alert;

  it("lists alerts and quakes, most-serious first, with a big quake above minor alerts", () => {
    const feed = worldWatchFeed(
      [raw(4, "Tornado Warning", "Kansas"), raw(1, "Frost Advisory", "Alps")],
      [quake({ id: "big", mag: 7.2, place: "off Chile" }), quake({ id: "sm", mag: 3.1 })],
    );
    expect(feed.map((f) => f.kind)).toEqual(["alert", "quake", "alert", "quake"]);
    // Extreme alert (rank 4) and M7.2 both weight 4 — alert wins the tie, quake next.
    expect(feed[0]).toMatchObject({ kind: "alert", title: "Tornado Emergency", sub: "Kansas" });
    expect(feed[1]).toMatchObject({ kind: "quake", tag: "M7.2", title: "off Chile" });
    // Then the rank-1 advisory, then the M3.1 minnow.
    expect(feed[2].title).toBe("Frost");
    expect(feed[3].tag).toBe("M3.1");
  });

  it("classifies a non-English alert through its translation, then names it itself", () => {
    const translated = raw(4, "台风红色预警", "Guangdong", {
      info: [{ event: "台风红色预警", severityRank: 4, area: [{ areaDesc: "Guangdong", geocodes: [] }], translatedHeadline: "Typhoon Red Alert" }] as Alert["info"],
    });
    const feed = worldWatchFeed([translated], []);
    // Chinese event text alone classifies as `other`; the translation makes it a
    // cyclone, and the phrasebook — not the bulletin — supplies the on-air name.
    expect(feed[0].title).toBe("Super Typhoon");
  });

  it("orders same-tier quakes by exact magnitude, not arrival order", () => {
    // All three land in the same 4.5-4.99 bucket — before the continuous-weight
    // fix these tied and fell back to insertion order regardless of magnitude.
    const feed = worldWatchFeed(
      [],
      [
        quake({ id: "a", mag: 4.5 }),
        quake({ id: "b", mag: 4.7 }),
        quake({ id: "c", mag: 4.6 }),
      ],
    );
    expect(feed.map((f) => f.tag)).toEqual(["M4.7", "M4.6", "M4.5"]);
  });

  it("flags tsunami quakes and counts a cross-source cluster once", () => {
    const rep = raw(3, "Storm", "A", { id: "g1", groupId: "g1" });
    const member = raw(3, "Sturm", "A", { id: "g1-m", groupId: "g1" });
    const feed = worldWatchFeed([rep, member], [quake({ id: "t", mag: 6.5, tsunami: true })]);
    expect(feed.filter((f) => f.kind === "alert").length).toBe(1);
    expect(feed.find((f) => f.kind === "quake")?.sub).toBe("TSUNAMI POTENTIAL");
  });

  it("is empty with no data", () => {
    expect(worldWatchFeed([], [])).toEqual([]);
  });

  const city = (over: Partial<City> = {}): City =>
    ({ id: "c1", name: "Paris", lat: 48.85, lng: 2.35, cc: "FR", population: 2_100_000, ...over }) as City;

  const withPoint = (a: Alert, lng: number, lat: number): Alert => ({
    ...a,
    info: a.info.map((i) => ({
      ...i,
      area: i.area.map((ar) => ({ ...ar, geometry: { type: "Point", coordinates: [lng, lat] } })),
    })),
  });

  it("classifies the hazard mark and flags the nearest enriched city", () => {
    const wildfire = withPoint(raw(4, "Forest Fire Warning", "Île-de-France"), 2.3, 48.86);
    const feed = worldWatchFeed([wildfire], [], [city()]);
    expect(feed[0].glyph).toBe("fire");
    expect(feed[0].flag).toBe("🇫🇷");
  });

  it("leaves the flag empty when no city is within range", () => {
    const alertRow = withPoint(raw(4, "Tornado Warning", "Kansas"), -98, 39);
    const feed = worldWatchFeed([alertRow], [], [city({ lat: -33.87, lng: 151.21, cc: "AU" })]);
    expect(feed[0].flag).toBe("");
  });

  it("flags a quake by its own coordinates, independent of any alert", () => {
    const feed = worldWatchFeed([], [quake({ lat: 48.85, lng: 2.35 })], [city()]);
    expect(feed[0].glyph).toBe("quake");
    expect(feed[0].flag).toBe("🇫🇷");
  });

  it("names up to two nearby notable cities, nearest first", () => {
    const wildfire = withPoint(raw(4, "Forest Fire Warning", "Île-de-France"), 2.3, 48.86);
    const feed = worldWatchFeed(
      [wildfire],
      [],
      [
        city({ id: "versailles", name: "Versailles", lat: 48.8, lng: 2.13 }),
        city({ id: "paris", name: "Paris", lat: 48.85, lng: 2.35 }),
        city({ id: "reims", name: "Reims", lat: 49.26, lng: 4.03 }),
      ],
    );
    expect(feed[0].sub).toBe("Île-de-France · near Paris, Versailles");
  });

  it("ignores tiny, non-notable places for names/flag/photo", () => {
    const wildfire = withPoint(raw(4, "Forest Fire Warning", "Île-de-France"), 2.3, 48.86);
    const hamlet = city({ id: "hamlet", name: "Tinytown", lat: 48.86, lng: 2.31, population: 0, isCapital: false });
    const feed = worldWatchFeed([wildfire], [], [hamlet]);
    expect(feed[0].flag).toBe("");
    expect(feed[0].sub).toBe("Île-de-France");
  });

  it("picks a photo from the nearest notable city that has one", () => {
    const wildfire = withPoint(raw(4, "Forest Fire Warning", "Île-de-France"), 2.3, 48.86);
    const feed = worldWatchFeed(
      [wildfire],
      [],
      [
        city({ id: "paris", name: "Paris", lat: 48.85, lng: 2.35 }),
        city({ id: "versailles", name: "Versailles", lat: 48.8, lng: 2.13, wikiThumb: "https://example.com/versailles.jpg" }),
      ],
    );
    expect(feed[0].photo).toBe("https://example.com/versailles.jpg");
  });

  it("has no photo when no nearby city carries one", () => {
    const wildfire = withPoint(raw(4, "Forest Fire Warning", "Île-de-France"), 2.3, 48.86);
    const feed = worldWatchFeed([wildfire], [], [city()]);
    expect(feed[0].photo).toBeUndefined();
  });

  it("carries an expiry countdown for alerts that have one, omitting it otherwise", () => {
    const withExpiry = raw(4, "Forest Fire Warning", "Île-de-France", {
      expiresAt: "2099-01-01T00:00:00Z",
    });
    const withoutExpiry = raw(2, "Frost Advisory", "Alps");
    const feed = worldWatchFeed([withExpiry, withoutExpiry], []);
    expect(feed.find((f) => f.title === "Extreme Fire Danger")?.expiresIn).toMatch(/^(in \d+[mh]|expired)$/);
    expect(feed.find((f) => f.title === "Frost")?.expiresIn).toBeUndefined();
  });

  it("includes erupting/unrest volcanoes, ranked above minor alerts, but drops dormant ones", () => {
    const feed = worldWatchFeed(
      [raw(1, "Frost Advisory", "Alps")],
      [],
      [],
      [
        volcano({ id: "gvp:1", status: "erupting" }),
        volcano({ id: "gvp:2", name: "Merapi", status: "unrest" }),
        volcano({ id: "gvp:3", name: "Fuji", status: "dormant" }),
      ],
    );
    expect(feed.map((f) => f.kind)).toEqual(["volcano", "volcano", "alert"]);
    expect(feed.find((f) => f.title === "Fuji")).toBeUndefined();
    const erupting = feed.find((f) => f.title === "Etna")!;
    expect(erupting).toMatchObject({ kind: "volcano", tag: "ERUPTING", color: "#ef4444", glyph: "volcano" });
  });

  it("is empty with no data (including no volcanoes)", () => {
    expect(worldWatchFeed([], [], [], [])).toEqual([]);
  });
});

describe("topAlert / alertBannerText", () => {
  it("picks the most severe alert", () => {
    const top = topAlert([alert(1), alert(4), alert(2)]);
    expect(top?.properties.severityRank).toBe(4);
  });
  it("is null with no alerts", () => {
    expect(topAlert([])).toBeNull();
  });
  it("prefers a source level label when present", () => {
    expect(alertBannerText(alert(2, { level: "Yellow" }))).toBe(
      "Tsunami Watch: Fiji Region — YELLOW",
    );
  });
  it("caps a sprawling areaDesc but keeps the severity suffix intact", () => {
    const long =
      "R.M. of Edenwold including Balgonie and Piapot Res.; R.M. of North Qu'Appelle including Fort Qu'Appelle";
    const text = alertBannerText(alert(4, { areaDesc: long, level: "Red" }));
    expect(text.endsWith(" — RED")).toBe(true);
    expect(text).toContain("…");
    // area portion (between ": " and " — ") stays within the 40-char cap
    const area = text.slice(text.indexOf(": ") + 2, text.lastIndexOf(" — "));
    expect(area.length).toBeLessThanOrEqual(41); // 40 + ellipsis
  });
});

describe("nearestNotableCity", () => {
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const cities = Array.from({ length: 600 }, (_, i) => ({
    id: `c${i}`,
    name: `City ${i}`,
    lng: -180 + rnd() * 360,
    lat: -90 + rnd() * 180,
    cc: "FR",
    population: i % 3 === 0 ? 0 : 1000 + i,
    isCapital: i % 50 === 0,
  })) as City[];
  const pt = (c: City): [number, number] => [c.lng, c.lat];

  it("answers exactly what the linear scan over the notable subset answers", () => {
    const points: [number, number][] = [[0, 51.5], [-140, -50], [179.9, 3], [-179.9, 3], [20, 89], [-100, -89], [120, 15]];
    for (const p of points) {
      const expected = nearest(notableCities(cities), p, pt);
      const got = nearestNotableCity(cities, p);
      expect(got?.item).toBe(expected?.item);
      expect(got?.distanceKm).toBe(expected?.distanceKm);
    }
  });

  it("widens the ring until it finds landfall, and keeps the first of equal distances", () => {
    const few = [
      { id: "far", name: "Far", lng: 170, lat: -60, cc: "NZ", population: 10 },
      { id: "twinA", name: "A", lng: 1, lat: 0, cc: "FR", population: 10 },
      { id: "twinB", name: "B", lng: -1, lat: 0, cc: "FR", population: 10 },
      { id: "hamlet", name: "H", lng: -139, lat: -49, cc: "PN" },
    ] as City[];
    // Point Nemo-ish: nothing notable within thousands of km → the far city.
    expect(nearestNotableCity(few, [-123, -48])?.item.id).toBe("far");
    expect(nearestNotableCity(few, [-123, -48])).toEqual(nearest(notableCities(few), [-123, -48], pt));
    expect(nearestNotableCity(few, [0, 0])?.item.id).toBe("twinA");
    expect(nearestNotableCity([], [0, 0])).toBeNull();
    expect(nearestNotableCity([few[3]], [0, 0])).toBeNull();
  });
});

describe("nearbyCities / nearestCities (grid-backed)", () => {
  let seed = 23;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const cities = Array.from({ length: 800 }, (_, i) => ({
    id: `c${i}`,
    name: `City ${i}`,
    lng: -180 + rnd() * 360,
    lat: -90 + rnd() * 180,
    cc: "FR",
    population: i % 4 === 0 ? 0 : (i % 7) * 20_000,
    isCapital: i % 90 === 0,
  })) as City[];
  const pt = (c: City): [number, number] => [c.lng, c.lat];
  const sizeable = (c: City) => (c.population ?? 0) >= 50_000 || !!c.isCapital;
  const centres: [number, number][] = [[0, 51.5], [-140, -50], [179.9, 3], [20, 88], [120, 15]];

  it("nearbyCities equals nearby() over the filtered list, in order", () => {
    for (const c of centres) {
      for (const r of [300, 1500]) {
        const expected = nearby(cities.filter(sizeable), c, pt, r);
        const got = nearbyCities(cities, c, r, sizeable);
        expect(got.map((n) => n.item.id)).toEqual(expected.map((n) => n.item.id));
        expect(got.map((n) => n.distanceKm)).toEqual(expected.map((n) => n.distanceKm));
      }
      expect(nearbyCities(cities, c, 500).map((n) => n.item.id)).toEqual(nearby(cities, c, pt, 500).map((n) => n.item.id));
    }
    expect(nearbyCities([], [0, 0], 500)).toEqual([]);
  });

  it("caches the scan per list/point/radius: a repeat call, or the same call with a different `keep`, doesn't re-scan the grid; a different list does", () => {
    const scan = jest.spyOn(GeoGrid.prototype, "nearby");
    try {
      const c: [number, number] = [10, 45];
      nearbyCities(cities, c, 800, sizeable);
      const calls = scan.mock.calls.length;
      expect(calls).toBeGreaterThan(0);
      // Same list/point/radius, no `keep`: cache hit, no new scan — but a
      // different, unfiltered answer (sizeable cities are a subset of all).
      const unfiltered = nearbyCities(cities, c, 800);
      expect(scan.mock.calls.length).toBe(calls);
      expect(unfiltered.length).toBeGreaterThan(nearbyCities(cities, c, 800, sizeable).length);
      // A fresh call site's own closure for the same predicate: still a hit.
      nearbyCities(cities, c, 800, (city) => sizeable(city));
      expect(scan.mock.calls.length).toBe(calls);
      // A different radius, or a different list (even with identical content),
      // is a real scan.
      nearbyCities(cities, c, 900, sizeable);
      expect(scan.mock.calls.length).toBeGreaterThan(calls);
      const calls2 = scan.mock.calls.length;
      nearbyCities([...cities], c, 800, sizeable);
      expect(scan.mock.calls.length).toBeGreaterThan(calls2);
    } finally {
      scan.mockRestore();
    }
  });

  it("nearestCities equals the sphere-wide scan's first k", () => {
    for (const c of centres) {
      for (const k of [1, 10, 40]) {
        const expected = nearby(cities.filter(sizeable), c, pt, 20_100).slice(0, k);
        const got = nearestCities(cities, c, k, sizeable);
        expect(got.map((n) => n.item.id)).toEqual(expected.map((n) => n.item.id));
      }
    }
    // Sparse list: rings must widen past the first ones to fill k.
    const few = cities.slice(0, 12);
    expect(nearestCities(few, [0, 0], 5).map((n) => n.item.id)).toEqual(nearby(few, [0, 0], pt, 20_100).slice(0, 5).map((n) => n.item.id));
    expect(nearestCities(cities, [0, 0], 0)).toEqual([]);
  });
});
