jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));

import { DEFAULT_DIRECTOR_CONFIG, mergeDirectorConfig, type Segment, type SegmentKind } from "@photonsurge/shared/director";
import type { PendingBreakIn } from "@photonsurge/shared/director-break-in";
import type { AppDb } from "@photonsurge/shared/db/index";
import { breakInView, buildBreakInSegment, frameGroup, groupTitle, stampIncoming } from "./breakin";
import { newRunner } from "./runner";

const NOW = Date.UTC(2026, 9, 4, 12);
const cfg = mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, {});
const seg = (id: string, center: [number, number], over: Partial<Segment> = {}): Segment => ({
  id,
  kind: id.split(":")[0] as SegmentKind,
  title: `T ${id}`,
  subtitle: `S ${id}`,
  camera: { center, zoom: 4.5 },
  patch: { camera: { center, zoom: 4.5 } },
  holdMs: 16_000,
  ...over,
});
const item = (id: string, over: Partial<PendingBreakIn> = {}): PendingBreakIn => ({
  reason: "storm",
  at: NOW,
  severityRank: 3,
  segmentId: id,
  key: id,
  score: 86,
  title: id,
  queuedAt: NOW,
  ...over,
});

describe("groupTitle", () => {
  it("names the burst in plain words", () => {
    expect(groupTitle("quake", [item("a"), item("b")])).toBe("2 NEW EARTHQUAKES");
    expect(groupTitle("storm", [item("a", { severityRank: 4 }), item("b", { severityRank: 3 })])).toBe("2 NEW SEVERE WARNINGS");
    expect(groupTitle("storm", [item("a", { severityRank: 4 }), item("b", { severityRank: 4 })])).toBe("2 NEW EXTREME WARNINGS");
    expect(groupTitle("storm", [item("a", { severityRank: 2 }), item("b")])).toBe("2 NEW WARNINGS");
    expect(groupTitle("volcano", [item("a"), item("b"), item("c")])).toBe("3 VOLCANOES ERUPTING");
  });
});

describe("frameGroup", () => {
  it("frames a tight cluster on its centroid, zoomed out to fit", () => {
    const cam = frameGroup([seg("storm:a", [10, 50]), seg("storm:b", [26, 50]), seg("storm:c", [18, 50])]);
    expect(cam.center).toEqual([18, 50]);
    expect(cam.zoom).toBe(3.5);
  });

  it("falls back to the top shot's frame when the members are scattered", () => {
    const top = seg("storm:a", [10, 50]);
    expect(frameGroup([top, seg("storm:b", [150, -30])])).toBe(top.camera);
  });

  it("never zooms in past the top shot or out past 2", () => {
    expect(frameGroup([seg("storm:a", [0, 0]), seg("storm:b", [1, 0])]).zoom).toBe(4.5);
    expect(frameGroup([seg("storm:a", [0, 0]), seg("storm:b", [89, 0])]).zoom).toBe(2);
  });
});

describe("buildBreakInSegment", () => {
  const resolver = (built: Record<string, Segment>) =>
    jest.fn(async (_db: unknown, _cfg: unknown, _r: unknown, t: { id: string }) =>
      built[t.id] ? { segment: built[t.id] } : { refused: "gone" },
    ) as any;
  const db = {} as AppDb;

  it("airs a single pick as its own shot, marked as a break-in", async () => {
    const s = seg("quake:q", [140, 38]);
    const out = await buildBreakInSegment(db, cfg, newRunner("s"), { type: "single", reason: "quake", items: [item("quake:q", { reason: "quake" })] }, NOW, {
      interrupted: true,
      resolve: resolver({ "quake:q": s }),
    });
    expect(out).toEqual({ ...s, breakIn: { reason: "quake", interrupted: true } });
  });

  it("airs a burst as one framed cut naming every member", async () => {
    const built = { "storm:a": seg("storm:a", [10, 50]), "storm:b": seg("storm:b", [14, 50]), "storm:c": seg("storm:c", [12, 50]) };
    const items = [item("storm:a", { at: NOW - 30_000 }), item("storm:b", { at: NOW - 60_000 }), item("storm:c")];
    const out = await buildBreakInSegment(db, cfg, newRunner("s"), { type: "group", reason: "storm", items }, NOW, {
      interrupted: false,
      resolve: resolver(built),
    });
    expect(out?.id).toBe("storm:breakin-b");
    expect(out?.title).toBe("3 NEW SEVERE WARNINGS");
    expect(out?.subtitle).toBe("T storm:a and 2 more");
    expect(out?.camera.center).toEqual([12, 50]);
    expect(out?.patch.camera).toEqual(out?.camera);
    expect(out?.breakIn).toEqual({
      reason: "storm",
      interrupted: false,
      items: ["storm:a", "storm:b", "storm:c"].map((id) => ({ segmentId: id, title: `T ${id}`, subtitle: `S ${id}` })),
    });
  });

  it("falls back to the one member it could build, and to null for none", async () => {
    const only = seg("storm:a", [10, 50]);
    const pick = { type: "group" as const, reason: "storm" as const, items: [item("storm:a"), item("storm:gone")] };
    const out = await buildBreakInSegment(db, cfg, newRunner("s"), pick, NOW, { interrupted: true, resolve: resolver({ "storm:a": only }) });
    expect(out?.id).toBe("storm:a");
    expect(out?.breakIn?.items).toBeUndefined();
    expect(await buildBreakInSegment(db, cfg, newRunner("s"), pick, NOW, { interrupted: true, resolve: resolver({}) })).toBeNull();
  });
});

describe("stampIncoming", () => {
  const withMode = (incoming: string, incomingSeconds = 0) =>
    mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, { transitionSeconds: 4, breakIn: { incoming, incomingSeconds } as any });

  it("stamps only break-in cuts by default, at the flight time", () => {
    const plain = stampIncoming(seg("quake:a", [0, 0]), withMode("breakIns"));
    expect(plain.incomingMs).toBeUndefined();
    const broke = stampIncoming(seg("quake:a", [0, 0], { breakIn: { reason: "quake", interrupted: true } }), withMode("breakIns"));
    expect(broke.incomingMs).toBe(4000);
  });

  it("stamps every targeted event shot in allEvents mode, never a world spin", () => {
    expect(stampIncoming(seg("flight:a", [0, 0]), withMode("allEvents", 3)).incomingMs).toBe(3000);
    expect(stampIncoming(seg("global:world", [0, 0]), withMode("allEvents")).incomingMs).toBeUndefined();
  });

  it("clears a stale stamp when off", () => {
    const s = seg("quake:a", [0, 0], { incomingMs: 4000, breakIn: { reason: "quake", interrupted: true } });
    expect(stampIncoming(s, withMode("off")).incomingMs).toBeUndefined();
  });
});

describe("breakInView", () => {
  it("reflects the runner", () => {
    const r = { ...newRunner("s"), current: seg("storm:a", [0, 0]), startedAt: NOW - 5, lastBreakInAt: 7 };
    r.seen.set("quake:x", { count: 1, last: 1 });
    r.handled.add("k");
    const v = breakInView(r, mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, { countries: ["uk"] }), NOW);
    expect(v.current).toMatchObject({ id: "storm:a", kind: "storm", startedAt: NOW - 5 });
    expect([...v.seen]).toEqual(["quake:x"]);
    expect(v.handled.has("k")).toBe(true);
    expect(v.favourites.countries.has("uk")).toBe(true);
    expect(v.lastBreakInAt).toBe(7);
    expect(v.paused).toBe(false);
  });
});
