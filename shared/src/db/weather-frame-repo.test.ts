import { frameShouldReplace } from "./weather-frame-repo";

describe("frameShouldReplace", () => {
  it("lets a lower forecast hour (fresher analysis) replace a higher one", () => {
    expect(frameShouldReplace(3, 0)).toBe(true);
    expect(frameShouldReplace(0, 3)).toBe(false);
  });

  it("refreshes in place on equal fhr (re-bakes)", () => {
    expect(frameShouldReplace(0, 0)).toBe(true);
    expect(frameShouldReplace(3, 3)).toBe(true);
  });
});
