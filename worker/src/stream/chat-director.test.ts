jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));

import type { AppDb } from "@photonsurge/shared/db/index";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import { DEFAULT_CHAT_COMMAND_SETTINGS, parseChatCommand, type ChatCommandSettings } from "@photonsurge/shared/chat-policy";
import type { DirectorCommand } from "@photonsurge/shared/director-commands";
import { KIND_WORDS, VIEWER_COMMAND_TTL_MS, makeDirectorHook } from "./chat-director";
import type { ChatInput } from "./chat-handler";

const T = 70_000_000;

type Policy = ChatCommandSettings;
const policyWith = (dir: Partial<Policy["director"]> = {}, over: Partial<Policy> = {}): Policy => ({
  ...DEFAULT_CHAT_COMMAND_SETTINGS,
  enabled: true,
  ...over,
  director: { ...DEFAULT_CHAT_COMMAND_SETTINGS.director, enabled: true, ...dir },
});

function setup(opts: { mode?: "auto" | "off" | "script"; pending?: DirectorCommand[] } = {}) {
  const rows: DirectorCommand[] = [...(opts.pending ?? [])];
  const enqueue = jest.fn(async (input: any) => {
    const row = { id: `n${rows.length}`, status: "queued", createdAt: input.now, expiresAt: input.now + input.ttlMs, ...input } as DirectorCommand;
    rows.push(row);
    return row;
  });
  const settle = jest.fn(async (id: string, status: DirectorCommand["status"]) => {
    const row = rows.find((c) => c.id === id && c.status === "queued");
    if (!row) return false;
    row.status = status;
    return true;
  });
  const db = {
    getOrInitDirectorConfig: jest.fn(async () => ({ ...DEFAULT_DIRECTOR_CONFIG, mode: opts.mode ?? "auto" })),
    directorCommands: { enqueue, settle, pending: jest.fn(async () => rows.filter((c) => c.status === "queued")) },
  } as unknown as AppDb;
  const hook = makeDirectorHook(db);
  const ask = (text: string, policy: Policy = policyWith(), msg: Partial<ChatInput> = {}) =>
    hook({ sceneId: "s1", policy, msg: { author: "ann", text, platform: "youtube", ...msg }, parsed: parseChatCommand(text)!, now: T });
  return { db, rows, enqueue, settle, ask };
}

const queued = (over: Partial<DirectorCommand>): DirectorCommand => ({
  id: `p${Math.random()}`,
  sceneId: "s1",
  source: { kind: "viewer", platform: "youtube", author: "bob" },
  cmd: { op: "queue", target: { type: "kind", kind: "quake" } },
  status: "queued",
  createdAt: T - 1000,
  expiresAt: T + 60_000,
  ...over,
});

