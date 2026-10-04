// The render queue (render-queue.ts): the pure planner, the text resolver, and
// the queue against an in-memory Mongo — a three-video batch with one failure,
// the quota gate, the no-chat run shape, start-by, and the operator controls.

jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("./encoders", () => ({ watchBaseUrl: () => "https://wx.example" }));
// Formats come from db.shortFormats through generate's own lookup (WP5).
const formats = new Map<string, any>();
jest.mock("../director/script-generate", () => ({
  generateShortScript: jest.fn(),
  generateFormat: jest.fn(async (_db: unknown, id?: string) => {
    const { defaultShortFormat } = jest.requireActual("@photonsurge/shared/short-format");
    const fid = id || "shorts";
    if (formats.has(fid)) return formats.get(fid);
    if (fid === "shorts") return defaultShortFormat();
    throw new Error(`short-video: no format "${fid}" — pick one from /admin/shorts`);
  }),
}));
jest.mock("./script-values", () => ({
  ...jest.requireActual("./script-values"),
  scriptValues: jest.fn(async () => ({ place: "Europe", placeId: "europe", kind: "round-up" })),
}));
jest.mock("../youtube/quota", () => ({
  exhaustedUntil: jest.fn(async () => null),
  quotaSnapshot: jest.fn(async () => ({ remaining: 9_000 })),
  fmtResetTime: () => "07:00 UTC",
}));

const jobs: { event: string; data: any }[] = [];
const fakeQueue = { add: jest.fn(async (_n: string, p: any) => void jobs.push({ event: p.event, data: p.data })) };
jest.mock("@photonsurge/shared/bull/bull", () => ({ getQueue: jest.fn(() => fakeQueue) }));

