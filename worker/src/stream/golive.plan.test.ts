// Plan-written tests for going live (crossword plan §2, §3, §6.3, §10, §12 WP12).
//
// The run lifecycle and the encoder resolution are the real ones; OBS, YouTube
// and Mongo are fakes. OBS is a fake `provisionBrowserScene` (plus the output
// calls) that records which page each encoder is pointed at; YouTube is a fake
// account store and a fake `liveBroadcasts.insert` under the real
// `createBroadcast`, so what goes to YouTube is the request body itself.
//
// Covered: the page an encoder loads per channel kind; a run provisions the
// picked encoder on the RUN's channel and the encoder goes back to its own
// channel when the run ends; a busy encoder can't be taken; the YouTube account
// a run publishes to (stored, picked, refused for a crossword with none or one
// needing reconnecting, weather's fallback kept); low latency for crosswords
// only; title and description defaults; and, as a regression, a weather
// channel's standing slot on its own bound encoder behaving as before.

jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("./monitor", () => ({ startMonitor: jest.fn(), stopMonitor: jest.fn(), stopAllMonitors: jest.fn() }));
jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));
jest.mock("./chat", () => ({ startChatPoll: jest.fn(), stopChatPoll: jest.fn() }));
jest.mock("./chapters", () => ({ queueChapters: jest.fn(async () => {}), chaptersEnabled: () => false }));
jest.mock("./thumbnail", () => ({ queueThumbnail: jest.fn(async () => {}), thumbnailsEnabled: () => false }));
const fakeQueue = { add: jest.fn(async () => ({})), getJob: jest.fn(async () => null) };
jest.mock("@photonsurge/shared/bull/bull", () => ({ getQueue: jest.fn(() => fakeQueue) }));
jest.mock("../youtube/quota", () => ({
  exhaustedUntil: jest.fn(async () => null),
  spend: jest.fn(async () => {}),
  markExhausted: jest.fn(async () => {}),
  nextPacificMidnight: jest.fn(() => 0),
  fmtResetTime: jest.fn(() => ""),
  quotaSnapshot: jest.fn(async () => null),
}));

// ---- fake OBS: one record per encoder endpoint of the page it was pointed at ----
interface Provision {
  ep: string;
  url: string;
  sceneName: string;
  inputName: string;
}
const provisions: Provision[] = [];
const outputCalls: Array<[string, string]> = [];
jest.mock("../obs/client", () => {
  class ObsUnavailableError extends Error {
    constructor(m: string) {
      super(m);
      this.name = "ObsUnavailableError";
    }
  }
  return {
    ObsUnavailableError,
    envEndpoint: () => ({ url: "ws://env-obs:4455" }),
    provisionBrowserScene: jest.fn(async (ep: { url: string }, o: { url: string; sceneName: string; inputName: string }) => {
      provisions.push({ ep: ep.url, url: o.url, sceneName: o.sceneName, inputName: o.inputName });
      return {
        sceneName: o.sceneName,
        inputName: o.inputName,
        width: 1920,
        height: 1080,
        created: false,
        recreated: true,
        switched: true,
        refreshed: true,
        removedInputs: [],
        removedScenes: [],
      };
    }),
    refreshBrowserSource: jest.fn(async () => ""),
    getSourceScreenshot: jest.fn(async () => ({ mimeType: "image/jpeg", data: Buffer.from("") })),
    ensureOutputStopped: jest.fn(async () => false),
    setStreamKey: jest.fn(async (ep: { url: string }) => void outputCalls.push(["setStreamKey", ep.url])),
    startStream: jest.fn(async (ep: { url: string }) => void outputCalls.push(["startStream", ep.url])),
    stopStream: jest.fn(async (ep: { url: string }) => void outputCalls.push(["stopStream", ep.url])),
    lastStreamStateFor: jest.fn(() => undefined),
    outputInFlight: jest.fn(() => false),
    getStatus: jest.fn(async () => ({
      outputActive: true,
      outputReconnecting: false,
      outputBytes: 0,
      outputSkippedFrames: 0,
      outputTotalFrames: 0,
      outputDurationMs: 0,
      outputCongestion: 0,
    })),
  };
});

