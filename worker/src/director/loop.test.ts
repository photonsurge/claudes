jest.mock("../socket", () => ({ emitWorkerEvent: jest.fn() }));

import { DEFAULT_DIRECTOR_CONFIG, mergeDirectorConfig, type DirectorConfig, type Segment, type SegmentKind } from "@photonsurge/shared/director";
import type { Candidate } from "@photonsurge/shared/director-select";
import type { AppDb } from "@photonsurge/shared/db/index";
import { pickAtBoundary } from "./loop";
import { newRunner } from "./runner";

const seg = (id: string): Segment => ({
  id,
  kind: id.split(":")[0] as SegmentKind,
  title: id,
  camera: { center: [0, 0], zoom: 4 },
  patch: {},
  holdMs: 12_000,
});
const db = {} as AppDb;
const config = (patch: Record<string, unknown> = {}): DirectorConfig =>
  mergeDirectorConfig(DEFAULT_DIRECTOR_CONFIG, patch as Partial<DirectorConfig>);

const breakingQuake: Candidate = { segment: seg("quake:new"), score: 100, breakIn: { reason: "quake", at: 0 } };
const intro: Candidate = { segment: seg("intro:global"), score: 6 };
const country: Candidate = { segment: seg("country:uk"), score: 6 };

const builder = (pool: Candidate[]) => jest.fn(async () => pool);
const adBuilder = (ad: Segment | null) => jest.fn(async () => ad);

describe("pickAtBoundary", () => {
  it("opens the session on the intro, never a break-in", async () => {
    const r = newRunner("s1");
    const out = await pickAtBoundary(db, config(), r, builder([intro, country, breakingQuake]));
    expect(out.next?.id).toBe("intro:global");
    expect(out.breaking).toBe(false);
  });

  it("takes a breaking candidate after the opener", async () => {
    const r = { ...newRunner("s1"), seq: 3 };
    const out = await pickAtBoundary(db, config(), r, builder([country, breakingQuake]));
    expect(out).toMatchObject({ next: { id: "quake:new" }, breaking: true });
  });

  it("skips the tier when the channel turns break-ins off", async () => {
    const r = { ...newRunner("s1"), seq: 3 };
    const out = await pickAtBoundary(db, config({ breakIn: { enabled: false } }), r, builder([country, breakingQuake]));
    expect(out.breaking).toBe(false);
  });

  it("holds the tier back for one cut after a break-in", async () => {
    const r = { ...newRunner("s1"), seq: 3, lastCutWasPriority: true };
    const out = await pickAtBoundary(db, config(), r, builder([country, breakingQuake]));
    expect(out.breaking).toBe(false);
  });

  it("airs a due ad break when nothing is breaking", async () => {
    const r = { ...newRunner("s1"), seq: 6 };
    const ad = seg("ad:a1");
    const out = await pickAtBoundary(db, config({ kinds: { ad: true }, adEveryNShots: 6 }), r, builder([country]), adBuilder(ad));
    expect(out).toEqual({ next: ad, pool: [], breaking: false });
  });

  it("defers a due ad break for breaking news and remembers it is owed", async () => {
    const r = { ...newRunner("s1"), seq: 6 };
    const buildAd = adBuilder(seg("ad:a1"));
    const out = await pickAtBoundary(db, config({ kinds: { ad: true }, adEveryNShots: 6 }), r, builder([country, breakingQuake]), buildAd);
    expect(out.next?.id).toBe("quake:new");
    expect(r.pendingAd).toBe(true);
    expect(buildAd).not.toHaveBeenCalled();
  });

  it("falls through to rotation when an ad is due but none is active", async () => {
    const r = { ...newRunner("s1"), seq: 6 };
    const out = await pickAtBoundary(db, config({ kinds: { ad: true }, adEveryNShots: 6 }), r, builder([country]), adBuilder(null));
    expect(out.next?.id).toBe("country:uk");
  });
});