// ---- in-memory Mongo ----
const renders = new Map<string, any>();
const runs = new Map<string, any>();
const scripts = new Map<string, any>();
const encoders: any[] = [];
const slots: any[] = [];
const paused = new Set<string>();
const accounts: any[] = [{ id: "UC1" }];
let seq = 0;
const ACTIVE_RUN = new Set(["scheduled", "awaiting-ingest", "live", "ending"]);
const clone = <T>(x: T): T => (x === undefined || x === null ? x : structuredClone(x));
const db = {
  shortRenders: {
    create: jest.fn(async (req: any, now = Date.now()) => {
      const r = { ...clone(req), id: `rd${++seq}`, status: "queued", queuedAt: now + seq };
      renders.set(r.id, r);
      return clone(r);
    }),
    get: jest.fn(async (id: string) => clone(renders.get(id) ?? null)),
    getByRunId: jest.fn(async (runId: string) => clone([...renders.values()].find((r) => r.runId === runId) ?? null)),
    list: jest.fn(async (f: { status?: string[] } = {}) =>
      [...renders.values()].filter((r) => !f.status || f.status.includes(r.status)).sort((a, b) => a.queuedAt - b.queuedAt).map(clone),
    ),
    update: jest.fn(async (id: string, patch: any) => {
      const r = renders.get(id);
      if (!r) return null;
      Object.assign(r, clone(patch));
      return clone(r);
    }),
    transition: jest.fn(async (id: string, from: string[], patch: any) => {
      const r = renders.get(id);
      if (!r || !from.includes(r.status)) return null;
      for (const [k, v] of Object.entries(patch)) (v === null ? delete r[k] : (r[k] = clone(v)));
      return clone(r);
    }),
    pausedEncoders: jest.fn(async () => [...paused]),
    setPaused: jest.fn(async (id: string, p: boolean) => void (p ? paused.add(id) : paused.delete(id))),
  },
  shortScripts: {
    get: jest.fn(async (id: string) => clone(scripts.get(id) ?? null)),
    stampValues: jest.fn(async (id: string, values: any) => {
      if (scripts.has(id)) scripts.get(id).values = values;
      return true;
    }),
  },
  listStreamEncoders: jest.fn(async () => clone(encoders)),
  listStreamSlots: jest.fn(async () => clone(slots)),
  listRuns: jest.fn(async (f: { status?: string[] } = {}) => [...runs.values()].filter((r) => !f.status || f.status.includes(r.status)).map(clone)),
  getRun: jest.fn(async (id: string) => clone(runs.get(id) ?? null)),
  activeRunForScene: jest.fn(async (sceneId: string) => clone([...runs.values()].find((r) => r.sceneId === sceneId && ACTIVE_RUN.has(r.status)) ?? null)),
  createRun: jest.fn(async (input: any) => {
    const run = { ...clone(input), id: `run${++seq}` };
    runs.set(run.id, run);
    return clone(run);
  }),
  getYoutubeAccount: jest.fn(async (id?: string) => clone(id ? accounts.find((a) => a.id === id) ?? null : accounts[0] ?? null)),
  getScene: jest.fn(async (id: string) => ({ id, name: id === "shorts" ? "Shorts · Render" : id })),
  countryRoundups: { latestForPlace: jest.fn(async () => null) },
  regionRoundups: { latestForPlace: jest.fn(async (): Promise<any> => null) },
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

import {
  advanceRenderQueues,
  controlRender,
  planRenderStarts,
  queueRender,
  renderOutcomeForRun,
  renderRunLive,
  renderRunSettled,
  resolveVideoText,
  type PlanInput,
} from "./render-queue";
import { generateShortScript } from "../director/script-generate";
import { exhaustedUntil, quotaSnapshot } from "../youtube/quota";
import type { ShortRender } from "@photonsurge/shared/short-render";

const NOW = Date.parse("2026-10-04T06:00:00Z"); // 07:00 London
const clip = (id: string, target = "region:europe", durationMs = 60_000) => ({ id, target, durationMs, label: { title: id } });
const script = (id: string, extra: any = {}) => {
  const s = { id, template: "lineup", scope: { type: "area", id: "europe" }, include: { alerts: false, quakes: false, volcanoes: false }, title: id, clips: [clip("c1"), clip("c2", "region:europe", 6_000)], status: "draft", ...extra };
  scripts.set(id, s);
  return s;
};
const videoEncoder = (id: string, extra: any = {}) => encoders.push({ id, url: `ws://${id}`, enabled: true, use: "videos", ...extra });
const req = (scriptId: string, extra: any = {}) => ({ encoderId: "obs-v1", what: { type: "script", scriptId }, publishAs: "public", offline: false, ...extra });
const goLiveRunIds = () => jobs.filter((j) => j.event === "goLive").map((j) => j.data.runId);
const statusOf = (id: string) => renders.get(id)?.status;

/** The run of a render finishing the way finishRun leaves it, then the hook. */
async function endRun(runId: string, how: "finished" | "failed" | "stopped") {
  const run = runs.get(runId);
  if (how === "finished") Object.assign(run, { status: "ended", endedAt: NOW + 1, script: { ...run.script, playEnded: "finished" }, platforms: { youtube: { watchUrl: "https://youtu.be/v" } } });
  if (how === "failed") Object.assign(run, { status: "failed", endedAt: NOW + 1, error: { step: "deadline", message: "did not go live" } });
  if (how === "stopped") Object.assign(run, { status: "stopped", endedAt: NOW + 1 });
  await renderRunSettled(clone(run));
}

beforeEach(() => {
  renders.clear();
  runs.clear();
  scripts.clear();
  formats.clear();
  encoders.length = 0;
  slots.length = 0;
  paused.clear();
  jobs.length = 0;
  seq = 0;
  jest.clearAllMocks();
});

// ---- the planner ----

describe("planRenderStarts", () => {
  const r = (id: string, encoderId: string, queuedAt: number, extra: Partial<ShortRender> = {}): ShortRender =>
    ({ id, encoderId, what: { type: "script", scriptId: id }, publishAs: "unlisted", offline: false, status: "queued", queuedAt, ...extra }) as ShortRender;
  const base = (over: Partial<PlanInput>): PlanInput => ({
    renders: [],
    encoders: [
      { id: "v1", enabled: true, use: "videos" },
      { id: "v2", enabled: true, use: "videos" },
      { id: "ch", enabled: true, use: "channels", sceneId: "default" },
    ],
    activeRuns: [],
    slots: [],
    paused: new Set(),
    formatOf: (x) => (x.id.startsWith("b") ? "fmtB" : "fmtA"),
    ...over,
  });

  it("an encoder takes its own queue in order, one video at a time", () => {
    const picks = planRenderStarts(base({ renders: [r("a2", "v1", 2), r("b1", "v1", 1)] }));
    expect(picks).toEqual([{ renderId: "b1", encoderId: "v1" }]);
  });

  it("'any' videos go to idle video encoders — in parallel only across formats", () => {
    const picks = planRenderStarts(base({ renders: [r("a1", "any", 1), r("b1", "any", 2), r("a2", "any", 3)] }));
    expect(picks).toEqual([
      { renderId: "a1", encoderId: "v1" },
      { renderId: "b1", encoderId: "v2" },
    ]);
  });

  it("a channel encoder never takes from the 'any' pool, only videos named for it", () => {
    expect(planRenderStarts(base({ encoders: [{ id: "ch", enabled: true, use: "channels" }], renders: [r("a1", "any", 1)] }))).toEqual([]);
    expect(planRenderStarts(base({ encoders: [{ id: "ch", enabled: true }], renders: [r("a1", "ch", 1)] }))).toEqual([{ renderId: "a1", encoderId: "ch" }]);
  });

  it("WAITS when the next video's format is busy elsewhere — it does not skip ahead", () => {
    const picks = planRenderStarts(
      base({
        renders: [r("a-live", "v2", 0, { status: "live", assignedEncoderId: "v2" }), r("a1", "v1", 1), r("b1", "v1", 2)],
      }),
    );
    expect(picks).toEqual([]); // v1's head (fmtA) is rendering on v2; b1 stays behind it
  });

  it("a channel run on the encoder blocks its queue until it ends; it is never pre-empted", () => {
    const blocked = base({ activeRuns: [{ id: "run", encoderId: "v1", sceneId: "default", status: "live" }], renders: [r("a1", "v1", 1)] });
    expect(planRenderStarts(blocked)).toEqual([]);
    expect(planRenderStarts({ ...blocked, activeRuns: [{ id: "run", encoderId: "v1", sceneId: "default", status: "ended" }] })).toHaveLength(1);
  });

  it("an encoder held by an enabled slot, paused or disabled takes nothing", () => {
    const rs = [r("a1", "ch", 1), r("b1", "v1", 2), r("a2", "v2", 3)];
    const picks = planRenderStarts(
      base({
        renders: rs,
        slots: [{ id: "main", enabled: true, sceneId: "default" }],
        paused: new Set(["v1"]),
        encoders: [
          { id: "ch", enabled: true, sceneId: "default" },
          { id: "v1", enabled: true, use: "videos" },
          { id: "v2", enabled: false, use: "videos" },
        ],
      }),
    );
    expect(picks).toEqual([]);
  });
});

// ---- the text ----

describe("resolveVideoText", () => {
  const video = {
    title: "%{place} %{kind} · %A %e %B (%{duration})",
    description: "100% %{place}. %{headline}",
    timezone: "Europe/London",
    thumbnail: { source: "image" as const, url: "/thumbs/%{placeId}.png" },
    tags: [],
    categoryId: "",
    publishAs: "unlisted" as const,
    chapters: true,
  };

  it("resolves values, date codes and duration in one pass, appends the site link, and fills the thumbnail template", () => {
    const out = resolveVideoText(video, { place: "Europe", placeId: "europe", kind: "round-up", headline: "Storms %d." }, 105_000, new Date(NOW), "https://wx.example");
    expect(out.title).toBe("Europe round-up · Sunday 4 October (1:45)");
    expect(out.description).toBe("100% Europe. Storms %d.\n\nWatch the map live: https://wx.example");
    expect(out.thumbnailUrl).toBe("/thumbs/europe.png");
  });

  it("cuts a long title at a word with an ellipsis; a frame thumbnail resolves to none (until WP8)", () => {
    const out = resolveVideoText({ ...video, title: "word ".repeat(40), description: "", thumbnail: { source: "frame", atMs: 1000 } }, {}, 1000, new Date(NOW), "");
    expect(Array.from(out.title).length).toBeLessThanOrEqual(100);
    expect(out.title.endsWith("…")).toBe(true);
    expect(out.thumbnailUrl).toBeUndefined();
    expect(out.description).toBe("");
  });

  it("falls back to London for 'place' and an unknown zone", () => {
    const late = new Date("2026-10-04T23:30:00Z"); // already Monday in London
    expect(resolveVideoText({ ...video, title: "%A", timezone: "place" }, {}, 0, late, "").title).toBe("Monday");
    expect(resolveVideoText({ ...video, title: "%A", timezone: "Not/AZone" }, {}, 0, late, "").title).toBe("Monday");
    expect(resolveVideoText({ ...video, title: "%A", timezone: "America/New_York" }, {}, 0, late, "").title).toBe("Sunday");
  });
});

describe("renderOutcomeForRun", () => {
  it("maps each way a run can end", () => {
    const base = { id: "r", sceneId: "s", platforms: { youtube: { watchUrl: "u" } }, script: { scriptId: "s", offline: false, publishAs: "public", leadInMs: 0, leadOutMs: 0 } } as any;
    expect(renderOutcomeForRun({ ...base, status: "ended", script: { ...base.script, playEnded: "finished" } })).toEqual({ status: "done", videoUrl: "u" });
    expect(renderOutcomeForRun({ ...base, status: "stopped" })).toEqual({ status: "failed", note: "stopped by operator" });
    expect(renderOutcomeForRun({ ...base, status: "failed", error: { message: "boom" } })).toEqual({ status: "failed", note: "boom" });
    expect(renderOutcomeForRun({ ...base, status: "ended" }).note).toMatch(/safety cap/);
  });
});

// ---- the queue ----

describe("a three-video batch with one failure", () => {
  it("runs the videos back to back on the encoder; the failed one is recorded and the batch carries on", async () => {
    videoEncoder("obs-v1");
    script("s1");
    script("s3");
    (generateShortScript as jest.Mock).mockRejectedValueOnce(new Error("No usable round-up for United Kingdom"));
    const one = await queueRender(req("s1", { batchId: "b" }), NOW);
    const two = await queueRender({ ...req("x"), what: { type: "generate", formatId: "shorts", scope: { type: "country", id: "uk" } }, batchId: "b" } as any, NOW);
    const three = await queueRender(req("s3", { batchId: "b" }), NOW);

    // One video at a time: only the first has a run.
    expect(statusOf(one.id)).toBe("preparing");
    expect(statusOf(two.id)).toBe("queued");
    expect(statusOf(three.id)).toBe("queued");
    expect(goLiveRunIds()).toHaveLength(1);
    const run1 = renders.get(one.id).runId;

    await renderRunLive(clone(runs.get(run1)));
    expect(statusOf(one.id)).toBe("live");

    // The first ends: done; the second fails at generate; the third starts in the same pass.
    await endRun(run1, "finished");
    expect(renders.get(one.id)).toMatchObject({ status: "done", videoUrl: "https://youtu.be/v" });
    expect(renders.get(two.id)).toMatchObject({ status: "failed", note: expect.stringMatching(/^generate failed: No usable round-up/) });
    expect(statusOf(three.id)).toBe("preparing");
    expect(goLiveRunIds()).toHaveLength(2);

    await endRun(renders.get(three.id).runId, "finished");
    expect(statusOf(three.id)).toBe("done");
    expect(goLiveRunIds()).toHaveLength(2); // nothing left
  });

  it("a run that fails records the run's error on its render", async () => {
    videoEncoder("obs-v1");
    script("s1");
    const r1 = await queueRender(req("s1"), NOW);
    await endRun(renders.get(r1.id).runId, "failed");
    expect(renders.get(r1.id)).toMatchObject({ status: "failed", note: "did not go live" });
  });
});

describe("quota", () => {
  it("fails a video before anything is created when the meter can't cover it, and the batch continues", async () => {
    videoEncoder("obs-v1");
    script("s1");
    script("s2");
    (quotaSnapshot as jest.Mock).mockResolvedValueOnce({ remaining: 450 }); // < 400 + 100
    const a = await queueRender(req("s1"), NOW);
    expect(renders.get(a.id)).toMatchObject({ status: "failed", note: expect.stringMatching(/^quota low: 450 YouTube API units left today, a video needs about 500/) });
    expect(db.createRun).not.toHaveBeenCalled();
    expect(jobs).toEqual([]);

    const b = await queueRender(req("s2"), NOW);
    expect(statusOf(b.id)).toBe("preparing");
    expect(db.createRun).toHaveBeenCalledTimes(1);
  });

  it("fails while the quota is marked exhausted; the estimate is a deployment env", async () => {
    videoEncoder("obs-v1");
    script("s1");
    (exhaustedUntil as jest.Mock).mockResolvedValueOnce(NOW + 3_600_000);
    const a = await queueRender(req("s1"), NOW);
    expect(renders.get(a.id).note).toBe("quota low: the YouTube API quota is spent until 07:00 UTC");

    process.env.RENDER_QUOTA_PER_VIDEO = "8950";
    try {
      const b = await queueRender(req("s1"), NOW);
      expect(renders.get(b.id).note).toMatch(/needs about 9050/);
    } finally {
      delete process.env.RENDER_QUOTA_PER_VIDEO;
    }
  });

  it("an offline rehearsal needs no quota and no account", async () => {
    videoEncoder("obs-v1");
    script("s1");
    (quotaSnapshot as jest.Mock).mockResolvedValue({ remaining: 0 });
    const a = await queueRender(req("s1", { offline: true }), NOW);
    expect(statusOf(a.id)).toBe("preparing");
    expect(runs.get(renders.get(a.id).runId).platforms).toEqual({});
    (quotaSnapshot as jest.Mock).mockResolvedValue({ remaining: 9_000 });
  });
});

describe("the run a render creates", () => {
  it("is unlisted, has no chat and announces nothing, plays on the script's scene, and carries the end settings", async () => {
    videoEncoder("obs-v1");
    script("s1");
    const r = await queueRender(
      req("s1", { video: { title: "%{place} %{kind} %d/%m", tags: ["weather"], categoryId: "25", playlistId: "PL1", publishAs: "private" } }),
      NOW,
    );
    const run = runs.get(renders.get(r.id).runId);
    expect(run).toMatchObject({
      sceneId: "shorts",
      encoderId: "obs-v1",
      status: "scheduled",
      privacy: "unlisted",
      title: "Europe round-up 04/10",
      chat: { enabled: false, promoteToTicker: false },
      announce: false,
      platforms: { youtube: { accountId: "UC1", monitorStream: false } },
      // script (66 s) + lead-in 3 s + lead-out 5 s + the 2 min safety cap.
      durationMs: 66_000 + 3_000 + 5_000 + 120_000,
      script: {
        scriptId: "s1",
        renderId: r.id,
        offline: false,
        publishAs: "private",
        leadInMs: 3_000,
        leadOutMs: 5_000,
        tags: ["weather"],
        categoryId: "25",
        playlistId: "PL1",
        chapters: true,
        thumbnailUrl: "",
      },
    });
    expect(run.description).toBe("Watch the map live: https://wx.example");
    // Values stamped on the script for next time.
    expect(db.shortScripts.stampValues).toHaveBeenCalledWith("s1", { place: "Europe", placeId: "europe", kind: "round-up" });
    expect(jobs).toEqual([{ event: "goLive", data: { runId: run.id } }]);
  });

  it("uses values already stamped on the script without recomputing them", async () => {
    videoEncoder("obs-v1");
    script("s1", { values: { place: "Stamped", kind: "round-up" } });
    const r = await queueRender(req("s1"), NOW);
    expect(runs.get(renders.get(r.id).runId).title).toMatch(/^Stamped round-up/);
    expect(db.shortScripts.stampValues).not.toHaveBeenCalled();
  });

  it("generates at the front, passing the format as the scene, and skips a quiet scope when asked", async () => {
    videoEncoder("obs-v1");
    (generateShortScript as jest.Mock).mockImplementation(async (_db: unknown, g: any) =>
      script("gen", { include: g.include ?? { alerts: false, quakes: false, volcanoes: false } }),
    );
    const quiet = await queueRender(
      { ...req("x"), what: { type: "generate", formatId: "shorts", scope: { type: "area", id: "europe" }, include: { alerts: true, quakes: false, volcanoes: false } }, skipIfQuiet: true } as any,
      NOW,
    );
    expect(generateShortScript).toHaveBeenCalledWith(db, { formatId: "shorts", scope: { type: "area", id: "europe" }, include: { alerts: true, quakes: false, volcanoes: false } });
    expect(renders.get(quiet.id)).toMatchObject({ status: "skipped", note: "quiet: nothing active in scope" });
    (generateShortScript as jest.Mock).mockReset();
  });

  it("checks the round-up's freshness at the front: skip, or fail when a refresh would be needed", async () => {
    videoEncoder("obs-v1");
    db.regionRoundups.latestForPlace.mockResolvedValue({ generatedAt: new Date(NOW - 20 * 3_600_000) });
    const what = { type: "generate", formatId: "shorts", scope: { type: "area", id: "europe" } };
    const skip = await queueRender({ ...req("x"), what, roundup: { maxAgeHours: 14, ifStale: "skip" } } as any, NOW);
    expect(renders.get(skip.id)).toMatchObject({ status: "skipped", note: "round-up for europe is 20 h old (limit 14 h)" });
    const refresh = await queueRender({ ...req("x"), what, roundup: { maxAgeHours: 14, ifStale: "refresh" } } as any, NOW);
    expect(renders.get(refresh.id)).toMatchObject({ status: "failed", note: expect.stringMatching(/not available yet \(WP9a\)/) });
    expect(generateShortScript).not.toHaveBeenCalled();
    db.regionRoundups.latestForPlace.mockResolvedValue(null);
  });
});

describe("the ticker", () => {
  it("skips a video still waiting past its startBy as too late", async () => {
    videoEncoder("obs-v1");
    script("s1");
    runs.set("ch", { id: "ch", sceneId: "default", encoderId: "obs-v1", status: "live" }); // a channel run holds the encoder
    const r = await queueRender(req("s1", { startBy: NOW + 60_000 }), NOW);
    expect(statusOf(r.id)).toBe("queued");
    await advanceRenderQueues(NOW + 61_000);
    expect(renders.get(r.id)).toMatchObject({ status: "skipped", note: "too late" });
  });

  it("settles a render whose run ended while its hook was lost (restart), then starts the next", async () => {
    videoEncoder("obs-v1");
    script("s1");
    script("s2");
    const a = await queueRender(req("s1"), NOW);
    const b = await queueRender(req("s2"), NOW);
    Object.assign(runs.get(renders.get(a.id).runId), { status: "stopped" }); // no hook fired
    await advanceRenderQueues(NOW);
    expect(renders.get(a.id)).toMatchObject({ status: "failed", note: "stopped by operator" });
    expect(statusOf(b.id)).toBe("preparing");
  });

  it("fails a render stuck preparing with no run (a crash mid-start)", async () => {
    renders.set("stuck", { id: "stuck", encoderId: "obs-v1", what: { type: "script", scriptId: "s" }, status: "preparing", queuedAt: NOW - 1, startedAt: NOW - 11 * 60_000 });
    await advanceRenderQueues(NOW);
    expect(renders.get("stuck")).toMatchObject({ status: "failed", note: expect.stringMatching(/interrupted/) });
  });
});

describe("controls", () => {
  it("pause holds the queue after the current video; resume starts the next", async () => {
    videoEncoder("obs-v1");
    script("s1");
    script("s2");
    const a = await queueRender(req("s1"), NOW);
    await controlRender({ action: "pause", encoderId: "obs-v1" });
    const b = await queueRender(req("s2"), NOW);
    await endRun(renders.get(a.id).runId, "finished");
    expect(statusOf(a.id)).toBe("done");
    expect(statusOf(b.id)).toBe("queued");
    await controlRender({ action: "resume", encoderId: "obs-v1" });
    expect(statusOf(b.id)).toBe("preparing");
  });

  it("cancel removes a queued video, and only a queued one", async () => {
    videoEncoder("obs-v1");
    script("s1");
    const a = await queueRender(req("s1"), NOW);
    const b = await queueRender(req("s1"), NOW);
    expect((await controlRender({ action: "cancel", renderId: b.id })).render).toMatchObject({ status: "cancelled" });
    expect((await controlRender({ action: "cancel", renderId: a.id })).ok).toBe(false);
  });

  it("retry queues a failed or skipped video again as a new render", async () => {
    videoEncoder("obs-v1");
    script("s1");
    (quotaSnapshot as jest.Mock).mockResolvedValueOnce({ remaining: 0 });
    const a = await queueRender(req("s1", { startBy: NOW + 1 }), NOW);
    expect(statusOf(a.id)).toBe("failed");
    const res = await controlRender({ action: "retry", renderId: a.id });
    expect(res.ok).toBe(true);
    expect(res.render).toMatchObject({ retryOf: a.id, status: "preparing", what: { type: "script", scriptId: "s1" } });
    expect(res.render!.startBy).toBeUndefined();
    expect((await controlRender({ action: "retry", renderId: res.render!.id })).ok).toBe(false);
  });

  it("stop ends the live video through the run's stop job (finishRun manual); the render then fails 'stopped by operator'", async () => {
    videoEncoder("obs-v1");
    script("s1");
    const a = await queueRender(req("s1"), NOW);
    const runId = renders.get(a.id).runId;
    jobs.length = 0;
    expect((await controlRender({ action: "stop", renderId: a.id })).ok).toBe(true);
    expect(jobs).toEqual([{ event: "stop", data: { runId } }]);
    await endRun(runId, "stopped");
    expect(renders.get(a.id)).toMatchObject({ status: "failed", note: "stopped by operator" });
  });
});

describe("the format (WP5)", () => {
  const { defaultShortFormat } = jest.requireActual("@photonsurge/shared/short-format");
  const uk = () => ({
    ...defaultShortFormat("short-uk", "UK round-up"),
    opener: { ...defaultShortFormat().opener, roundupDepth: "summary" },
    video: {
      ...defaultShortFormat().video,
      title: "%{flag} %{place} · %d %B",
      description: "Today: %{headline}",
      tags: ["uk", "weather"],
      categoryId: "28",
      playlistId: "PL-UK",
      thumbnail: { source: "image", url: "/thumbs/%{placeId}.png" },
      chapters: false,
    },
    timing: { leadInMs: 2_000, leadOutMs: 7_000 },
    render: { accountId: "UC2" },
  });

  it("takes the video card, timing and account from the script's format — not the scene's channel card", async () => {
    videoEncoder("obs-v1");
    accounts.push({ id: "UC2" });
    formats.set("short-uk", uk());
    script("s1", { formatId: "short-uk", values: { place: "United Kingdom", placeId: "uk", flag: "🇬🇧", headline: "Gales." } });
    const r = await queueRender(req("s1", { publishAs: "public" }), NOW);
    expect(renders.get(r.id).formatId).toBe("short-uk"); // stamped when queued
    const run = runs.get(renders.get(r.id).runId);
    expect(run).toMatchObject({
      sceneId: "short-uk",
      title: "🇬🇧 United Kingdom · 04 October",
      description: "Today: Gales.\n\nWatch the map live: https://wx.example",
      platforms: { youtube: { accountId: "UC2" } },
      durationMs: 66_000 + 2_000 + 7_000 + 120_000,
      script: { leadInMs: 2_000, leadOutMs: 7_000, tags: ["uk", "weather"], categoryId: "28", playlistId: "PL-UK", chapters: false, thumbnailUrl: "/thumbs/uk.png", publishAs: "public" },
    });
    accounts.pop();
  });

  it("stamps values with the format's name and round-up depth", async () => {
    const { scriptValues } = jest.requireMock("./script-values");
    videoEncoder("obs-v1");
    formats.set("short-uk", uk());
    script("s1", { formatId: "short-uk" });
    formats.get("short-uk").render = {};
    await queueRender(req("s1"), NOW);
    expect(scriptValues).toHaveBeenCalledWith(db, expect.objectContaining({ id: "s1" }), expect.objectContaining({ formatName: "UK round-up", roundupDepth: "summary" }));
  });

  it("fails a video whose format doesn't exist", async () => {
    videoEncoder("obs-v1");
    const r = await queueRender({ ...req("x"), what: { type: "generate", formatId: "short-gone", scope: { type: "globe" } } } as any, NOW);
    expect(renders.get(r.id)).toMatchObject({ status: "failed", note: expect.stringMatching(/no format "short-gone"/), formatId: "short-gone" });
    expect(db.createRun).not.toHaveBeenCalled();
  });
});
