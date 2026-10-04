import { renderCanRetry, renderIsActive, renderIsFinished, sanitizeRenderRequest } from "./short-render";

describe("sanitizeRenderRequest", () => {
  it("accepts a saved script, defaulting to any encoder, unlisted, live", () => {
    expect(sanitizeRenderRequest({ what: { type: "script", scriptId: " s1 " } })).toEqual({
      encoderId: "any",
      what: { type: "script", scriptId: "s1" },
      publishAs: "unlisted",
      offline: false,
    });
  });

  it("accepts a generate request with auto scope, overrides and schedule fields", () => {
    const req = sanitizeRenderRequest({
      encoderId: "obs-v1",
      what: { type: "generate", formatId: "shorts", scope: { type: "auto", of: "area" }, include: { alerts: true } },
      publishAs: "public",
      offline: true,
      accountId: "UC1",
      video: { title: " UK %d ", tags: ["weather", 3, ""], thumbnail: { source: "frame", atMs: 1500.4 }, bogus: 1 },
      roundup: { maxAgeHours: 14, ifStale: "refresh" },
      skipIfQuiet: true,
      scheduleId: "sch",
      batchId: "b1",
      startBy: 123,
    });
    expect(req).toEqual({
      encoderId: "obs-v1",
      what: { type: "generate", formatId: "shorts", scope: { type: "auto", of: "area" }, include: { alerts: true, quakes: false, volcanoes: false } },
      publishAs: "public",
      offline: true,
      accountId: "UC1",
      video: { title: "UK %d", tags: ["weather"], thumbnail: { source: "frame", atMs: 1500 } },
      roundup: { maxAgeHours: 14, ifStale: "refresh" },
      skipIfQuiet: true,
      scheduleId: "sch",
      batchId: "b1",
      startBy: 123,
    });
  });

  it("refuses a request with nothing to make", () => {
    expect(sanitizeRenderRequest(null)).toBeNull();
    expect(sanitizeRenderRequest({ what: { type: "script" } })).toBeNull();
    expect(sanitizeRenderRequest({ what: { type: "generate", formatId: "f", scope: { type: "moon" } } })).toBeNull();
    expect(sanitizeRenderRequest({ what: { type: "generate", scope: { type: "globe" } } })).toBeNull();
  });

  it("drops a malformed freshness rule rather than guessing", () => {
    const req = sanitizeRenderRequest({ what: { type: "script", scriptId: "s" }, roundup: { maxAgeHours: 0, ifStale: "skip" } });
    expect(req?.roundup).toBeUndefined();
  });
});

describe("render status helpers", () => {
  it("classifies statuses", () => {
    expect(renderIsActive("preparing")).toBe(true);
    expect(renderIsActive("live")).toBe(true);
    expect(renderIsActive("queued")).toBe(false);
    expect(renderIsFinished("done")).toBe(true);
    expect(renderIsFinished("live")).toBe(false);
    expect(renderCanRetry("failed")).toBe(true);
    expect(renderCanRetry("done")).toBe(false);
  });
});
