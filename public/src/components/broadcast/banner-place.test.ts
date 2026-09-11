import { placeLine, placeLineWidth, placeMaxWidth, PLACE_RIGHT_X } from "./banner-place";

const runsText = (line: ReturnType<typeof placeLine>) =>
  (line?.runs ?? []).map((r) => r.text).join("");

describe("placeMaxWidth", () => {
  it("gives the line everything left of the coordinate divider when there are no chips", () => {
    expect(placeMaxWidth([])).toBe(PLACE_RIGHT_X - 408);
  });

  it("shrinks as the channel chip grows", () => {
    expect(placeMaxWidth(["MAIN"])).toBeGreaterThan(placeMaxWidth(["TROPICAL WATCH"]));
  });
});

describe("placeLine", () => {
  const room = placeMaxWidth(["MAIN"]);

  it("says nothing at all when no country resolved", () => {
    expect(placeLine(null, room)).toBeNull();
    expect(placeLine({ lat: 0, lon: 0 }, room)).toBeNull();
    expect(placeLine({ lat: 0, lon: 0, country: "", continent: "Europe" }, room)).toBeNull();
  });

  it("reads LOC <CONTINENT> · <COUNTRY>, upper case", () => {
    const line = placeLine({ lat: 51, lon: 0, country: "United Kingdom", continent: "Europe" }, room);
    expect(runsText(line)).toBe("LOC EUROPE · UNITED KINGDOM");
    expect(line?.runs.map((r) => r.tone)).toEqual(["label", "muted", "text"]);
  });

  it("drops the continent when it just repeats the country", () => {
    const line = placeLine({ lat: -80, lon: 0, country: "Antarctica", continent: "Antarctica" }, room);
    expect(runsText(line)).toBe("LOC ANTARCTICA");
  });

  it("shows the country alone when the continent is unknown", () => {
    const line = placeLine({ lat: -53, lon: 73, country: "Heard I. and McDonald Is.", continent: null }, room);
    expect(runsText(line)).toBe("LOC HEARD I. AND MCDONALD IS.");
  });

  it("fits inside the room it is given, at a readable size", () => {
    for (const country of ["France", "United States", "Heard I. and McDonald Is."]) {
      const line = placeLine({ lat: 0, lon: 0, country, continent: "North America" }, room);
      expect(line).not.toBeNull();
      expect(placeLineWidth(line!)).toBeLessThanOrEqual(room + 0.001);
      expect(line!.size).toBeGreaterThanOrEqual(12);
      expect(line!.size).toBeLessThanOrEqual(16);
    }
  });

  it("drops the continent rather than shrinking when the room is tight", () => {
    const line = placeLine({ lat: 0, lon: 0, country: "Chad", continent: "Africa" }, 130);
    expect(runsText(line)).toBe("LOC CHAD");
    expect(placeLineWidth(line!)).toBeLessThanOrEqual(130.001);
  });

  it("says nothing at all when a long chip has eaten the row", () => {
    expect(placeMaxWidth(["TROPICAL CYCLONE WATCH"])).toBeLessThan(30);
    expect(placeLine({ lat: 0, lon: 0, country: "Chad", continent: "Africa" }, 30)).toBeNull();
  });
});
