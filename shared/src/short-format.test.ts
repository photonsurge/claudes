import {
  DEFAULT_CLOSE_MS,
  DEFAULT_MIN_TOUR_DWELL_MS,
  DEFAULT_OPENER_BUDGET_SHARE,
  DEFAULT_SHORT_FORMAT_ID,
  FORMAT_BUDGET_MIN_MS,
  OPENER_SHARE_MAX,
  defaultShortFormat,
  isVideoTimezone,
  sanitizeShortFormat,
  type ShortFormat,
} from "./short-format";
import { DEFAULT_SHORT_BUDGET_MS, TOUR_DWELL_MAX_MS } from "./short-script";

describe("defaultShortFormat", () => {
  it("is today's round-up video: round-up leads at full depth, tour on, close on, unlisted", () => {
    const f = defaultShortFormat();
    expect(f.id).toBe(DEFAULT_SHORT_FORMAT_ID);
    expect(f.template).toEqual({
      include: { alerts: false, quakes: false, volcanoes: false },
      budgetMs: DEFAULT_SHORT_BUDGET_MS,
      openWithWorld: false,
    });
    expect(f.opener).toEqual({
      leadWithRoundup: true,
      roundupDepth: "full",
      tour: true,
      minTourDwellMs: DEFAULT_MIN_TOUR_DWELL_MS,
      budgetShare: DEFAULT_OPENER_BUDGET_SHARE,
    });
    expect(f.close).toEqual({ enabled: true, ms: DEFAULT_CLOSE_MS });
    expect(f.video.publishAs).toBe("unlisted");
    expect(f.video.timezone).toBe("Europe/London");
    expect(f.timing).toEqual({ leadInMs: 3_000, leadOutMs: 5_000 });
    expect(f.layout).toBe("landscape");
  });

  it("returns a fresh object each time", () => {
    const a = defaultShortFormat();
    a.video.tags.push("x");
    expect(defaultShortFormat().video.tags).toEqual([]);
  });
});

describe("sanitizeShortFormat", () => {
  it("is null without an id", () => {
    expect(sanitizeShortFormat({ name: "x" })).toBeNull();
    expect(sanitizeShortFormat(null)).toBeNull();
  });

  it("fills a bare body with the defaults", () => {
    expect(sanitizeShortFormat({ id: " short-uk ", name: " UK " })).toEqual({ ...defaultShortFormat("short-uk"), name: "UK" });
  });

  it("keeps every valid field of a full body", () => {
    const full: ShortFormat = {
      id: "short-uk",
      name: "UK round-up",
      template: {
        scope: { type: "country", id: "uk" },
        include: { alerts: true, quakes: false, volcanoes: true },
        budgetMs: 90_000,
        openWithWorld: true,
      },
      opener: { leadWithRoundup: false, roundupDepth: "summary", tour: false, minTourDwellMs: 10_000, budgetShare: 0.5 },
      close: { enabled: false, ms: 4_000 },
      video: {
        title: "%{place} today",
        description: "",
        timezone: "place",
        thumbnail: { source: "frame", atMs: 12_000 },
        tags: ["weather", "uk"],
        categoryId: "28",
        playlistId: "PL123",
        publishAs: "public",
        chapters: false,
      },
      timing: { leadInMs: 2_000, leadOutMs: 8_000 },
      render: { encoderId: "obs-2", accountId: "UC1" },
      layout: "landscape",
    };
    expect(sanitizeShortFormat(full)).toEqual(full);
  });

  it("clamps numbers and drops junk back to the base", () => {
    const f = sanitizeShortFormat({
      id: "f",
      template: { budgetMs: 5, include: { alerts: "yes" } },
      opener: { budgetShare: 7, minTourDwellMs: 1e9, roundupDepth: "half", tour: "no" },
      close: { ms: -1 },
      video: { title: "  ", timezone: "Mars/Olympus", categoryId: "news", publishAs: "secret", tags: [" a ", "a", "", 3, "b"] },
      timing: { leadInMs: -5, leadOutMs: 1e9 },
      layout: "portrait",
    })!;
    const d = defaultShortFormat("f");
    expect(f.template.budgetMs).toBe(FORMAT_BUDGET_MIN_MS);
    expect(f.template.include).toEqual({ alerts: false, quakes: false, volcanoes: false });
    expect(f.opener.budgetShare).toBe(OPENER_SHARE_MAX);
    expect(f.opener.minTourDwellMs).toBe(TOUR_DWELL_MAX_MS);
    expect(f.opener.roundupDepth).toBe("full");
    expect(f.opener.tour).toBe(true);
    expect(f.close.ms).toBe(1_000);
    expect(f.video.title).toBe(d.video.title);
    expect(f.video.timezone).toBe("Europe/London");
    expect(f.video.categoryId).toBe(d.video.categoryId);
    expect(f.video.publishAs).toBe("unlisted");
    expect(f.video.tags).toEqual(["a", "b"]);
    expect(f.timing).toEqual({ leadInMs: 0, leadOutMs: 60_000 });
    expect(f.layout).toBe("landscape");
  });

  it("patches onto a base: absent keeps, null clears the scope, empty strings clear optional ids", () => {
    const base = sanitizeShortFormat({
      id: "f",
      name: "F",
      template: { scope: { type: "area", id: "europe" } },
      video: { playlistId: "PL1" },
      render: { encoderId: "obs-1" },
    })!;
    expect(sanitizeShortFormat({ close: { enabled: false } }, base)).toEqual({ ...base, close: { ...base.close, enabled: false } });

    const cleared = sanitizeShortFormat({ template: { scope: null }, video: { playlistId: "" }, render: { encoderId: "" } }, base)!;
    expect(cleared.template.scope).toBeUndefined();
    expect(cleared.video.playlistId).toBeUndefined();
    expect(cleared.render).toEqual({});
    // A bad scope keeps the base's.
    expect(sanitizeShortFormat({ template: { scope: { type: "planet" } } }, base)!.template.scope).toEqual({ type: "area", id: "europe" });
  });

  it("takes either kind of thumbnail", () => {
    expect(sanitizeShortFormat({ id: "f", video: { thumbnail: { source: "image", url: " /thumbs/x.png " } } })!.video.thumbnail).toEqual({
      source: "image",
      url: "/thumbs/x.png",
    });
    expect(sanitizeShortFormat({ id: "f", video: { thumbnail: { source: "frame", atMs: -3 } } })!.video.thumbnail).toEqual({
      source: "frame",
      atMs: 0,
    });
    expect(sanitizeShortFormat({ id: "f", video: { thumbnail: { source: "gif" } } })!.video.thumbnail).toEqual({ source: "image", url: "" });
  });
});

describe("isVideoTimezone", () => {
  it("takes an IANA zone or 'place'", () => {
    expect(isVideoTimezone("Australia/Sydney")).toBe(true);
    expect(isVideoTimezone("place")).toBe(true);
    expect(isVideoTimezone("")).toBe(false);
    expect(isVideoTimezone("Nowhere/Land")).toBe(false);
  });
});
