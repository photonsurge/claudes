import { speakable } from "./speakable";

describe("speakable", () => {
  it("spells out units", () => {
    expect(speakable("Gusts to 120 km/h and 45 mph")).toBe("Gusts to 120 kilometres per hour and 45 miles per hour");
    expect(speakable("High of 31°C, low -2 °C")).toBe("High of 31 degrees Celsius, low minus 2 degrees Celsius");
    expect(speakable("Up to 80mm of rain, pressure 980 hPa")).toBe("Up to 80 millimetres of rain, pressure 980 hectopascals");
    expect(speakable("70% chance")).toBe("70 percent chance");
  });

  it("reads earthquake magnitudes", () => {
    expect(speakable("M5.6 quake, then a Mw 6.1")).toBe("magnitude 5.6 quake, then a magnitude 6.1");
  });

  it("reads ranges and approximations without touching dates", () => {
    expect(speakable("10–20 cm of snow")).toBe("10 to 20 centimetres of snow");
    expect(speakable("3-5 days, ~30 dead")).toBe("3 to 5 days, about 30 dead");
    expect(speakable("Issued 2026-10-04")).toBe("Issued 2026-10-04");
  });

  it("spells UTC and strips emoji, flags, markdown and links", () => {
    expect(speakable("**Update** at 12:00 UTC 🌀🇯🇵 see [NHC](https://nhc.gov)")).toBe("Update at 12:00 U T C see NHC");
  });

  it("turns brackets into pauses and newlines into sentences", () => {
    expect(speakable("Tokyo (Japan) is calm\n\nOsaka next")).toBe("Tokyo, Japan, is calm. Osaka next");
  });

  it("leaves plain prose alone", () => {
    const s = "A quiet night across the Atlantic, with showers easing by morning.";
    expect(speakable(s)).toBe(s);
  });

  it("does not misread words that look like units", () => {
    expect(speakable("Up to 3 in the north, 24/7 coverage")).toBe("Up to 3 in the north, 24/7 coverage");
  });
});