describe("chat → director: places", () => {
  it("queues a country for the next shot change with the channel's pacing", async () => {
    const { ask, enqueue } = setup();
    expect(await ask(":show japan")).toBe("@ann → Japan at the next shot change");
    const input = enqueue.mock.calls[0][0];
    expect(input).toMatchObject({
      sceneId: "s1",
      source: { kind: "viewer", platform: "youtube", author: "ann" },
      cmd: { op: "queue", target: { type: "place", query: "Japan" }, holdS: DEFAULT_CHAT_COMMAND_SETTINGS.director.holdS },
      ttlMs: VIEWER_COMMAND_TTL_MS,
      viewer: { everyS: 120, immediate: false, allowCities: false },
    });
  });

  it("takes :go as a synonym and an alias for the place", async () => {
    const { ask, enqueue } = setup();
    await ask(":go britain");
    expect(enqueue.mock.calls[0][0].cmd.target).toEqual({ type: "place", query: "United Kingdom" });
  });

  it("cuts on an immediate channel", async () => {
    const { ask, enqueue } = setup();
    expect(await ask(":show japan", policyWith({ mode: "immediate" }))).toBe("@ann → Japan coming up");
    expect(enqueue.mock.calls[0][0]).toMatchObject({ cmd: { op: "cut" }, viewer: { immediate: true } });
  });

  it("clamps the viewer's minutes to the channel's max hold", async () => {
    const { ask, enqueue } = setup();
    await ask(":show japan 3", policyWith({ holdS: 60, maxHoldS: 600 }));
    expect(enqueue.mock.calls[0][0].cmd.holdS).toBe(180);
    await ask(":show japan 60", policyWith({ holdS: 60, maxHoldS: 600 }));
    expect(enqueue.mock.calls[1][0].cmd.holdS).toBe(600);
  });

  it("respects the channel's place rules", async () => {
    const { ask, enqueue } = setup();
    expect(await ask(":show japan", policyWith({ places: { countries: false, regions: true, cities: false } }))).toMatch(/isn't something viewers can ask for/);
    expect(await ask(":show iberia", policyWith({ places: { countries: true, regions: false, cities: false } }))).toMatch(/isn't something viewers can ask for/);
    expect(await ask(":show atlantis")).toBe('@ann I don\'t know "atlantis"');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("passes an unknown name through as a city when the channel allows cities", async () => {
    const { ask, enqueue } = setup();
    await ask(":show san antonio", policyWith({ places: { countries: true, regions: true, cities: true } }));
    expect(enqueue.mock.calls[0][0]).toMatchObject({ cmd: { target: { type: "place", query: "san antonio" } }, viewer: { allowCities: true } });
  });

  it("asks for a place when given none", async () => {
    const { ask } = setup();
    expect(await ask(":show")).toBe("@ann try :show <place>");
  });
});

describe("chat → director: kinds", () => {
  it("reads :quake and :show quakes the same way", async () => {
    const { ask, enqueue } = setup();
    expect(await ask(":quake")).toBe("@ann → an earthquake at the next shot change");
    await ask(":show earthquakes");
    expect(enqueue.mock.calls.map((c) => c[0].cmd.target)).toEqual([
      { type: "kind", kind: "quake" },
      { type: "kind", kind: "quake" },
    ]);
  });

  it("maps every kind word to a kind the director knows", () => {
    expect(new Set(Object.values(KIND_WORDS))).toEqual(new Set(["quake", "storm", "volcano", "flight", "ship", "ocean", "orbital", "global"]));
  });

  it("refuses a kind the channel hasn't opened to viewers", async () => {
    const { ask, enqueue } = setup();
    expect(await ask(":flight")).toBe("@ann a flight isn't something viewers can ask for here");
    expect(await ask(":space", policyWith({ kinds: { orbital: true } }))).toBe("@ann → space at the next shot change");
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("refuses every camera request when cuts are off for viewers", async () => {
    const { ask, enqueue } = setup();
    const noCuts = policyWith({ ops: { ...DEFAULT_CHAT_COMMAND_SETTINGS.director.ops, cut: false } });
    expect(await ask(":quake", noCuts)).toMatch(/isn't something/);
    expect(await ask(":show japan", noCuts)).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("chat → director: round-ups and looks", () => {
  it("queues the world round-up, or a place's", async () => {
    const { ask, enqueue } = setup();
    expect(await ask(":roundup")).toBe("@ann → the world round-up at the next shot change");
    expect(await ask(":roundup uk")).toBe("@ann → the United Kingdom round-up is queued (#2)");
    expect(enqueue.mock.calls.map((c) => c[0].cmd.target)).toEqual([{ type: "roundup" }, { type: "roundup", place: "United Kingdom" }]);
  });

  it("is silent on :roundup when the channel doesn't allow it", async () => {
    const { ask } = setup();
    expect(await ask(":roundup", policyWith({ ops: { ...DEFAULT_CHAT_COMMAND_SETTINGS.director.ops, roundup: false } }))).toBeNull();
  });

  it("queues a map look for the next shot change, even on an immediate channel", async () => {
    const { ask, enqueue } = setup();
    const reply = await ask(":mode aurora 2", policyWith({ mode: "immediate" }));
    expect(reply).toMatch(/^@ann → .*aurora.* at the next shot change$/i);
    expect(enqueue.mock.calls[0][0]).toMatchObject({
      cmd: { op: "queue", target: { type: "mapType", id: "aurora" }, holdS: 120 },
      viewer: { immediate: false },
    });
  });

  it("refuses a look that isn't one, or isn't on the channel's list", async () => {
    const { ask, enqueue } = setup();
    expect(await ask(":mode lava")).toBe('@ann "lava" isn\'t a map look — try :modes');
    const onlyTemp = policyWith({}, { mapType: { ...DEFAULT_CHAT_COMMAND_SETTINGS.mapType, allowed: ["temp"] } });
    expect(await ask(":mode aurora", onlyTemp)).toMatch(/isn't something viewers can ask for/);
    expect(await ask(":mode temp", onlyTemp)).toMatch(/→/);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("is silent on :mode <look> when map looks are off", async () => {
    const { ask } = setup();
    expect(await ask(":mode aurora", policyWith({}, { mapType: { ...DEFAULT_CHAT_COMMAND_SETTINGS.mapType, enabled: false } }))).toBeNull();
  });
});

describe("chat → director: gates", () => {
  it("is silent when viewers can't steer the director, or the word means nothing", async () => {
    const { ask, db } = setup();
    expect(await ask(":show japan", policyWith({ enabled: false }))).toBeNull();
    expect(await ask(":quake", policyWith({ enabled: false }))).toBeNull();
    expect(await ask(":dance")).toBeNull();
    expect(db.getOrInitDirectorConfig).not.toHaveBeenCalled();
  });

  it("says so when the director is off", async () => {
    const { ask, enqueue } = setup({ mode: "off" });
    expect(await ask(":show japan")).toBe("@ann the director is off right now");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("asks viewers to wait while a scripted video plays", async () => {
    const { ask, enqueue } = setup({ mode: "script" });
    expect(await ask(":quake")).toBe("@ann a scripted video is playing — try again after it");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses when the viewers' queue is full — the operator's commands don't count", async () => {
    const pending = [
      queued({}),
      queued({}),
      queued({ source: { kind: "operator", user: "op" } }),
      queued({ cmd: { op: "skip" } }),
    ];
    const { ask, enqueue } = setup({ pending });
    expect(await ask(":show japan", policyWith({ maxQueued: 2 }))).toBe("@ann the queue is full, try again in a minute");
    expect(enqueue).not.toHaveBeenCalled();
    expect(await ask(":show japan", policyWith({ maxQueued: 3 }))).toBe("@ann → Japan is queued (#3)");
  });
});

describe("chat → director: mod controls", () => {
  const modOps = policyWith({ ops: { cut: true, roundup: true, skip: true, clear: true } });

  it("lets a mod skip the shot when the channel allows it", async () => {
    const { ask, enqueue } = setup();
    expect(await ask(":next", modOps)).toBeNull();
    expect(await ask(":next", policyWith(), { isMod: true })).toBeNull();
    expect(await ask(":next", modOps, { isMod: true })).toBe("@ann skipped to the next shot");
    expect(enqueue.mock.calls[0][0]).toMatchObject({ cmd: { op: "skip" }, source: { kind: "viewer", isMod: true } });
  });

  it("lets the channel owner use mod controls", async () => {
    const { ask } = setup();
    expect(await ask(":next", modOps, { isOwner: true })).toBe("@ann skipped to the next shot");
  });

  it("clears viewers' requests only, never the operator's", async () => {
    const op = queued({ source: { kind: "operator", user: "op" } });
    const { ask, rows } = setup({ pending: [queued({}), queued({}), op] });
    expect(await ask(":clear", modOps)).toBeNull();
    expect(await ask(":clear", modOps, { isMod: true })).toBe("@ann cleared 2 requests");
    expect(rows.map((c) => c.status)).toEqual(["dropped", "dropped", "queued"]);
    expect(await ask(":clear", modOps, { isMod: true })).toBe("@ann nothing to clear");
  });
});
