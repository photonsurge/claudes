/** @jest-environment node */
/**
 * Plan-written (crossword plan §2, §10): which YouTube channel and encoder a
 * one-off run from Go live gets at POST /api/streams.
 *  - The run's pick, else the channel record's `youtube.accountId`.
 *  - A crossword channel with neither is refused with a message; so is one
 *    whose account needs reconnecting. Never the most recently connected one.
 *  - A weather channel keeps today's fallback to the most recently connected.
 *  - The picked encoder is recorded on the run; one already streaming is refused.
 */
jest.mock("../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../lib/require-admin", () => ({ requireAdmin: jest.fn(async () => ({ email: "op@example.com" })) }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToFore: jest.fn(async () => {}) }));

const scenes: Record<string, any> = {};
const encoders: Record<string, any> = {};
const accounts: Record<string, any> = {};
let activeEncoderRun: any = null;
const mostRecent = () => Object.values(accounts).sort((a: any, b: any) => b.connectedAt - a.connectedAt)[0] ?? null;
const db = {
  getOrInitBroadcastState: jest.fn(async () => scenes.default),
  getScene: jest.fn(async (id: string) => scenes[id] ?? null),
  activeRunForScene: jest.fn(async () => null),
  activeRunForEncoder: jest.fn(async (encoderId: string) =>
    activeEncoderRun && activeEncoderRun.encoderId === encoderId ? activeEncoderRun : null,
  ),
  getStreamEncoder: jest.fn(async (id: string) => encoders[id] ?? null),
  encoderForScene: jest.fn(async (sceneId: string) => Object.values(encoders).find((e: any) => e.sceneId === sceneId) ?? null),
  // As the real accessor: an id → that account (or null); none → the most recently connected.
  getYoutubeAccount: jest.fn(async (id?: string) => (id ? accounts[id] ?? null : mostRecent())),
  createRun: jest.fn(async (r: any) => ({ id: "run-new", ...r })),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

import { POST } from "./route";
import { sendToFore } from "@photonsurge/shared/bull/bull-queue";

const post = (body: unknown) =>
  (POST as (r: Request) => Promise<Response>)(
    new Request("http://x/api/streams", { method: "POST", body: JSON.stringify(body) }),
  );
const goLive = (sceneId: string, extra: Record<string, unknown> = {}) => post({ sceneId, platforms: { youtube: true }, ...extra });
const created = () => db.createRun.mock.calls.at(-1)![0];

beforeAll(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
  process.env.GOOGLE_OAUTH_SECRET = "sec";
});

beforeEach(() => {
  for (const o of [scenes, encoders, accounts]) for (const k of Object.keys(o)) delete o[k];
  activeEncoderRun = null;
  scenes.default = { id: "default", youtube: { title: "", description: "", thumbnailUrl: "" } };
  scenes.daily = { id: "daily", name: "Daily Crossword", surface: "crossword", youtube: { accountId: "UC-cw" } };
  scenes.empty = { id: "empty", name: "Empty Crossword", surface: "crossword", youtube: { accountId: "" } };
  scenes.blank = { id: "blank", name: "Blank Crossword", surface: "crossword", youtube: { accountId: "   " } };
  scenes.noyt = { id: "noyt", surface: "crossword" }; // no YouTube card at all, no name
  scenes.rusty = { id: "rusty", name: "Rusty Crossword", surface: "crossword", youtube: { accountId: "UC-stale" } };
  scenes.atlantic = { id: "atlantic", name: "Atlantic", surface: "globe", youtube: { accountId: "" } };
  scenes.legacy = { id: "legacy", name: "Legacy" }; // saved before `surface`: weather
  scenes.pinned = { id: "pinned", name: "Pinned weather", surface: "globe", youtube: { accountId: "UC-cw" } };
  accounts["UC-cw"] = { id: "UC-cw", channelTitle: "Crossword Live", refreshTokenEnc: "x", connectedAt: 1 };
  accounts["UC-wx"] = { id: "UC-wx", channelTitle: "Weather TV", refreshTokenEnc: "x", connectedAt: 9 };
  accounts["UC-stale"] = {
    id: "UC-stale",
    channelTitle: "Old Puzzles",
    refreshTokenEnc: "x",
    connectedAt: 5,
    authError: { kind: "auth-revoked", message: "revoked", at: 1 },
  };
  encoders["enc-atl"] = { id: "enc-atl", name: "Atlantic GPU", url: "ws://a", enabled: true, use: "channels", sceneId: "atlantic" };
  encoders["enc-spare"] = { id: "enc-spare", name: "Spare", url: "ws://s", enabled: true, use: "channels" };
  db.createRun.mockClear();
  (sendToFore as jest.Mock).mockClear();
});