// ---- fake YouTube: connected accounts, and the real createBroadcast over a fake insert ----
const broadcastInserts: any[] = [];
const insertBroadcast = jest.fn(async (req: any) => {
  broadcastInserts.push(req.requestBody);
  return { data: { id: `bcast-${broadcastInserts.length}` } };
});
const clientAccounts: string[] = [];
jest.mock("../youtube/client", () => {
  const actual = jest.requireActual("../youtube/client");
  return {
    ...actual,
    // As the real one: a named account, else the most recently connected one.
    getYoutubeClient: jest.fn(async (accountId?: string) => {
      const acc = accountId ? accounts.get(accountId) : [...accounts.values()].sort((a, b) => b.connectedAt - a.connectedAt)[0];
      if (!acc) throw new Error("no YouTube channel connected");
      clientAccounts.push(acc.id);
      return { youtube: { liveBroadcasts: { insert: insertBroadcast } }, accountId: acc.id, channelId: acc.id };
    }),
    createStream: jest.fn(async () => ({ streamId: "strm", ingestionAddress: "rtmp://ingest", streamName: "key-1234" })),
    bindBroadcast: jest.fn(async () => {}),
    transitionBroadcast: jest.fn(async () => {}),
    getBroadcastLifeCycle: jest.fn(async () => "live"),
    getStreamStatus: jest.fn(async () => ({ streamStatus: "active", health: "good" })),
    getVideoStats: jest.fn(async () => []),
    resolveLiveChatId: jest.fn(async () => "chat-1"),
  };
});
jest.mock("../youtube/video-times", () => ({ stampVideoTimes: jest.fn(async () => {}) }));

