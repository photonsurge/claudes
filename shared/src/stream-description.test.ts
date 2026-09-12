import {
  DEFAULT_STREAM_BLURB,
  YT_DESCRIPTION_MAX,
  buildBroadcastDescription,
  normalizeThumbnailSource,
  resolveThumbnailUrl,
} from "./stream-description";

const now = new Date("2026-09-08T13:05:00Z"); // 14:05 BST, Tuesday

describe("buildBroadcastDescription", () => {
  it("falls back to the built-in copy with the date expanded and the site link appended", () => {
    const text = buildBroadcastDescription({ siteUrl: "https://gods.example/", now });
    expect(text.startsWith(DEFAULT_STREAM_BLURB)).toBe(true);
    expect(text).toContain("Streaming since Tuesday 8 September 2026, 14:05 BST.");
    expect(text.endsWith("Watch the map live: https://gods.example")).toBe(true);
  });

  it("prefers the operator template, then the deployment fallback", () => {
    expect(buildBroadcastDescription({ template: "Ops %d/%m", fallback: "Env", now })).toBe("Ops 08/09");
    expect(buildBroadcastDescription({ template: "  ", fallback: "Env line\\nsecond", now })).toBe("Env line\nsecond");
  });

  it("does not duplicate a site link the operator already wrote", () => {
    const text = buildBroadcastDescription({ template: "See https://gods.example/watch", siteUrl: "https://gods.example", now });
    expect(text).toBe("See https://gods.example/watch");
  });

  it("clamps to YouTube's description limit", () => {
    const text = buildBroadcastDescription({ template: "x".repeat(YT_DESCRIPTION_MAX + 50), now });
    expect(text.length).toBe(YT_DESCRIPTION_MAX);
  });
});

describe("normalizeThumbnailSource", () => {
  it("accepts absolute http(s) URLs and site-relative paths; blank means default", () => {
    expect(normalizeThumbnailSource(" https://cdn.example/a.png ")).toBe("https://cdn.example/a.png");
    expect(normalizeThumbnailSource("/thumbs/wind.jpg")).toBe("/thumbs/wind.jpg");
    expect(normalizeThumbnailSource("")).toBeUndefined();
    expect(normalizeThumbnailSource(undefined)).toBeUndefined();
  });
  it("rejects other schemes, protocol-relative and bare words", () => {
    expect(normalizeThumbnailSource("ftp://x/a.png")).toBeNull();
    expect(normalizeThumbnailSource("//cdn.example/a.png")).toBeNull();
    expect(normalizeThumbnailSource("wind.png")).toBeNull();
    expect(normalizeThumbnailSource("javascript:alert(1)")).toBeNull();
  });
});

describe("resolveThumbnailUrl", () => {
  it("resolves paths against the site and passes absolute URLs through", () => {
    expect(resolveThumbnailUrl(undefined, "https://gods.example/")).toBe("https://gods.example/LogoHorizontal.png");
    expect(resolveThumbnailUrl("/t.png", "https://gods.example")).toBe("https://gods.example/t.png");
    expect(resolveThumbnailUrl("https://cdn.example/t.png", "https://gods.example")).toBe("https://cdn.example/t.png");
  });
});
