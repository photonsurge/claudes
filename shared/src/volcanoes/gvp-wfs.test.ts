import {
  parseGvpVolcanoes,
  parseGvpEruptions,
  parseRockTypes,
  gvpFuzzyDate,
  formatGvpDate,
  gvpWfsUrl,
  GVP_LAYER_HOLOCENE,
} from "./gvp-wfs";

// Trimmed real-shape samples captured live from the GVP WFS (2026-07-15).
const HOLOCENE = {
  type: "FeatureCollection",
  totalFeatures: 1196,
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [123.585, -7.791] },
      properties: {
        Volcano_Number: 264260,
        Volcano_Name: "Tara, Batu",
        Volcanic_Landform: "Composite",
        Primary_Volcano_Type: "Stratovolcano",
        Last_Eruption_Year: 2015,
        Country: "Indonesia",
        Region: "Sunda-Banda Volcanic Regions",
        Subregion: "Sunda Volcanic Arc",
        Geological_Summary: "The small isolated island of Batu Tara in the Flores Sea.",
        Latitude: -7.791,
        Longitude: 123.585,
        Elevation: 633,
        Tectonic_Setting: "Subduction zone / Oceanic crust (< 15 km)",
        Geologic_Epoch: "Holocene",
        Evidence_Category: "Eruption Observed",
        Primary_Photo_Link: "https://volcano.si.edu/gallery/photos/GVP-06345.jpg",
        Primary_Photo_Caption: "Batu Tara, seen here from the SE.",
        Primary_Photo_Credit: "Photo by O. Rukman, 1981.",
        Major_Rock_Type: "Trachybasalt / Tephrite Basanite",
      },
    },
  ],
};

// Pleistocene rows carry only a SUBSET of the columns — no type/photo/rock/eruption year.
const PLEISTOCENE = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [114.653, -8.226] },
      properties: {
        Volcano_Number: 264830,
        Volcano_Name: "Merbuk",
        Volcanic_Landform: "Unknown",
        Primary_Volcano_Type: "Unknown",
        Country: "Indonesia",
        Region: "Sunda-Banda Volcanic Regions",
        Subregion: "Sunda Volcanic Arc",
        Geological_Summary: "Merbuk is mapped as a Quaternary volcano.",
        Latitude: -8.226,
        Longitude: 114.653,
        Elevation: 1359,
        Geologic_Epoch: "Pleistocene",
      },
    },
  ],
};

describe("parseGvpVolcanoes", () => {
  it("maps the full Holocene row onto the canonical gvp: id", () => {
    const [v] = parseGvpVolcanoes(HOLOCENE);
    expect(v.volcanoId).toBe("gvp:264260");
    expect(v.name).toBe("Tara, Batu");
    expect(v.lat).toBeCloseTo(-7.791);
    expect(v.lng).toBeCloseTo(123.585);
    expect(v.country).toBe("Indonesia");
    expect(v.elevationM).toBe(633);
    expect(v.volcanoType).toBe("Stratovolcano");
    expect(v.volcanicLandform).toBe("Composite");
    expect(v.tectonicSetting).toBe("Subduction zone / Oceanic crust (< 15 km)");
    expect(v.geologicEpoch).toBe("Holocene");
    expect(v.evidenceCategory).toBe("Eruption Observed");
    expect(v.majorRockTypes).toEqual(["Trachybasalt", "Tephrite Basanite"]);
    expect(v.lastEruptionYear).toBe(2015);
    expect(v.geologicalSummary).toContain("Flores Sea");
    expect(v.primaryPhotoUrl).toContain("GVP-06345.jpg");
    expect(v.sourceUrl).toBe("https://volcano.si.edu/volcano.cfm?vn=264260");
  });

  it("tolerates the Pleistocene subset (missing type/photo/rock/eruption year)", () => {
    const [v] = parseGvpVolcanoes(PLEISTOCENE);
    expect(v.volcanoId).toBe("gvp:264830");
    expect(v.geologicEpoch).toBe("Pleistocene");
    expect(v.elevationM).toBe(1359);
    expect(v.lastEruptionYear).toBeUndefined();
    expect(v.majorRockTypes).toBeUndefined();
    expect(v.primaryPhotoUrl).toBeUndefined();
    expect(v.tectonicSetting).toBeUndefined();
  });

  it("skips rows with no id/name/coords and tolerates junk", () => {
    expect(parseGvpVolcanoes({ features: [{ properties: {} }] })).toEqual([]);
    expect(parseGvpVolcanoes(null)).toEqual([]);
    expect(parseGvpVolcanoes({})).toEqual([]);
  });
});

describe("parseRockTypes", () => {
  it("splits on slashes", () => {
    expect(parseRockTypes("Andesite / Basaltic Andesite")).toEqual(["Andesite", "Basaltic Andesite"]);
  });
  it("returns undefined for empty/absent", () => {
    expect(parseRockTypes("")).toBeUndefined();
    expect(parseRockTypes(null)).toBeUndefined();
  });
});

