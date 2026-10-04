/**
 * Plan §8.2 / §10 — the settings page's client: the config is read and written
 * at /api/crossword/:scene/config (a failed write is reported, not swallowed),
 * and the YouTube pick lists the connected accounts from /api/youtube with the
 * ones needing reconnection marked.
 */
import { DEFAULT_CROSSWORD_CONFIG } from "@photonsurge/shared/crossword";
import { fetchCrosswordConfig, fetchYoutubeChannels, patchCrosswordConfig } from "./client";

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});
const respond = (status: number, body: unknown) =>
  (global.fetch = jest.fn(async () => ({ ok: status < 400, status, json: async () => body })) as unknown as typeof fetch);

it("reads the config from /api/crossword/:scene/config, with Family friendly only on by default", async () => {
  respond(200, { clueS: 90 });
  const cfg = await fetchCrosswordConfig("puzzle-hour");
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe("/api/crossword/puzzle-hour/config");
  expect(cfg.clueS).toBe(90);
  expect(cfg.familyFriendlyOnly).toBe(true);
  expect(cfg.theme).toEqual(DEFAULT_CROSSWORD_CONFIG.theme);
});

it("PATCHes the staged delta and throws when the write is refused", async () => {
  respond(200, { ...DEFAULT_CROSSWORD_CONFIG, clueS: 75 });
  await patchCrosswordConfig("puzzle-hour", { clueS: 75 });
  const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
  expect(url).toBe("/api/crossword/puzzle-hour/config");
  expect(init.method).toBe("PATCH");
  expect(JSON.parse(init.body)).toEqual({ clueS: 75 });

  respond(401, { error: "Unauthorized" });
  await expect(patchCrosswordConfig("puzzle-hour", { clueS: 75 })).rejects.toThrow(/Unauthorized/);
});

it("lists the connected YouTube channels, marking one Google rejected as needing reconnection", async () => {
  respond(200, {
    accounts: [
      { channelId: "UCpuzzle", channelTitle: "Puzzle Hour Live", authError: null },
      { channelId: "UCstale", channelTitle: "Stale", authError: { message: "invalid_grant" } },
    ],
  });
  expect(await fetchYoutubeChannels()).toEqual([
    { id: "UCpuzzle", title: "Puzzle Hour Live", needsReconnect: false },
    { id: "UCstale", title: "Stale", needsReconnect: true },
  ]);
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe("/api/youtube");
});