describe("a crossword channel", () => {
  it("goes out on the YouTube channel stored on its record when the run names none", async () => {
    const res = await goLive("daily");
    expect(res.status).toBe(201);
    expect(created().platforms.youtube.accountId).toBe("UC-cw");
    expect(sendToFore).toHaveBeenCalledWith("stream", "run-lifecycle", "goLive", { runId: "run-new" });
  });

  it("goes out on the run's pick when one is given, for this run", async () => {
    const res = await goLive("daily", { accountId: "UC-wx" });
    expect(res.status).toBe(201);
    expect(created().platforms.youtube.accountId).toBe("UC-wx");
    expect(scenes.daily.youtube.accountId).toBe("UC-cw");
  });

  it.each(["empty", "blank", "noyt"])("%s: with none stored or picked it is refused with a message, nothing created", async (id) => {
    const res = await goLive(id);
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toMatch(/no YouTube channel/i);
    expect(db.createRun).not.toHaveBeenCalled();
    expect(sendToFore).not.toHaveBeenCalled();
  });

  it("names the channel in the refusal", async () => {
    const res = await goLive("empty");
    expect((await res.json()).error).toContain("Empty Crossword");
  });

  it("is refused when its stored YouTube channel needs reconnecting", async () => {
    const res = await goLive("rusty");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reconnect/i);
    expect(db.createRun).not.toHaveBeenCalled();
  });

  it("is refused when the picked YouTube channel needs reconnecting, even with a good one stored", async () => {
    const res = await goLive("daily", { accountId: "UC-stale" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/reconnect/i);
    expect(db.createRun).not.toHaveBeenCalled();
  });

  it("is refused when the picked YouTube channel is not connected", async () => {
    const res = await goLive("empty", { accountId: "UC-gone" });
    expect(res.status).toBe(400);
    expect(db.createRun).not.toHaveBeenCalled();
  });

  it("records the picked encoder on the run", async () => {
    const res = await goLive("daily", { encoderId: "enc-atl" });
    expect(res.status).toBe(201);
    expect(created()).toMatchObject({ sceneId: "daily", encoderId: "enc-atl" });
  });

  it("is refused on an encoder already streaming another run", async () => {
    activeEncoderRun = { id: "standing", sceneId: "atlantic", encoderId: "enc-atl", status: "live" };
    const res = await goLive("daily", { encoderId: "enc-atl" });
    expect(res.status).toBe(409);
    expect(db.createRun).not.toHaveBeenCalled();
  });
});

describe("a weather channel keeps today's behaviour", () => {
  it("with nothing stored or picked it goes out on the most recently connected account", async () => {
    const res = await goLive("atlantic");
    expect(res.status).toBe(201);
    expect(created().platforms.youtube.accountId).toBe("UC-wx");
  });

  it("the same for a channel saved before `surface` existed, and for the main channel", async () => {
    expect((await goLive("legacy")).status).toBe(201);
    expect(created().platforms.youtube.accountId).toBe("UC-wx");
    expect((await goLive("default")).status).toBe(201);
    expect(created().platforms.youtube.accountId).toBe("UC-wx");
  });

  it("a stored YouTube channel is used, and a pick still wins", async () => {
    expect((await goLive("pinned")).status).toBe(201);
    expect(created().platforms.youtube.accountId).toBe("UC-cw");
    expect((await goLive("pinned", { accountId: "UC-wx" })).status).toBe(201);
    expect(created().platforms.youtube.accountId).toBe("UC-wx");
  });

  it("with no encoder picked, its own bound encoder is used as before", async () => {
    expect((await goLive("atlantic")).status).toBe(201);
    expect(created().encoderId).toBe("enc-atl");
  });
});
