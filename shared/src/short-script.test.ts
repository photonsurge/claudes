import {
  clipAt,
  clipStarts,
  DEFAULT_CLIP_MS,
  MAX_CLIP_MS,
  MIN_CLIP_MS,
  playFor,
  sanitizeInclude,
  sanitizeScope,
  sanitizeShortScript,
  scriptDurationMs,
  TOUR_DWELL_MAX_MS,
  TOUR_DWELL_MIN_MS,
  type ShortScriptPlay,
} from "./short-script";

const d = (...ms: number[]) => ms.map((durationMs) => ({ durationMs }));

describe("clip timing", () => {
  it("derives start offsets from order and duration", () => {
    expect(clipStarts(d(10_000, 5_000, 20_000))).toEqual([0, 10_000, 15_000]);
    expect(clipStarts([])).toEqual([]);
  });

  it("sums the running time", () => {
    expect(scriptDurationMs(d(10_000, 5_000, 20_000))).toBe(35_000);
    expect(scriptDurationMs([])).toBe(0);
  });

  it("finds the clip on screen and the offset into it", () => {
    const clips = d(10_000, 5_000, 20_000);
    expect(clipAt(clips, 0)).toEqual({ index: 0, offsetMs: 0 });
    expect(clipAt(clips, 9_999)).toEqual({ index: 0, offsetMs: 9_999 });
    expect(clipAt(clips, 12_500)).toEqual({ index: 1, offsetMs: 2_500 });
    expect(clipAt(clips, 34_999)).toEqual({ index: 2, offsetMs: 19_999 });
  });

  it("gives a boundary to the clip that starts there", () => {
    const clips = d(10_000, 5_000, 20_000);
    expect(clipAt(clips, 10_000)).toEqual({ index: 1, offsetMs: 0 });
    expect(clipAt(clips, 15_000)).toEqual({ index: 2, offsetMs: 0 });
  });

  it("is null at/after the end, before the start, and for an empty list", () => {
    const clips = d(10_000, 5_000);
    expect(clipAt(clips, 15_000)).toBeNull();
    expect(clipAt(clips, 99_000)).toBeNull();
    expect(clipAt(clips, -1)).toBeNull();
    expect(clipAt(clips, NaN)).toBeNull();
    expect(clipAt([], 0)).toBeNull();
  });

  it("never lands on a zero-length clip", () => {
    expect(clipAt(d(5_000, 0, 5_000), 5_000)).toEqual({ index: 2, offsetMs: 0 });
  });
});

