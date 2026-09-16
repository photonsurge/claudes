import {
  areaPlaceLabel,
  buildAlertNarrative,
  hasNarrativeProse,
  splitAreaDesc,
  MAX_NARRATIVE_AREAS,
} from "./narrative";

/** The real shape of the WMO Saudi bulletin that started this: one areaDesc
 *  holding every governorate, each with a trailing qualifier. */
const WMO_AREA =
  "Asir region - Abha : The entire governorate; Asir region - Ahad Rufaydah : The entire governorate; Asir region - Khamis Mushait : The entire governorate";

describe("splitAreaDesc", () => {
  it("splits a semicolon dump back into the list it always was", () => {
    expect(splitAreaDesc(WMO_AREA)).toEqual([
      "Asir region - Abha : The entire governorate",
      "Asir region - Ahad Rufaydah : The entire governorate",
      "Asir region - Khamis Mushait : The entire governorate",
    ]);
  });

  it("takes newlines too, drops blanks, and de-dupes case-insensitively", () => {
    expect(splitAreaDesc("Kraków\n\nKRAKÓW ; Gdańsk ;;")).toEqual(["Kraków", "Gdańsk"]);
  });

  it("returns a one-entry list for a plain area and nothing for an empty one", () => {
    expect(splitAreaDesc("Central y Valles Mineros")).toEqual(["Central y Valles Mineros"]);
    expect(splitAreaDesc(undefined)).toEqual([]);
    expect(splitAreaDesc("  ")).toEqual([]);
  });
});

describe("areaPlaceLabel", () => {
  it("names the first area and counts the rest, trimming the per-entry qualifier", () => {
    expect(areaPlaceLabel(WMO_AREA)).toEqual({ label: "Asir region - Abha", more: 2 });
  });

  it("leaves a plain single area exactly as it was (the old subtitle)", () => {
    expect(areaPlaceLabel("Central y Valles Mineros")).toEqual({
      label: "Central y Valles Mineros",
      more: 0,
    });
  });

  it("keeps a colon that is part of a name, not a label seam", () => {
    expect(areaPlaceLabel("Region 1:2").label).toBe("Region 1:2");
  });

  it("cuts an over-long lead at a word boundary", () => {
    const long = `${"Lorem ipsum ".repeat(12)}end`;
    const { label } = areaPlaceLabel(long);
    expect(label!.length).toBeLessThanOrEqual(66);
    expect(label!.endsWith("…")).toBe(true);
    expect(label).not.toMatch(/\s…$/);
  });

  it("has nothing to say about an absent areaDesc", () => {
    expect(areaPlaceLabel(undefined)).toEqual({ more: 0 });
  });
});

describe("buildAlertNarrative", () => {
  it("prefers the translation but falls back to an ALREADY-ENGLISH source's own words", () => {
    // The bug this exists to stop: translated* is left empty for English feeds,
    // so a reader of translatedDescription alone shows a blank card.
    const n = buildAlertNarrative({
      headline: "Extreme Rainfall",
      description: "Heavy rain expected, 40-60mm in 24 hours.",
      instruction: "Avoid valleys and wadis.",
      translatedHeadline: "",
      translatedDescription: "",
      translatedInstruction: "",
      area: [{ areaDesc: WMO_AREA }],
    })!;
    expect(n.description).toBe("Heavy rain expected, 40-60mm in 24 hours.");
    expect(n.instruction).toBe("Avoid valleys and wadis.");
    expect(n.translated).toBe(false);
    expect(n.language).toBeUndefined();
    expect(n.areas).toHaveLength(3);
    expect(n.areaCount).toBe(3);
  });

  it("uses the translation, and says which language it came from, when one exists", () => {
    const n = buildAlertNarrative({
      headline: "أمطار غزيرة",
      description: "الوصف",
      translatedHeadline: "Heavy rainfall",
      translatedDescription: "Heavy rain expected.",
      detectedLanguage: "ar",
    })!;
    expect(n.headline).toBe("Heavy rainfall");
    expect(n.description).toBe("Heavy rain expected.");
    expect(n.translated).toBe(true);
    expect(n.language).toBe("ar");
  });

  it("gathers areas across every area block and caps the list while counting them all", () => {
    const area = Array.from({ length: 20 }, (_, i) => ({ areaDesc: `County ${i}` }));
    const n = buildAlertNarrative({ description: "x", area })!;
    expect(n.areas).toHaveLength(MAX_NARRATIVE_AREAS);
    expect(n.areaCount).toBe(20);
    expect(n.areas[0]).toBe("County 0");
  });

  it("counts a place named by two area blocks once", () => {
    const n = buildAlertNarrative({ description: "x", area: [{ areaDesc: "Kraków" }, { areaDesc: "kraków" }] })!;
    expect(n.areaCount).toBe(1);
  });

  it("is null for a block that says nothing at all", () => {
    expect(buildAlertNarrative({ headline: "", description: "", area: [] })).toBeNull();
    expect(buildAlertNarrative(undefined)).toBeNull();
  });

  it("survives a block that only names areas (no prose) — but that earns no slide", () => {
    const n = buildAlertNarrative({ area: [{ areaDesc: "Kraków" }] })!;
    expect(n.areaCount).toBe(1);
    expect(hasNarrativeProse(n)).toBe(false);
    expect(hasNarrativeProse(buildAlertNarrative({ description: "Heavy rain." }))).toBe(true);
    expect(hasNarrativeProse(null)).toBe(false);
  });
});

/**
 * The rest of what a CAP message tells us and the deck never showed: who
 * actually issued it, how urgent they say it is, and how sure they are.
 */
describe("buildAlertNarrative — the message's own metadata", () => {
  it("carries the issuing authority, urgency, certainty and categories", () => {
    const n = buildAlertNarrative(
      {
        description: "Heavy rain.",
        urgency: "Immediate",
        certainty: "Observed",
        category: ["Met", "Marine"],
        web: "https://ncm.gov.sa/x",
      },
      { sender: "Saudi Arabia National Center for Meteorology", msgType: "Alert" },
    )!;
    expect(n.sender).toBe("Saudi Arabia National Center for Meteorology");
    expect(n.urgency).toBe("Immediate");
    expect(n.certainty).toBe("Observed");
    expect(n.categories).toEqual(["Met", "Marine"]);
    expect(n.web).toBe("https://ncm.gov.sa/x");
  });

  it("drops CAP's 'Unknown' placeholder rather than airing it as a value", () => {
    const n = buildAlertNarrative({
      description: "x",
      urgency: "Unknown",
      certainty: "unknown",
      category: ["Unknown", "Met"],
    })!;
    expect(n.urgency).toBeUndefined();
    expect(n.certainty).toBeUndefined();
    expect(n.categories).toEqual(["Met"]);
  });

  it("badges an update or a cancellation, but not a plain first bulletin", () => {
    const of = (msgType: string) => buildAlertNarrative({ description: "x" }, { msgType })!.msgType;
    expect(of("Alert")).toBeUndefined();
    expect(of("Update")).toBe("Update");
    expect(of("Cancel")).toBe("Cancel");
    expect(buildAlertNarrative({ description: "x" })!.msgType).toBeUndefined();
  });

  it("leaves the metadata absent when the message carries none", () => {
    const n = buildAlertNarrative({ description: "x" })!;
    expect(n.sender).toBeUndefined();
    expect(n.categories).toEqual([]);
  });
});
