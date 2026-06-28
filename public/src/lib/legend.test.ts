import { convertValue, buildLegend } from "./legend";

describe("convertValue", () => {
  it("converts °C ↔ °F for temperature", () => {
    expect(convertValue("temp", 0, { wind: "kt", temp: "C" })).toEqual({ value: 0, unit: "°C" });
    expect(convertValue("temp", 100, { wind: "kt", temp: "F" })).toEqual({
      value: 212,
      unit: "°F",
    });
  });

  it("converts m/s ↔ kt for wind/gust", () => {
    const ms = convertValue("gust", 10, { wind: "m/s", temp: "C" });
    expect(ms).toEqual({ value: 10, unit: "m/s" });
    const kt = convertValue("gust", 10, { wind: "kt", temp: "C" });
    expect(kt.unit).toBe("kt");
    expect(kt.value).toBeCloseTo(19.438, 2);
  });

  it("passes through non-convertible units (e.g. humidity %)", () => {
    expect(convertValue("humidity", 50, { wind: "kt", temp: "C" })).toEqual({
      value: 50,
      unit: "%",
    });
  });
});

describe("buildLegend", () => {
  it("uses converted domain endpoints", () => {
    const legend = buildLegend("temp", { wind: "kt", temp: "F" })!;
    // -40°C = -40°F, 50°C = 122°F
    expect(legend.unit).toBe("°F");
    expect(legend.domain[0]).toBeCloseTo(-40, 5);
    expect(legend.domain[1]).toBeCloseTo(122, 5);
  });

  it("produces the requested number of stops", () => {
    const legend = buildLegend("temp", { wind: "kt", temp: "C" }, 5)!;
    expect(legend.stops).toHaveLength(5);
    expect(legend.stops[0].t).toBe(0);
    expect(legend.stops[4].t).toBe(1);
  });

  it("returns null for unknown variable", () => {
    expect(buildLegend("nope", { wind: "kt", temp: "C" })).toBeNull();
  });
});