describe("sanitizeShortScript", () => {
  const body = {
    id: " s1 ",
    template: "lineup",
    scope: { type: "country", id: " japan " },
    include: { alerts: true, quakes: false, volcanoes: true },
    title: "  Japan tonight ",
    status: "ready",
    clips: [
      { id: "c1", target: " country:japan ", durationMs: 30_000.4, maxStops: 3.9, tourDwellMs: 9_000.6, leadSlide: "roundup",
        look: { basemap: "satellite", bogus: 1 }, label: { title: " Japan ", subtitle: " ", icon: "🇯🇵" } },
      { id: "c2", target: "  ", durationMs: 5_000, label: { title: "dropped" } },
      { id: "c3", target: "quake:us1", durationMs: 50, label: {} },
      { id: "c3", target: "quake:us2", durationMs: 99_999_999, maxStops: -2, tourDwellMs: 1, leadSlide: "other" },
      { target: "volcano:v1", durationMs: "x" },
    ],
    plays: [{ sceneId: "shorts", playNonce: 1, startedAt: 1, clips: [], skipped: [] }],
  };

  it("trims strings, drops empty targets and clamps durations", () => {
    const s = sanitizeShortScript(body)!;
    expect(s.id).toBe("s1");
    expect(s.scope).toEqual({ type: "country", id: "japan" });
    expect(s.include).toEqual({ alerts: true, quakes: false, volcanoes: true });
    expect(s.title).toBe("Japan tonight");
    expect(s.status).toBe("ready");
    expect(s.clips.map((c) => c.target)).toEqual(["country:japan", "quake:us1", "quake:us2", "volcano:v1"]);
    expect(s.clips.map((c) => c.durationMs)).toEqual([30_000, MIN_CLIP_MS, MAX_CLIP_MS, DEFAULT_CLIP_MS]);
  });

  it("keeps valid clip options and drops invalid ones", () => {
    const [japan, q1, q2] = sanitizeShortScript(body)!.clips;
    expect(japan).toEqual({
      id: "c1",
      target: "country:japan",
      durationMs: 30_000,
      maxStops: 3,
      tourDwellMs: 9_001,
      leadSlide: "roundup",
      look: { basemap: "satellite" },
      label: { title: "Japan", icon: "🇯🇵" },
    });
    expect(q1.label).toEqual({ title: "quake:us1" }); // falls back to the target
    expect(q2.maxStops).toBe(0);
    expect(q2.tourDwellMs).toBe(TOUR_DWELL_MIN_MS);
    expect(q2).not.toHaveProperty("leadSlide");
    expect(q1).not.toHaveProperty("tourDwellMs");
  });

  it("clamps tourDwellMs to its range", () => {
    const one = (tourDwellMs: unknown) =>
      sanitizeShortScript({ id: "s", scope: { type: "globe" }, clips: [{ target: "country:japan", tourDwellMs }] })!.clips[0];
    expect(one(10 * 60_000).tourDwellMs).toBe(TOUR_DWELL_MAX_MS);
    expect(one(NaN)).not.toHaveProperty("tourDwellMs");
    expect(one("9000")).not.toHaveProperty("tourDwellMs");
  });

  it("gives missing and duplicate clip ids fresh unique ones", () => {
    const ids = sanitizeShortScript(body)!.clips.map((c) => c.id);
    expect(ids[1]).toBe("c3");
    expect(ids[2]).not.toBe("c3");
    expect(ids[3]).toBeTruthy();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never takes plays from the body", () => {
    expect(sanitizeShortScript(body)).not.toHaveProperty("plays");
  });

  it("defaults include switches off, status to draft and a blank title", () => {
    const s = sanitizeShortScript({ id: "s2", scope: { type: "globe", id: "ignored" } })!;
    expect(s.scope).toEqual({ type: "globe" });
    expect(s.include).toEqual({ alerts: false, quakes: false, volcanoes: false });
    expect(s.status).toBe("draft");
    expect(s.title).toBe("Untitled short");
    expect(s.clips).toEqual([]);
  });

  it("rejects a body with no id or no valid scope", () => {
    expect(sanitizeShortScript(null)).toBeNull();
    expect(sanitizeShortScript({ scope: { type: "globe" } })).toBeNull();
    expect(sanitizeShortScript({ id: "s", scope: { type: "country", id: " " } })).toBeNull();
    expect(sanitizeShortScript({ id: "s", scope: { type: "planet" } })).toBeNull();
  });
});

describe("sanitizeScope / sanitizeInclude", () => {
  it("accepts the three scope shapes and nothing else", () => {
    expect(sanitizeScope({ type: "globe", id: "x" })).toEqual({ type: "globe" });
    expect(sanitizeScope({ type: "area", id: " europe " })).toEqual({ type: "area", id: "europe" });
    expect(sanitizeScope({ type: "country" })).toBeNull();
    expect(sanitizeScope("globe")).toBeNull();
  });

  it("turns a switch on only for a literal true", () => {
    expect(sanitizeInclude(undefined)).toEqual({ alerts: false, quakes: false, volcanoes: false });
    expect(sanitizeInclude({ alerts: true, quakes: "yes", volcanoes: 1 })).toEqual({ alerts: true, quakes: false, volcanoes: false });
  });
});

describe("playFor", () => {
  const p = (sceneId: string, playNonce: number): ShortScriptPlay => ({ sceneId, playNonce, startedAt: 1, clips: [], skipped: [] });

  it("picks the scene's own play", () => {
    const plays = [p("shorts", 1), p("shorts-preview", 2)];
    expect(playFor({ plays }, "shorts-preview")?.playNonce).toBe(2);
    expect(playFor({ plays }, "shorts")?.playNonce).toBe(1);
  });

  it("is undefined for a scene that never played it, or no plays at all", () => {
    expect(playFor({ plays: [p("shorts", 1)] }, "main")).toBeUndefined();
    expect(playFor({}, "shorts")).toBeUndefined();
  });
});