describe("gvpFuzzyDate — GVP's sentinels and BCE years", () => {
  it("treats month/day 0 as UNKNOWN, not January/day-0", () => {
    const d = gvpFuzzyDate(1936, 0, 0)!;
    expect(d.year).toBe(1936);
    expect(d.month).toBeUndefined();
    expect(d.day).toBeUndefined();
    expect(d.precision).toBe("year");
  });

  it("keeps a real month/day and reports day precision", () => {
    const d = gvpFuzzyDate(1936, 6, 18)!;
    expect(d).toMatchObject({ year: 1936, month: 6, day: 18, precision: "day" });
  });

  it("degrades to month precision when the day is unknown", () => {
    expect(gvpFuzzyDate(1936, 6, 0)!.precision).toBe("month");
  });

  it("ignores a day that has no month (meaningless)", () => {
    const d = gvpFuzzyDate(1936, 0, 18)!;
    expect(d.day).toBeUndefined();
    expect(d.precision).toBe("year");
  });

  it("preserves BCE (negative) years rather than corrupting them", () => {
    const d = gvpFuzzyDate(-55500, 0, 0)!;
    expect(d.year).toBe(-55500);
    expect(d.precision).toBe("year");
  });

  it("carries the ? / < / > modifier and uncertainty", () => {
    expect(gvpFuzzyDate(1500, 0, 0, "?", 50)).toMatchObject({ modifier: "?", uncertaintyYears: 50 });
  });

  it("returns undefined with no year (absent end dates)", () => {
    expect(gvpFuzzyDate(null, 0, 0)).toBeUndefined();
  });
});

describe("formatGvpDate", () => {
  it("renders each precision", () => {
    expect(formatGvpDate({ year: 2015, precision: "year" })).toBe("2015");
    expect(formatGvpDate({ year: 1936, month: 6, precision: "month" })).toBe("Jun 1936");
    expect(formatGvpDate({ year: 1936, month: 6, day: 18, precision: "day" })).toBe("18 Jun 1936");
  });
  it("renders BCE and the ? qualifier", () => {
    expect(formatGvpDate({ year: -1500, precision: "year" })).toBe("1500 BCE");
    expect(formatGvpDate({ year: 1500, precision: "year", modifier: "?" })).toBe("1500?");
  });
});

describe("parseGvpEruptions", () => {
  const ERUPTIONS = {
    features: [
      {
        properties: {
          Volcano_Number: 242010,
          Volcano_Name: "Curtis Island",
          Eruption_Number: 14679,
          Activity_Type: "Uncertain Eruption",
          ExplosivityIndexMax: null,
          StartDateYear: 1936,
          StartDateMonth: 6,
          StartDateDay: 18,
          EndDateYear: 1936,
          EndDateMonth: 12,
          EndDateDay: 16,
          StartEvidenceMethod: "Observations: Reported",
        },
      },
      {
        properties: {
          Volcano_Number: 211060,
          Volcano_Name: "Vesuvius",
          Eruption_Number: 12345,
          Activity_Type: "Confirmed Eruption",
          ExplosivityIndexMax: 5,
          StartDateYear: 79,
          StartDateMonth: 0,
          StartDateDay: 0,
          EndDateYear: null,
          StartEvidenceMethod: "Observations: Reported",
        },
      },
    ],
  };

  it("maps eruptions, VEI and confirmation", () => {
    const [a, b] = parseGvpEruptions(ERUPTIONS);
    expect(a.volcanoId).toBe("gvp:242010");
    expect(a.eruptionNumber).toBe(14679);
    expect(a.confirmed).toBe(false);
    expect(a.vei).toBeUndefined();
    expect(a.start).toMatchObject({ year: 1936, month: 6, day: 18, precision: "day" });
    expect(a.end).toMatchObject({ year: 1936, month: 12, day: 16 });

    expect(b.confirmed).toBe(true);
    expect(b.vei).toBe(5);
    // Year 79 CE must survive as 79 — not be re-based to 1979 by a Date constructor.
    expect(b.start).toMatchObject({ year: 79, precision: "year" });
    expect(b.end).toBeUndefined(); // null EndDateYear (~56% of rows)
  });

  it("skips rows without a volcano/eruption number or start year", () => {
    expect(parseGvpEruptions({ features: [{ properties: { Volcano_Number: 1 } }] })).toEqual([]);
    expect(parseGvpEruptions(null)).toEqual([]);
  });
});

describe("gvpWfsUrl", () => {
  it("builds a GeoJSON GetFeature request", () => {
    const u = gvpWfsUrl(GVP_LAYER_HOLOCENE);
    expect(u).toContain("request=GetFeature");
    expect(u).toContain("outputFormat=application%2Fjson");
    expect(u).toContain(encodeURIComponent(GVP_LAYER_HOLOCENE));
    expect(u).not.toContain("count=");
    expect(gvpWfsUrl(GVP_LAYER_HOLOCENE, 5)).toContain("count=5");
  });
});
