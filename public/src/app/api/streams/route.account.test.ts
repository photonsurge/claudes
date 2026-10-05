/** @jest-environment node */
/**
 * Which YouTube channel a one-off run publishes to (crossword plan §10): the
 * run's pick, else the channel record's `youtube.accountId`; a crossword
 * channel with neither — or with an account that needs reconnecting — is
 * refused, never put on the most recently connected account. Weather channels
 * keep that fallback.
 */
jest.mock("../../../lib/api-log", () => ({ withApiLog: (h: unknown) => h }));
jest.mock("../../../lib/require-admin", () => ({ requireAdmin: jest.fn(async () => ({ email: "op@example.com" })) }));
jest.mock("@photonsurge/shared/bull/bull-queue", () => ({ sendToFore: jest.fn() }));

const scenes: Record<string, any> = {};
const accounts: Record<string, any> = {
  "UC-weather": { id: "UC-weather", channelTitle: "Weather", refreshTokenEnc: "x", connectedAt: 2 },
  "UC-cw": { id: "UC-cw", channelTitle: "Crosswords", refreshTokenEnc: "x", connectedAt: 1 },
  "UC-stale": { id: "UC-stale", channelTitle: "Stale", refreshTokenEnc: "x", authError: { kind: "auth-revoked", message: "x", at: 1 } },
};
const db = {
  getOrInitBroadcastState: jest.fn(async () => ({ id: "default" })),
  getScene: jest.fn(async (id: string) => scenes[id] ?? null),
  activeRunForScene: jest.fn(async () => null),
  activeRunForEncoder: jest.fn(async () => null),
  getStreamEncoder: jest.fn(async () => null),
  encoderForScene: jest.fn(async () => null),
  // The real accessor: an id → that account; none → the most recently connected one.
  getYoutubeAccount: jest.fn(async (id?: string) => (id ? accounts[id] ?? null : accounts["UC-weather"])),
  createRun: jest.fn(async (r: any) => ({ id: "new-run", ...r })),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

import { POST } from "./route";
import { sendToFore } from "@photonsurge/shared/bull/bull-queue";

const post = (body: unknown) =>
  (POST as (r: Request) => Promise<Response>)(new Request("http://x/api/streams", { method: "POST", body: JSON.stringify(body) }));
const goLive = (sceneId: string, extra: Record<string, unknown> = {}) =>
  post({ sceneId, platforms: { youtube: true }, ...extra });
const createdAccount = () => db.createRun.mock.calls.at(-1)![0].platforms.youtube.accountId;

beforeAll(() => {
  process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
  process.env.GOOGLE_OAUTH_SECRET = "sec";
});
beforeEach(() => {
  for (const k of Object.keys(scenes)) delete scenes[k];
  scenes.daily = { id: "daily", name: "Daily Crossword", surface: "crossword", youtube: { accountId: "UC-cw" } };
  scenes.bare = { id: "bare", name: "Bare Crossword", surface: "crossword", youtube: { accountId: "" } };
  scenes.atlantic = { id: "atlantic", name: "Atlantic", surface: "globe" };
  scenes.pinned = { id: "pinned", name: "Pinned", youtube: { accountId: "UC-cw" } };
  db.createRun.mockClear();
  (sendToFore as jest.Mock).mockClear();
});

describe("a crossword channel", () => {
  it("goes out on the channel record's YouTube channel when the run names none", async () => {
    const res = await goLive("daily");
    expect(res.status).toBe(201);
    expect(createdAccount()).toBe("UC-cw");
  });

  it("goes out on the run's pick when one is given (changed for one run)", async () => {
    const res = await goLive("daily", { accountId: "UC-weather" });
    expect(res.status).toBe(201);
    expect(createdAccount()).toBe("UC-weather");
  });

  it("is refused with none stored or picked — no fallback to the most recent account", async () => {
    const res = await goLive("bare");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Crossword channel "Bare Crossword" has no YouTube channel/);
    expect(db.createRun).not.toHaveBeenCalled();
    expect(sendToFore).not.toHaveBeenCalled();
  });

  it("is refused on an account that needs reconnecting", async () => {
    const res = await goLive("daily", { accountId: "UC-stale" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/needs reconnecting/);
    expect(db.createRun).not.toHaveBeenCalled();
  });

  it("is refused on an account that is not connected", async () => {
    const res = await goLive("daily", { accountId: "UC-gone" });
    expect(res.status).toBe(400);
    expect(db.createRun).not.toHaveBeenCalled();
  });

  it("needs no account when it does not publish to YouTube", async () => {
    const res = await post({ sceneId: "bare", platforms: { youtube: false } });
    expect(res.status).toBe(201);
  });
});

describe("a weather channel", () => {
  it("keeps today's fallback to the most recently connected account", async () => {
    const res = await goLive("atlantic");
    expect(res.status).toBe(201);
    expect(createdAccount()).toBe("UC-weather");
  });

  it("uses its stored account when it has one", async () => {
    const res = await goLive("pinned");
    expect(res.status).toBe(201);
    expect(createdAccount()).toBe("UC-cw");
  });

  it("the main channel keeps the fallback too", async () => {
    const res = await goLive("default");
    expect(res.status).toBe(201);
    expect(createdAccount()).toBe("UC-weather");
  });
});