// ---- fake Mongo ----
const scenes = new Map<string, any>();
const encoders = new Map<string, any>();
const runs = new Map<string, any>();
const accounts = new Map<string, any>();
const ACTIVE = new Set(["scheduled", "awaiting-ingest", "live", "ending"]);
const db = {
  getOrInitBroadcastState: jest.fn(async () => ({ ...scenes.get("default") })),
  getScene: jest.fn(async (id: string) => (scenes.has(id) ? { ...scenes.get(id) } : null)),
  getStreamEncoder: jest.fn(async (id: string) => (encoders.has(id) ? { ...encoders.get(id) } : null)),
  getYoutubeAccount: jest.fn(async (id?: string) =>
    id ? accounts.get(id) ?? null : [...accounts.values()].sort((a, b) => b.connectedAt - a.connectedAt)[0] ?? null,
  ),
  saveYoutubeAccount: jest.fn(async () => {}),
  getRun: jest.fn(async (id: string) => (runs.has(id) ? { ...runs.get(id) } : null)),
  updateRun: jest.fn(async (id: string, patch: any) => {
    const next = { ...(runs.get(id) ?? { id }), ...patch };
    runs.set(id, next);
    return { ...next };
  }),
  listRuns: jest.fn(async () => [...runs.values()]),
  activeRunForEncoder: jest.fn(
    async (encoderId: string, excludeRunId?: string) =>
      [...runs.values()].find(
        (r) =>
          r.id !== excludeRunId &&
          ACTIVE.has(r.status) &&
          !!r.platforms?.youtube &&
          (r.encoderId || "env") === (encoderId || "env"),
      ) ?? null,
  ),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

import { goLive, finishRun } from "./lifecycle";
import { provisionEncoderScene, watchUrlForScene } from "./encoders";
import { resolveRunAccountId, RunAccountError, channelYoutubeSettings } from "./channel-youtube";

const BASE = "https://wx.example";

function seed() {
  scenes.set("default", { id: "default", watchToken: "main-tok", youtube: { title: "", description: "", thumbnailUrl: "" } });
  scenes.set("atlantic", {
    id: "atlantic",
    name: "Atlantic Wind",
    surface: "globe",
    watchToken: "atl-tok",
    youtube: { title: "", description: "", thumbnailUrl: "" },
  });
  scenes.set("legacy", { id: "legacy", name: "Legacy", watchToken: "leg-tok" }); // saved before `surface`
  scenes.set("daily", {
    id: "daily",
    name: "Daily Crossword",
    surface: "crossword",
    watchToken: "cw-tok",
    youtube: { title: "", description: "", thumbnailUrl: "", accountId: "UC-cw" },
  });
  scenes.set("bare", {
    id: "bare",
    name: "Bare Crossword",
    surface: "crossword",
    watchToken: "bare-tok",
    youtube: { title: "", description: "", thumbnailUrl: "", accountId: "" },
  });
  encoders.set("enc-main", { id: "enc-main", name: "Main GPU", url: "ws://main-obs:4455", enabled: true, use: "channels", sceneId: "default" });
  encoders.set("enc-atl", { id: "enc-atl", name: "Atlantic GPU", url: "ws://atl-obs:4455", enabled: true, use: "channels", sceneId: "atlantic" });
  encoders.set("enc-spare", { id: "enc-spare", name: "Spare", url: "ws://spare-obs:4455", enabled: true, use: "channels" });
  encoders.set("enc-video", { id: "enc-video", name: "Video GPU", url: "ws://video-obs:4455", enabled: true, use: "videos" });
  // The weather account was connected most recently: today's fallback picks it.
  accounts.set("UC-cw", { id: "UC-cw", channelTitle: "Crosswords TV", refreshTokenEnc: "x", connectedAt: 1 });
  accounts.set("UC-wx", { id: "UC-wx", channelTitle: "Weather TV", refreshTokenEnc: "x", connectedAt: 5 });
  accounts.set("UC-stale", {
    id: "UC-stale",
    channelTitle: "Stale TV",
    refreshTokenEnc: "x",
    connectedAt: 3,
    authError: { kind: "auth-revoked", message: "revoked", at: 1 },
  });
}

const newRun = (r: Record<string, unknown>) =>
  runs.set(String(r.id), { status: "scheduled", phase: "created", platforms: { youtube: {} }, durationMs: null, ...r });

const provisionsFor = (ep: string) => provisions.filter((p) => p.ep === ep);

beforeAll(() => {
  process.env.PUBLIC_BASE_URL = BASE;
  process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
  process.env.GOOGLE_OAUTH_SECRET = "sec";
});
afterAll(() => {
  delete process.env.PUBLIC_BASE_URL;
});
beforeEach(() => {
  scenes.clear();
  encoders.clear();
  runs.clear();
  accounts.clear();
  provisions.length = 0;
  outputCalls.length = 0;
  broadcastInserts.length = 0;
  clientAccounts.length = 0;
  jest.clearAllMocks();
  seed();
});

// ---------------------------------------------------------------------------

describe("watchUrlForScene per kind (§3, §12)", () => {
  it("a crossword channel loads /crossword/<id>?token=…", async () => {
    await expect(watchUrlForScene("daily")).resolves.toBe(`${BASE}/crossword/daily?token=cw-tok`);
  });

  it("a weather channel loads /watch/<id>?token=…", async () => {
    await expect(watchUrlForScene("atlantic")).resolves.toBe(`${BASE}/watch/atlantic?token=atl-tok`);
  });

  it("a channel saved before `surface` existed is weather", async () => {
    await expect(watchUrlForScene("legacy")).resolves.toBe(`${BASE}/watch/legacy?token=leg-tok`);
  });

  it("the main channel is always weather", async () => {
    await expect(watchUrlForScene("default")).resolves.toBe(`${BASE}/watch/default?token=main-tok`);
  });
});

describe("provisionEncoderScene with the run's channel (§10)", () => {
  it("points a picked encoder at the overriding channel's page and names the OBS scene after it", async () => {
    const p = await provisionEncoderScene("enc-main", { sceneId: "daily" });
    expect(p.sceneId).toBe("daily");
    expect(p.url).toBe(`${BASE}/crossword/daily?token=cw-tok`);
    expect(provisions).toEqual([
      {
        ep: "ws://main-obs:4455",
        url: `${BASE}/crossword/daily?token=cw-tok`,
        sceneName: "PhotonSurge — daily",
        inputName: "PhotonSurge globe — daily",
      },
    ]);
  });

  it("without an override shows the encoder's own bound channel, as before", async () => {
    const p = await provisionEncoderScene("enc-atl");
    expect(p.url).toBe(`${BASE}/watch/atlantic?token=atl-tok`);
    expect(provisions[0]).toMatchObject({ ep: "ws://atl-obs:4455", sceneName: "PhotonSurge — atlantic" });
  });
});

describe("a crossword run on a picked encoder (§10)", () => {
  it("provisions the picked encoder with the crossword page, and hands it back to its own channel when the run ends", async () => {
    newRun({ id: "cw1", sceneId: "daily", encoderId: "enc-main" });
    await goLive("cw1");
    expect(runs.get("cw1").status).toBe("awaiting-ingest");

    const during = provisionsFor("ws://main-obs:4455");
    expect(during).toHaveLength(1);
    expect(during[0]).toMatchObject({ url: `${BASE}/crossword/daily?token=cw-tok`, sceneName: "PhotonSurge — daily" });
    // The output went out through the picked encoder, not the env OBS.
    expect(outputCalls).toContainEqual(["startStream", "ws://main-obs:4455"]);
    expect(outputCalls.some(([, ep]) => ep === "ws://env-obs:4455")).toBe(false);

    await finishRun("cw1", "manual");
    expect(runs.get("cw1").status).toBe("stopped");
    const after = provisionsFor("ws://main-obs:4455");
    expect(after).toHaveLength(2);
    expect(after[1]).toMatchObject({ url: `${BASE}/watch/default?token=main-tok`, sceneName: "PhotonSurge — default" });
  });

  it("a weather channel borrowing another channel's encoder is handed back the same way", async () => {
    newRun({ id: "wx-borrow", sceneId: "atlantic", encoderId: "enc-main", platforms: { youtube: {} } });
    await goLive("wx-borrow");
    expect(provisionsFor("ws://main-obs:4455")[0].url).toBe(`${BASE}/watch/atlantic?token=atl-tok`);
    await finishRun("wx-borrow", "auto");
    const all = provisionsFor("ws://main-obs:4455");
    expect(all.at(-1)!.url).toBe(`${BASE}/watch/default?token=main-tok`);
  });

  it("a video encoder lent to a crossword run goes back to its blank idle page, not the main channel", async () => {
    newRun({ id: "cw-vid", sceneId: "daily", encoderId: "enc-video" });
    await goLive("cw-vid");
    expect(provisionsFor("ws://video-obs:4455")[0].url).toBe(`${BASE}/crossword/daily?token=cw-tok`);
    await finishRun("cw-vid", "manual");
    const last = provisionsFor("ws://video-obs:4455").at(-1)!;
    expect(last.url).toBe("about:blank");
    expect(last.url).not.toContain("/watch/default");
  });

  it("an encoder already streaming another run can't be taken: the run fails before OBS or YouTube is touched", async () => {
    newRun({ id: "standing", sceneId: "atlantic", encoderId: "enc-atl", status: "live", platforms: { youtube: { broadcastId: "b0" } } });
    newRun({ id: "cw-busy", sceneId: "daily", encoderId: "enc-atl" });
    await goLive("cw-busy");
    expect(runs.get("cw-busy").status).toBe("failed");
    expect(runs.get("cw-busy").error.message).toMatch(/already streaming run standing/);
    expect(provisions).toHaveLength(0);
    expect(insertBroadcast).not.toHaveBeenCalled();
    // Nor is the standing run's output stopped or its encoder re-provisioned.
    expect(outputCalls.filter(([c]) => c === "stopStream")).toHaveLength(0);
    expect(runs.get("standing").status).toBe("live");
  });

  it("does not hand the encoder back while another run holds it", async () => {
    newRun({ id: "cw2", sceneId: "daily", encoderId: "enc-spare" });
    await goLive("cw2");
    // Something else took the spare encoder meanwhile (e.g. a race the guard missed).
    runs.set("other", { id: "other", sceneId: "atlantic", encoderId: "enc-spare", status: "live", platforms: { youtube: {} } });
    const before = provisions.length;
    await finishRun("cw2", "manual");
    expect(provisions.length).toBe(before);
  });
});

describe("regression: a weather channel's standing slot on its own bound encoder (§10)", () => {
  it("provisions the same scene as before and restores or reprovisions nothing when the run ends", async () => {
    newRun({ id: "slot-run", sceneId: "atlantic", encoderId: "enc-atl", slotId: "slot-atl", durationMs: null });
    await goLive("slot-run");
    expect(provisions).toEqual([
      {
        ep: "ws://atl-obs:4455",
        url: `${BASE}/watch/atlantic?token=atl-tok`,
        sceneName: "PhotonSurge — atlantic",
        inputName: "PhotonSurge globe — atlantic",
      },
    ]);
    await finishRun("slot-run", "auto");
    expect(runs.get("slot-run").status).toBe("ended");
    expect(provisions).toHaveLength(1);
    // Weather broadcasts keep YouTube's default latency.
    expect(broadcastInserts[0].contentDetails).not.toHaveProperty("latencyPreference");
  });

  it("the main channel on the env OBS is provisioned on /watch/default and not touched again at the end", async () => {
    newRun({ id: "main-run", sceneId: "default" });
    await goLive("main-run");
    expect(provisions).toEqual([
      expect.objectContaining({ ep: "ws://env-obs:4455", url: `${BASE}/watch/default?token=main-tok`, sceneName: "PhotonSurge — default" }),
    ]);
    await finishRun("main-run", "manual");
    expect(provisions).toHaveLength(1);
  });

  it("a run that failed before reaching OBS restores nothing", async () => {
    newRun({ id: "cw-noacc", sceneId: "bare", encoderId: "enc-main" });
    await goLive("cw-noacc");
    expect(runs.get("cw-noacc").status).toBe("failed");
    expect(provisions).toHaveLength(0);
  });
});

describe("which YouTube channel a run goes out on (§2, §10)", () => {
  it("a crossword run naming none goes out on the channel record's YouTube channel, not the most recent", async () => {
    newRun({ id: "cw-stored", sceneId: "daily", encoderId: "enc-spare" });
    await goLive("cw-stored");
    expect(clientAccounts[0]).toBe("UC-cw");
    expect(runs.get("cw-stored").platforms.youtube.accountId).toBe("UC-cw");
  });

  it("the run's own pick wins over the channel record (changed for one run)", async () => {
    newRun({ id: "cw-pick", sceneId: "daily", encoderId: "enc-spare", platforms: { youtube: { accountId: "UC-wx" } } });
    await goLive("cw-pick");
    expect(clientAccounts[0]).toBe("UC-wx");
    expect(runs.get("cw-pick").platforms.youtube.accountId).toBe("UC-wx");
    // The pick is for this run only: the channel record is unchanged.
    expect(scenes.get("daily").youtube.accountId).toBe("UC-cw");
  });

  it("a crossword channel with none stored or picked is refused with a message, before any YouTube call", async () => {
    newRun({ id: "cw-none", sceneId: "bare", encoderId: "enc-spare" });
    await goLive("cw-none");
    const run = runs.get("cw-none");
    expect(run.status).toBe("failed");
    expect(run.error.message).toMatch(/no YouTube channel/i);
    expect(run.error.message).toContain("Bare Crossword");
    expect(clientAccounts).toHaveLength(0);
    expect(insertBroadcast).not.toHaveBeenCalled();
  });

  it("a crossword channel whose YouTube channel needs reconnecting is refused", async () => {
    scenes.set("daily", { ...scenes.get("daily"), youtube: { ...scenes.get("daily").youtube, accountId: "UC-stale" } });
    newRun({ id: "cw-stale", sceneId: "daily", encoderId: "enc-spare" });
    await goLive("cw-stale");
    expect(runs.get("cw-stale").status).toBe("failed");
    expect(runs.get("cw-stale").error.message).toMatch(/reconnect/i);
    expect(insertBroadcast).not.toHaveBeenCalled();
  });

  it("a crossword run picking an account that needs reconnecting is refused too", async () => {
    newRun({ id: "cw-stale-pick", sceneId: "daily", encoderId: "enc-spare", platforms: { youtube: { accountId: "UC-stale" } } });
    await goLive("cw-stale-pick");
    expect(runs.get("cw-stale-pick").status).toBe("failed");
    expect(runs.get("cw-stale-pick").error.message).toMatch(/reconnect/i);
    expect(insertBroadcast).not.toHaveBeenCalled();
  });

  it("a weather channel with nothing stored keeps today's fallback: the most recently connected account", async () => {
    newRun({ id: "wx-fallback", sceneId: "atlantic", encoderId: "enc-atl" });
    await goLive("wx-fallback");
    expect(runs.get("wx-fallback").status).toBe("awaiting-ingest");
    expect(clientAccounts[0]).toBe("UC-wx");
    expect(runs.get("wx-fallback").platforms.youtube.accountId).toBe("UC-wx");
  });

  it("resolveRunAccountId: crossword refused with no account, weather returns undefined (client default)", async () => {
    const cw = await channelYoutubeSettings("bare");
    await expect(resolveRunAccountId("bare", undefined, cw)).rejects.toBeInstanceOf(RunAccountError);
    await expect(resolveRunAccountId("bare", "  ", cw)).rejects.toBeInstanceOf(RunAccountError);
    await expect(resolveRunAccountId("bare", "UC-cw", cw)).resolves.toBe("UC-cw");
    const wx = await channelYoutubeSettings("atlantic");
    await expect(resolveRunAccountId("atlantic", undefined, wx)).resolves.toBeUndefined();
    await expect(resolveRunAccountId("atlantic", "UC-cw", wx)).resolves.toBe("UC-cw");
  });
});

describe("broadcast latency (§2, §6.3)", () => {
  it("a crossword broadcast asks YouTube for low latency", async () => {
    newRun({ id: "cw-lat", sceneId: "daily", encoderId: "enc-spare" });
    await goLive("cw-lat");
    expect(broadcastInserts).toHaveLength(1);
    expect(broadcastInserts[0].contentDetails.latencyPreference).toBe("low");
  });

  it("a weather broadcast sets no latency preference (YouTube's default)", async () => {
    newRun({ id: "wx-lat", sceneId: "atlantic", encoderId: "enc-atl" });
    await goLive("wx-lat");
    expect(broadcastInserts).toHaveLength(1);
    expect(broadcastInserts[0].contentDetails).not.toHaveProperty("latencyPreference");
  });
});

describe("title and description defaults (§10, WP12)", () => {
  it("a crossword channel with a blank YouTube card gets a crossword title and description, not the weather copy", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] }).setSystemTime(new Date("2026-10-05T12:00:00Z"));
    try {
      newRun({ id: "cw-title", sceneId: "daily", encoderId: "enc-spare" });
      await goLive("cw-title");
    } finally {
      jest.useRealTimers();
    }
    const { snippet } = broadcastInserts[0];
    expect(snippet.title).toContain("Daily Crossword");
    expect(snippet.title).toMatch(/crossword/i);
    expect(snippet.title).not.toMatch(/weather/i);
    expect(snippet.title).not.toMatch(/^Live — daily/);
    expect(typeof snippet.description).toBe("string");
    expect(snippet.description.length).toBeGreaterThan(0);
    expect(snippet.description).toMatch(/crossword/i);
    expect(snippet.description).not.toMatch(/weather globe/i);
    expect(snippet.description).not.toMatch(/Watch the map live/);
    // No unresolved date codes reach YouTube.
    expect(snippet.title).not.toMatch(/%[A-Za-z]/);
    expect(snippet.description).not.toMatch(/%[A-Za-z]/);
  });

  it("a crossword channel's own title and description templates win, and a run title wins over both", async () => {
    scenes.set("daily", {
      ...scenes.get("daily"),
      youtube: { ...scenes.get("daily").youtube, title: "Puzzle hour %d/%m", description: "Solve along" },
    });
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] }).setSystemTime(new Date("2026-10-05T12:00:00Z"));
    try {
      newRun({ id: "cw-own", sceneId: "daily", encoderId: "enc-spare" });
      await goLive("cw-own");
      runs.set("cw-own", { ...runs.get("cw-own"), status: "ended" });
      newRun({ id: "cw-runtitle", sceneId: "daily", encoderId: "enc-spare", title: "Special edition" });
      await goLive("cw-runtitle");
    } finally {
      jest.useRealTimers();
    }
    expect(broadcastInserts[0].snippet.title).toBe("Puzzle hour 05/10");
    expect(broadcastInserts[0].snippet.description).toContain("Solve along");
    expect(broadcastInserts[1].snippet.title).toBe("Special edition");
  });

  it("a weather channel keeps its defaults: the automatic title and the weather copy with the map link", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] }).setSystemTime(new Date("2026-10-05T12:00:00Z"));
    try {
      newRun({ id: "wx-title", sceneId: "atlantic", encoderId: "enc-atl" });
      await goLive("wx-title");
    } finally {
      jest.useRealTimers();
    }
    const { snippet } = broadcastInserts[0];
    expect(snippet.title).toBe("Live — atlantic — 2026-10-05");
    expect(snippet.description).toMatch(/weather globe/);
    expect(snippet.description).toContain(`Watch the map live: ${BASE}`);
  });
});
