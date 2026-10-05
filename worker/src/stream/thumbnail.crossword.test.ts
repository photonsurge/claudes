/**
 * A crossword channel with no thumbnail of its own sends no custom thumbnail:
 * the deployment default is the weather plate (crossword plan §10).
 */
jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("@photonsurge/shared/bull/bull", () => ({ getQueue: jest.fn(() => ({ add: jest.fn() })) }));
const runs = new Map<string, any>();
const db = {
  getRun: jest.fn(async (id: string) => (runs.has(id) ? { ...runs.get(id) } : null)),
  updateRun: jest.fn(async () => null),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));
const setThumbnail = jest.fn(async () => {});
jest.mock("../youtube/client", () => ({
  getYoutubeClient: jest.fn(async () => ({ accountId: "chan-1" })),
  setThumbnail: (...a: unknown[]) => setThumbnail(...a),
}));
jest.mock("./encoders", () => ({ watchBaseUrl: () => "https://gods.example" }));
let channel: Record<string, unknown> = {};
jest.mock("./channel-youtube", () => ({ channelYoutubeSettings: jest.fn(async () => channel) }));
const fetchWithTimeout = jest.fn();
jest.mock("../http", () => ({ fetchWithTimeout: (...a: unknown[]) => fetchWithTimeout(...a), discardBody: jest.fn() }));

import { publishThumbnail } from "./thumbnail";

beforeEach(() => {
  runs.clear();
  jest.clearAllMocks();
  runs.set("r1", { id: "r1", sceneId: "daily", status: "live", platforms: { youtube: { broadcastId: "b1" } } });
});

it("skips a crossword channel with no thumbnail: nothing fetched, nothing set", async () => {
  channel = { title: "", description: "", thumbnailUrl: "", surface: "crossword" };
  const res = await publishThumbnail("r1");
  expect(res).toMatchObject({ ok: false, skipped: expect.stringMatching(/crossword/) });
  expect(fetchWithTimeout).not.toHaveBeenCalled();
  expect(setThumbnail).not.toHaveBeenCalled();
});

it("a crossword channel with its own thumbnail still fetches it", async () => {
  channel = { title: "", description: "", thumbnailUrl: "https://img.example/cw.png", surface: "crossword" };
  fetchWithTimeout.mockRejectedValueOnce(new Error("offline"));
  await publishThumbnail("r1").catch(() => {});
  expect(fetchWithTimeout).toHaveBeenCalledWith(expect.stringContaining("https://img.example/cw.png"), expect.anything());
});
