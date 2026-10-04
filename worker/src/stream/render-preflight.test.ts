// The offline test's preflight report (short-video plan §7.1): clips resolved
// and skipped, length against the budget, the encoder probed, the YouTube
// account's RECORDED state — and no side effects (nothing saved, no YouTube).

jest.mock("@photonsurge/shared/utill/logger", () => ({ log: jest.fn() }));
jest.mock("../obs/client", () => ({ probe: jest.fn() }));
jest.mock("./encoders", () => ({ endpointForEncoderId: jest.fn() }));
jest.mock("./render-queue", () => ({ quotaAllowsRender: jest.fn(async () => ({ ok: true })) }));
jest.mock("../youtube/client", () => {
  throw new Error("preflight must not load the YouTube client");
});

const FORMAT = { id: "uk", name: "UK round-up", template: { budgetMs: 20_000 }, render: { accountId: "acc-default" } };
jest.mock("../director/script-generate", () => ({
  generateFormat: jest.fn(async (_db: unknown, id: string) => {
    if (id !== "uk") throw new Error(`short-video: no format "${id}"`);
    return FORMAT;
  }),
  generateShortScript: jest.fn(),
  sceneDirectorConfig: jest.fn(async () => ({ mode: "off" })),
}));
jest.mock("../director/script-resolve", () => ({
  resolveClip: jest.fn(async (_db: unknown, _cfg: unknown, clip: { target: string; durationMs: number }) =>
    clip.target.includes("dead") ? { skipped: "alert is no longer active" } : { segment: { id: clip.target } },
  ),
}));

const scripts = new Map<string, any>();
const accounts = new Map<string, any>();
const db: any = {
  shortScripts: { get: jest.fn(async (id: string) => scripts.get(id) ?? null), upsert: jest.fn() },
  listStreamEncoders: jest.fn(async () => [
    { id: "v1", name: "Videos 1", enabled: true, use: "videos" },
    { id: "v2", name: "Videos 2", enabled: true, use: "videos" },
    { id: "c1", name: "Main", enabled: true, use: "channels" },
  ]),
  getStreamEncoder: jest.fn(async (id: string) => ({ id, name: `Encoder ${id}` })),
  getYoutubeAccount: jest.fn(async (id?: string) => accounts.get(id ?? "acc-default") ?? null),
  saveDirectorConfig: jest.fn(),
  updateRun: jest.fn(),
  createRun: jest.fn(),
};
jest.mock("@photonsurge/shared/db/index", () => ({ getAppDb: jest.fn(async () => db) }));

import { preflightRender, type PreflightDeps } from "./render-preflight";
import { generateShortScript, sceneDirectorConfig } from "../director/script-generate";
import { quotaAllowsRender } from "./render-queue";
import type { ShortRenderRequest } from "@photonsurge/shared/short-render";

const clip = (id: string, durationMs: number, target = `country:${id}`) => ({ id, target, durationMs, label: { title: `Clip ${id}` } });
const up: PreflightDeps = { probeEncoder: jest.fn(async () => ({ obsVersion: "30.2", websocketVersion: "5", streaming: false, outputBytes: 0 })) };
const req = (over: Partial<ShortRenderRequest> = {}): ShortRenderRequest => ({
  encoderId: "v1",
  what: { type: "script", scriptId: "s1" },
  publishAs: "unlisted",
  offline: true,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  scripts.clear();
  accounts.clear();
  scripts.set("s1", { id: "s1", formatId: "uk", title: "UK today", clips: [clip("a", 8_000), clip("dead", 5_000, "storm:dead"), clip("b", 7_000)] });
  accounts.set("acc-default", { id: "acc-default", channelTitle: "Main channel", refreshTokenEnc: "x", authError: null });
});

it("an offline test of a saved script: clips resolved and skipped with reasons, length vs budget, encoder probed, YouTube not used", async () => {
  const r = await preflightRender(req(), up, 1_000);
  expect(r.ok).toBe(true);
  expect(r.format).toEqual({ id: "uk", name: "UK round-up" });
  expect(r.script).toMatchObject({
    level: "warn",
    title: "UK today",
    clips: [
      { id: "a", title: "Clip a", durationMs: 8_000 },
      { id: "b", title: "Clip b", durationMs: 7_000 },
    ],
    skipped: [{ id: "dead", title: "Clip dead", reason: "alert is no longer active" }],
  });
  expect(r.length).toMatchObject({ level: "ok", playMs: 15_000, budgetMs: 20_000 });
  expect(r.encoder).toMatchObject({ level: "ok", checked: [{ id: "v1", name: "Encoder v1", reachable: true, detail: "OBS 30.2" }] });
  expect(r.youtube).toMatchObject({ level: "ok", used: false });
  // Read-only: the scene's config is read without its first-read insert, nothing saved, no account read.
  expect(sceneDirectorConfig).toHaveBeenCalledWith(db, "uk", true);
  expect(db.getYoutubeAccount).not.toHaveBeenCalled();
  expect(quotaAllowsRender).not.toHaveBeenCalled();
  for (const w of [db.shortScripts.upsert, db.saveDirectorConfig, db.updateRun, db.createRun]) expect(w).not.toHaveBeenCalled();
});

