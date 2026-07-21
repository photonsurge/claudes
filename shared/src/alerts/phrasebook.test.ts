import { broadcastEventLabel } from "./phrasebook";
import { classifyHazard } from "./hazard";

/** End-to-end helper: raw source event → hazard → on-air name. */
const onAir = (event: string, severityRank = 3) =>
  broadcastEventLabel({ hazard: classifyHazard({ event }), severityRank, event });

describe("broadcastEventLabel", () => {
  it("replaces the CMA jargon that started this", () => {
    expect(onAir("Strong convection", 4)).toBe("Violent Thunderstorms");
    expect(onAir("Strong convection", 3)).toBe("Severe Thunderstorms");
    expect(onAir("Strong convection", 1)).toBe("Thunderstorms");
  });

  // Every string below is real, taken from the live WMO/MeteoAlarm feed.
  it.each([
    ["Thunderstormwarning", 3, "Severe Thunderstorms"],
    ["thunder", 2, "Thunderstorms"],
    ["Moderate thunderstorm with hail warning", 2, "Thunderstorms & Hail"],
    ["Forestfire", 3, "High Fire Danger"],
    ["Wildfire warning", 2, "Fire Risk"],
    ["Moderate high-temperature warning", 2, "Hot Weather"],
    ["Red High-temperature Warning", 4, "Extreme Heat"],
    ["Heat wave", 3, "Severe Heat Wave"],
    ["CANICULE", 4, "Extreme Heat Wave"],
    ["calor", 2, "Hot Weather"],
    ["Near gale 14-17 m/s", 2, "Gale-Force Winds"],
    ["gale", 3, "Storm-Force Winds"],
    ["Gale warning for coastal waters", 3, "Storm-Force Seas"],
    ["Stormwarning", 3, "Damaging Winds"],
    ["BÖEN", 2, "Strong Winds"],
    ["STARKWIND", 2, "Strong Winds"],
    ["Viento Zonda", 2, "Downslope Winds"],
    ["сильный ветер (побережье)", 2, "Strong Winds"],
    ["kıyı kesimlerinde kuvetli rüzgar", 2, "Strong Winds"],
    ["silny wiatr (wybrzeże)", 2, "Strong Winds"],
    ["Tugev tuul Tase 1", 2, "Strong Winds"],
    ["Squall warning", 3, "Violent Squalls"],
    ["Rainstorm", 3, "Torrential Rain"],
    ["Extremely Heavy Rain", 4, "Extreme Rainfall"],
    ["Nevihte - zmerna ogroženost", 2, "Thunderstorms"],
    ["Požarna ogroženost - velika ogroženost", 3, "High Fire Danger"],
    ["Žuto upozorenje za vrućinu", 1, "Hot Weather"],
    ["Riverine Flood", 3, "River Flooding"],
    ["Flood Watch", 2, "Flood Watch"],
    ["Meteorological risk of geological disaster", 2, "Landslide Risk"],
    ["Small Craft Advisory", 1, "Small Craft Advisory"],
    ["Wave height warning", 2, "High Waves"],
    ["Rip Current Statement", 2, "Rip Currents"],
    ["Raised dust", 2, "Blowing Dust"],
    ["VENT DE SABLE", 3, "Sandstorm"],
    ["Dense Smoke Advisory", 2, "Wildfire Smoke"],
    ["Air Quality Alert", 2, "Poor Air Quality"],
    ["Nevadas Fuertes", 3, "Heavy Snow"],
    ["Heladas Intensas", 3, "Hard Freeze"],
    ["Dense fog", 2, "Dense Fog"],
    ["Low water", 2, "Dry Conditions"],
    ["Hot day conditions", 2, "Hot Weather"],
  ])("%s (rank %i) → %s", (event, rank, expected) => {
    expect(onAir(event as string, rank as number)).toBe(expected);
  });

  it("never leaks a machine code, an unknown language, or an empty event", () => {
    // These classify as `other` (or via the leaked awareness code) — the point is
    // that NONE of the raw text survives to air.
    expect(onAir("awareness_type=3, awareness_level=2", 2)).toBe("Thunderstorms");
    expect(onAir("awareness_type=5, awareness_level=2", 3)).toBe("Severe Heat");
    expect(onAir("Other dangers", 2)).toBe("Weather Advisory");
    expect(onAir("Advisory", 3)).toBe("Severe Weather");
    expect(onAir("", 4)).toBe("Extreme Weather");
  });

  it("prefers the more specific wording when the source supports it", () => {
    const flash = broadcastEventLabel({ hazard: "flood", severityRank: 4, event: "Flash Flood Warning" });
    expect(flash).toBe("Life-Threatening Flash Flooding");
    // A source-language event with an English translation: probes read both.
    const hail = broadcastEventLabel({
      hazard: "thunderstorm",
      severityRank: 3,
      event: "Gewitter mit Hagel",
      translatedEvent: "Thunderstorm with hail",
    });
    expect(hail).toBe("Severe Storms & Hail");
  });

  it("covers every hazard in the vocabulary at every band", () => {
    for (const hazard of Object.keys(
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require("./hazard").HAZARDS.reduce((m: Record<string, 1>, h: { id: string }) => ({ ...m, [h.id]: 1 }), {}),
    )) {
      for (const rank of [0, 1, 2, 3, 4]) {
        const label = broadcastEventLabel({ hazard: hazard as never, severityRank: rank });
        expect(label).toMatch(/^[A-Z]/);
        expect(label.length).toBeGreaterThan(3);
      }
    }
  });
});
