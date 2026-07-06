import { forecastShouldReplace } from "./weather-forecast-frame-repo";

describe("forecastShouldReplace", () => {
  it("lets a newer run replace an older one, regardless of fhr", () => {
    expect(forecastShouldReplace(new Date("2026-07-06T00:00:00Z"), new Date("2026-07-06T06:00:00Z"))).toBe(
      true,
    );
    expect(forecastShouldReplace(new Date("2026-07-06T06:00:00Z"), new Date("2026-07-06T00:00:00Z"))).toBe(
      false,
    );
  });

  it("refreshes in place on equal run (re-bakes)", () => {
    const run = new Date("2026-07-06T00:00:00Z");
    expect(forecastShouldReplace(run, run)).toBe(true);
  });
});