it("over budget is a warning; every clip skipped is a failure", async () => {
  scripts.get("s1").clips = [clip("a", 30_000)];
  let r = await preflightRender(req(), up);
  expect(r.length).toMatchObject({ level: "warn", note: expect.stringMatching(/over the format's/) });
  expect(r.ok).toBe(true);

  scripts.get("s1").clips = [clip("dead", 5_000, "storm:dead")];
  r = await preflightRender(req(), up);
  expect(r.script.level).toBe("fail");
  expect(r.ok).toBe(false);
});

it("an unreachable encoder fails; for 'any' every enabled video encoder is probed", async () => {
  const deps: PreflightDeps = {
    probeEncoder: jest.fn(async (id: string) => {
      if (id === "v2") throw new Error("cannot reach OBS at ws://v2");
      return { obsVersion: "30.2", websocketVersion: "5", streaming: id === "v1", outputBytes: 0 };
    }),
  };
  let r = await preflightRender(req({ encoderId: "v2" }), deps);
  expect(r.encoder).toMatchObject({ level: "fail", checked: [{ id: "v2", reachable: false, detail: "cannot reach OBS at ws://v2" }] });
  expect(r.ok).toBe(false);

  r = await preflightRender(req({ encoderId: "any" }), deps);
  expect(r.encoder.level).toBe("warn");
  expect(r.encoder.checked.map((c) => [c.id, c.reachable])).toEqual([
    ["v1", true],
    ["v2", false],
  ]);
  expect(r.encoder.checked[0].detail).toMatch(/streaming right now/);
});

it("a live render reads the account's recorded state: authError and a spent quota fail it, with no API call", async () => {
  let r = await preflightRender(req({ offline: false }), up);
  expect(r.youtube).toMatchObject({ level: "ok", used: true, accountId: "acc-default", accountTitle: "Main channel" });
  expect(quotaAllowsRender).toHaveBeenCalledWith("acc-default", expect.any(Number));

  accounts.get("acc-default").authError = { message: "invalid_grant", at: 1 };
  r = await preflightRender(req({ offline: false }), up);
  expect(r.youtube).toMatchObject({ level: "fail", note: expect.stringMatching(/invalid_grant/) });
  expect(r.ok).toBe(false);

  accounts.get("acc-default").authError = null;
  (quotaAllowsRender as jest.Mock).mockResolvedValueOnce({ ok: false, note: "quota low: the YouTube API quota is spent until 07:00 UTC" });
  r = await preflightRender(req({ offline: false }), up);
  expect(r.youtube).toMatchObject({ level: "fail", note: expect.stringMatching(/quota low/) });

  r = await preflightRender(req({ offline: false, accountId: "nope" }), up);
  expect(r.youtube).toMatchObject({ level: "fail", note: "YouTube channel nope is not connected." });
});

it("a generate request is generated as a dry run; an auto scope is only picked at the front", async () => {
  (generateShortScript as jest.Mock).mockResolvedValue({ id: "tmp", formatId: "uk", title: "UK draft", clips: [clip("x", 9_000)] });
  let r = await preflightRender(req({ what: { type: "generate", formatId: "uk", scope: { type: "country", id: "gb" } } }), up);
  expect(generateShortScript).toHaveBeenCalledWith(db, expect.objectContaining({ formatId: "uk" }), expect.objectContaining({ dryRun: true }));
  expect(r.script).toMatchObject({ level: "ok", generated: true, title: "UK draft", clips: [{ id: "x" }] });
  expect(r.length.playMs).toBe(9_000);

  r = await preflightRender(req({ what: { type: "generate", formatId: "uk", scope: { type: "auto", of: "country" } } }), up);
  expect(r.script).toMatchObject({ level: "ok", generated: true, clips: [] });
  expect(r.length).toMatchObject({ level: "ok", note: "Known once it is generated." });
  expect(r.ok).toBe(true);
});

it("a missing script or format fails without throwing", async () => {
  let r = await preflightRender(req({ what: { type: "script", scriptId: "gone" } }), up);
  expect(r.script).toMatchObject({ level: "fail", note: "script gone not found" });
  expect(r.ok).toBe(false);
  r = await preflightRender(req({ what: { type: "generate", formatId: "nope", scope: { type: "globe" } } }), up);
  expect(r.script.level).toBe("fail");
});
