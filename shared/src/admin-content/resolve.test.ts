import { mergeTextOverrides, pruneOverrides, isAdminEntityType } from "./types";
import { applyTextOverrides, entityIdOf } from "./resolve";
import { editableFieldKeys } from "./schema";

describe("mergeTextOverrides", () => {
  it("replaces only existing keys with non-empty values", () => {
    const base = { name: "Reykjavik", country: "Iceland", region: "" };
    const out = mergeTextOverrides(base, { name: "Reykjavík", country: "  ", missing: "x" });
    expect(out.name).toBe("Reykjavík"); // overridden
    expect(out.country).toBe("Iceland"); // blank override ignored → base kept
    expect((out as any).missing).toBeUndefined(); // key not on base and not allowed
  });

  it("allows keys the base lacks when passed as extraKeys", () => {
    const out = mergeTextOverrides({ name: "x" }, { note: "hi" }, ["note"]);
    expect((out as any).note).toBe("hi");
  });

  it("returns the base unchanged when there are no overrides", () => {
    const base = { name: "x" };
    expect(mergeTextOverrides(base, undefined)).toBe(base);
  });
});

describe("pruneOverrides", () => {
  it("drops empty/whitespace values and trims the rest", () => {
    expect(pruneOverrides({ a: "  hi ", b: "", c: "   " })).toEqual({ a: "hi" });
  });
});

describe("applyTextOverrides", () => {
  it("shallow-merges non-alert entities", () => {
    const city = { id: "c1", name: "Old", wikiExtract: "base blurb" };
    const out = applyTextOverrides("city", city, { name: "New", wikiExtract: "" });
    expect(out.name).toBe("New");
    expect(out.wikiExtract).toBe("base blurb"); // empty override falls back
  });

  it("applies alert overrides onto the primary info block", () => {
    const alert = {
      id: "a1",
      info: [{ event: "Flood", headline: "old", description: "old desc" }],
    };
    const out = applyTextOverrides("alert", alert, {
      headline: "New headline",
      instruction: "Stay indoors",
    });
    expect(out.info[0].headline).toBe("New headline");
    expect(out.info[0].event).toBe("Flood"); // untouched
    expect(out.info[0].instruction).toBe("Stay indoors"); // added
    // original object not mutated
    expect(alert.info[0].headline).toBe("old");
  });

  it("synthesises an info block for an alert that has none", () => {
    const out = applyTextOverrides("alert", { id: "a2", info: [] }, { headline: "H" });
    expect(out.info[0].headline).toBe("H");
  });
});

describe("entityIdOf", () => {
  it("reads each type's stable id field", () => {
    expect(entityIdOf("city", { id: "c1" })).toBe("c1");
    expect(entityIdOf("country", { countryId: "GB" })).toBe("GB");
    expect(entityIdOf("region", { regionId: "eu" })).toBe("eu");
    expect(entityIdOf("quake", { quakeId: "us7000" })).toBe("us7000");
    expect(entityIdOf("seismic", { key: "IU.ANMO.00.BHZ" })).toBe("IU.ANMO.00.BHZ");
    expect(entityIdOf("volcano", { id: "vc1" })).toBe("vc1");
  });
});

describe("schema", () => {
  it("exposes editable field keys per type", () => {
    expect(editableFieldKeys("quake")).toEqual(["place"]);
    expect(editableFieldKeys("alert")).toContain("headline");
  });
});

describe("isAdminEntityType", () => {
  it("guards known types", () => {
    expect(isAdminEntityType("city")).toBe(true);
    expect(isAdminEntityType("nope")).toBe(false);
    expect(isAdminEntityType(42)).toBe(false);
  });
});
