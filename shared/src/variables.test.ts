import {
  VARIABLE_REGISTRY,
  SCALAR_VARIABLE_IDS,
  getVariable,
  kelvinToCelsius,
  msToKnots,
  celsiusToFahrenheit,
  paToHpa,
} from "./variables";
import { PALETTES } from "./palettes";

describe("unit conversions", () => {
  it("kelvin → celsius", () => {
    expect(kelvinToCelsius(273.15)).toBeCloseTo(0, 6);
    expect(kelvinToCelsius(300)).toBeCloseTo(26.85, 2);
  });
  it("m/s → knots", () => {
    expect(msToKnots(0)).toBe(0);
    expect(msToKnots(10)).toBeCloseTo(19.43844, 4);
  });
  it("celsius → fahrenheit", () => {
    expect(celsiusToFahrenheit(0)).toBe(32);
    expect(celsiusToFahrenheit(100)).toBe(212);
  });
  it("pascals → hectopascals", () => {
    expect(paToHpa(101325)).toBeCloseTo(1013.25, 2);
  });
});

describe("VARIABLE_REGISTRY integrity", () => {
  const ids = Object.keys(VARIABLE_REGISTRY);
  it("has the spec §4.2 variables", () => {
    expect(ids).toEqual(
      expect.arrayContaining(["wind", "temp", "humidity", "rain", "storm", "gust", "pressure"]),
    );
  });

  it.each(ids)("%s is internally consistent", (id) => {
    const v = VARIABLE_REGISTRY[id];
    expect(v.id).toBe(id);
    expect(v.label.length).toBeGreaterThan(0);
    expect(v.units.length).toBeGreaterThan(0);
    expect(PALETTES[v.palette]).toBeDefined();
    expect(v.domain).toHaveLength(2);
    expect(v.domain[0]).toBeLessThan(v.domain[1]);
    // GFS binding is optional (ocean-only vars have none); assert only when set.
    if (v.gfs) {
      expect(v.gfs.vars.length).toBeGreaterThan(0);
      expect(v.gfs.levels.length).toBeGreaterThan(0);
      if (v.encoding === "uv") expect(v.gfs.vars.length).toBe(2);
    }
    if (v.encoding === "uv") expect(v.kind).toBe("particle");
  });

  it("ocean-only variables (current, salinity) have no GFS binding", () => {
    expect(VARIABLE_REGISTRY.current).toBeDefined();
    expect(VARIABLE_REGISTRY.current.encoding).toBe("uv");
    expect(VARIABLE_REGISTRY.current.gfs).toBeUndefined();
    expect(VARIABLE_REGISTRY.salinity).toBeDefined();
    expect(VARIABLE_REGISTRY.salinity.encoding).toBe("scalar");
    expect(VARIABLE_REGISTRY.salinity.gfs).toBeUndefined();
  });

  it("wind is uv-encoded, scalars are scalar-encoded", () => {
    expect(VARIABLE_REGISTRY.wind.encoding).toBe("uv");
    expect(VARIABLE_REGISTRY.temp.encoding).toBe("scalar");
  });

  it("SCALAR_VARIABLE_IDS excludes particle fields but includes pressure (selectable colour map + isobars)", () => {
    expect(SCALAR_VARIABLE_IDS).not.toContain("wind");
    expect(SCALAR_VARIABLE_IDS).not.toContain("current");
    expect(SCALAR_VARIABLE_IDS).toContain("pressure");
    expect(SCALAR_VARIABLE_IDS).toContain("temp");
  });

  it("getVariable returns undefined for unknown ids", () => {
    expect(getVariable("nope")).toBeUndefined();
    expect(getVariable("temp")?.id).toBe("temp");
  });
});
