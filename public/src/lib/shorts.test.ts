/**
 * lib/shorts — the pure helpers behind /admin/shorts: durations, scope labels,
 * picker options and the preview play state.
 */
import {
  AREA_OPTIONS,
  COUNTRY_OPTIONS,
  formatDuration,
  previewActive,
  previewForFormat,
  previewPlayState,
  previewWatchUrl,
  scopeLabel,
  type ShortListItem,
  type ShortPreviewInfo,
} from "./shorts";

const off: ShortPreviewInfo = { sceneId: "shorts-preview", exists: true, mode: "off" };
const item = (previewPlay?: ShortListItem["previewPlay"]): ShortListItem => ({
  id: "s1",
  formatId: "shorts",
  title: "T",
  scope: { type: "globe" },
  status: "draft",
  clipCount: 2,
  durationMs: 1,
  previewPlay,
});
const play = (over: Partial<NonNullable<ShortListItem["previewPlay"]>> = {}) => ({
  sceneId: "shorts-preview",
  playNonce: 5,
  startedAt: 1,
  skipped: [],
  ...over,
});

describe("formatDuration", () => {
  it("formats m:ss, rounding to the second", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(75_000)).toBe("1:15");
    expect(formatDuration(9_600)).toBe("0:10");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatDuration(NaN)).toBe("0:00");
  });
});

describe("scopeLabel", () => {
  it("names the globe, catalog areas and countries, and falls back to the raw id", () => {
    expect(scopeLabel({ type: "globe" })).toBe("Globe");
    expect(scopeLabel({ type: "country", id: "japan" })).toMatch(/^Country · .+ Japan$/);
    expect(scopeLabel({ type: "area", id: AREA_OPTIONS[0].id })).toBe(`Area · ${AREA_OPTIONS[0].label}`);
    expect(scopeLabel({ type: "country", id: "atlantis" })).toBe("Country · atlantis");
  });
});

describe("picker options", () => {
  it("lists every catalog entry, sorted by name", () => {
    const names = (o: { label: string }[]) => o.map((x) => x.label.replace(/^\S+\s/, ""));
    const countries = names(COUNTRY_OPTIONS);
    expect(countries).toEqual([...countries].sort((a, b) => a.localeCompare(b)));
    const areas = AREA_OPTIONS.map((a) => a.label);
    expect(areas).toEqual([...areas].sort((a, b) => a.localeCompare(b)));
    expect(COUNTRY_OPTIONS.length).toBeGreaterThan(20);
  });
});

describe("previewPlayState", () => {
  it("is never without a play and not requested", () => {
    expect(previewPlayState(item(), off)).toBe("never");
  });

  it("is starting between the request and the runner stamping its nonce", () => {
    const req = { ...off, mode: "script" as const, scriptId: "s1", playNonce: 6 };
    expect(previewPlayState(item(), req)).toBe("starting");
    expect(previewPlayState(item(play({ endedAt: 9 })), req)).toBe("starting");
  });

  it("is playing while the stamped play is open and still requested", () => {
    const req = { ...off, mode: "script" as const, scriptId: "s1", playNonce: 5 };
    expect(previewPlayState(item(play()), req)).toBe("playing");
  });

  it("reads ended vs stopped off the record", () => {
    expect(previewPlayState(item(play({ endedAt: 9 })), off)).toBe("ended");
    expect(previewPlayState(item(play({ endedAt: 9, stopped: true })), off)).toBe("stopped");
    // Open record but the scene moved on (another script / off): it was cut short.
    expect(previewPlayState(item(play()), off)).toBe("stopped");
  });
});

describe("previewActive", () => {
  it("polls while the scene is in script mode or a play is open", () => {
    expect(previewActive(null)).toBe(false);
    const formats = (...modes: ShortPreviewInfo["mode"][]) => modes.map((mode, i) => ({ id: `f${i}`, name: "F", preview: { ...off, mode } }));
    expect(previewActive({ scripts: [item()], formats: formats("off", "off") })).toBe(false);
    // Any format's scene playing counts.
    expect(previewActive({ scripts: [item()], formats: formats("off", "script") })).toBe(true);
    expect(previewActive({ scripts: [item(play())], formats: formats("off") })).toBe(true);
  });
});

describe("previewForFormat", () => {
  const rows = [
    { id: "shorts", name: "Round-up", preview: { sceneId: "shorts", exists: true, mode: "off" as const } },
    { id: "short-a", name: "A", preview: { sceneId: "short-a", exists: false, mode: "off" as const } },
  ];
  it("is the format's own scene, else the default's, else a missing stub", () => {
    expect(previewForFormat({ formats: rows }, "short-a").sceneId).toBe("short-a");
    expect(previewForFormat({ formats: rows }).sceneId).toBe("shorts");
    expect(previewForFormat({ formats: rows }, "short-gone").sceneId).toBe("shorts");
    expect(previewForFormat(null, "short-a")).toEqual({ sceneId: "short-a", exists: false, mode: "off" });
  });
});

describe("previewWatchUrl", () => {
  it("is relative and carries the watch token when there is one", () => {
    expect(previewWatchUrl({ sceneId: "shorts-preview", watchToken: "a b" })).toBe("/watch/shorts-preview?token=a%20b");
    expect(previewWatchUrl({ sceneId: "shorts-preview" })).toBe("/watch/shorts-preview");
  });
});
