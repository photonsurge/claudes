import { classifyHazard } from "./hazard";

describe("classifyHazard", () => {
  it("uses MeteoAlarm awareness_type code", () => {
    expect(classifyHazard({ event: "Extrémně vysoké teploty", parameters: { awareness_type: "5; high-temperature" } })).toBe("heat");
    expect(classifyHazard({ event: "x", parameters: { awareness_type: "3; thunderstorm" } })).toBe("thunderstorm");
    expect(classifyHazard({ event: "x", parameters: { awareness_type: "11; flood" } })).toBe("flood");
  });

  it("uses GDACS event code", () => {
    expect(classifyHazard({ event: "Tropical Cyclone", parameters: { gdacsEventType: "TC" } })).toBe("cyclone");
    expect(classifyHazard({ event: "Wildfire", parameters: { gdacsEventType: "WF" } })).toBe("fire");
  });

  it("keyword-matches NWS event text", () => {
    expect(classifyHazard({ event: "Excessive Heat Warning" })).toBe("heat");
    expect(classifyHazard({ event: "Flash Flood Warning" })).toBe("flood");
    expect(classifyHazard({ event: "Winter Storm Warning" })).toBe("snow-ice");
    expect(classifyHazard({ event: "Red Flag Warning" })).toBe("fire");
    expect(classifyHazard({ event: "High Wind Warning" })).toBe("wind");
  });

  it("separates tornado from thunderstorm, and marine/coastal", () => {
    expect(classifyHazard({ event: "Tornado Warning" })).toBe("tornado");
    expect(classifyHazard({ event: "Severe Thunderstorm Warning" })).toBe("thunderstorm");
    expect(classifyHazard({ event: "Small Craft Advisory" })).toBe("marine");
    expect(classifyHazard({ event: "Gale Warning" })).toBe("marine");
    expect(classifyHazard({ event: "Hazardous Seas Warning" })).toBe("marine");
    expect(classifyHazard({ event: "Beach Hazards Statement" })).toBe("coastal");
    expect(classifyHazard({ event: "High Surf Advisory" })).toBe("coastal");
  });

  it("covers air quality, dust and hydrologic", () => {
    expect(classifyHazard({ event: "Air Quality Alert" })).toBe("air");
    expect(classifyHazard({ event: "Blowing Dust Advisory" })).toBe("dust");
    expect(classifyHazard({ event: "Dust Storm Warning" })).toBe("dust");
    expect(classifyHazard({ event: "Hydrologic Outlook" })).toBe("flood");
  });

  it("handles WMO global phrasings and ES/FR terms", () => {
    expect(classifyHazard({ event: "Red high-temperature warning" })).toBe("heat");
    expect(classifyHazard({ event: "Moderate high-temperature warning" })).toBe("heat");
    expect(classifyHazard({ event: "Strong convection" })).toBe("thunderstorm");
    expect(classifyHazard({ event: "thunder" })).toBe("thunderstorm");
    expect(classifyHazard({ event: "ORAGE" })).toBe("thunderstorm");
    expect(classifyHazard({ event: "Forestfire" })).toBe("fire");
    expect(classifyHazard({ event: "Danger of Fires" })).toBe("fire");
    expect(classifyHazard({ event: "Viento" })).toBe("wind");
    expect(classifyHazard({ event: "PLUIE" })).toBe("rain");
    expect(classifyHazard({ event: "Nevadas" })).toBe("snow-ice");
    expect(classifyHazard({ event: "inundaciones repentinas" })).toBe("flood");
    expect(classifyHazard({ event: "VENT DE SABLE" })).toBe("dust"); // sand wind → dust, not wind
    expect(classifyHazard({ event: "Active Winds" })).toBe("wind"); // plural
    expect(classifyHazard({ event: "Meteorological risk of geological disaster" })).toBe("landslide");
    expect(classifyHazard({ event: "Landslide" })).toBe("landslide");
  });

  it("falls back to other", () => {
    expect(classifyHazard({ event: "Special Statement" })).toBe("other");
    expect(classifyHazard({})).toBe("other");
  });
});
