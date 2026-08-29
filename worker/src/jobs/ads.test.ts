import { exposurePairs } from "./ads";

const ad = (adId: string, over: Partial<Parameters<typeof exposurePairs>[1][number]> = {}) => ({
  adId,
  status: "active" as const,
  placements: ["ticker" as const],
  ...over,
});

describe("exposurePairs", () => {
  it("crosses active ticker-placed ads with crawl-showing scenes", () => {
    const pairs = exposurePairs(
      [{ id: "default" }, { id: "storm", widgetsOff: [] }],
      [ad("a"), ad("b")],
    );
    expect(pairs).toEqual([
      { adId: "a", sceneId: "default" },
      { adId: "b", sceneId: "default" },
      { adId: "a", sceneId: "storm" },
      { adId: "b", sceneId: "storm" },
    ]);
  });

  it("skips break-only and inactive ads — the interstitial catalog never logs ticker time", () => {
    const pairs = exposurePairs(
      [{ id: "default" }],
      [ad("break-only", { placements: ["break"] }), ad("off", { status: "inactive" }), ad("on")],
    );
    expect(pairs).toEqual([{ adId: "on", sceneId: "default" }]);
  });

  it("skips scenes whose crawl widget is hidden", () => {
    const pairs = exposurePairs(
      [{ id: "default", widgetsOff: ["ticker"] }, { id: "storm", widgetsOff: ["syslog"] }],
      [ad("a")],
    );
    expect(pairs).toEqual([{ adId: "a", sceneId: "storm" }]);
  });
});

describe("exposurePairs — billboard surface", () => {
  const img = (adId: string, over: Partial<Parameters<typeof exposurePairs>[1][number]> = {}) => ({
    adId,
    status: "active" as const,
    placements: ["billboard" as const],
    mediaType: "image" as const,
    ...over,
  });

  it("crosses active billboard-placed image ads with corner-showing scenes", () => {
    const pairs = exposurePairs(
      [{ id: "default" }, { id: "storm", widgetsOff: ["ticker"] }],
      [img("a"), img("ticker-only", { placements: ["ticker"] })],
      "billboard",
    );
    expect(pairs).toEqual([
      { adId: "a", sceneId: "default" },
      { adId: "a", sceneId: "storm" },
    ]);
  });

  it("never logs a video creative — the billboard renders images only", () => {
    const pairs = exposurePairs(
      [{ id: "default" }],
      [img("clip", { mediaType: "video" }), img("still")],
      "billboard",
    );
    expect(pairs).toEqual([{ adId: "still", sceneId: "default" }]);
  });

  it("skips scenes whose billboard widget is hidden", () => {
    const pairs = exposurePairs(
      [{ id: "default", widgetsOff: ["billboard"] }, { id: "storm" }],
      [img("a")],
      "billboard",
    );
    expect(pairs).toEqual([{ adId: "a", sceneId: "storm" }]);
  });
});
