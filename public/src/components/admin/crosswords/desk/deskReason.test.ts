import { poolCounts } from "@photonsurge/shared/crossword-bank";
import { deskReason, type DeskInfo } from "./deskReason";

const info = (kind: DeskInfo["reason"]["kind"], pool = poolCounts(140, 28)): DeskInfo => ({ reason: { kind, unplayed: 0 }, pool });

describe("deskReason words the route's reason", () => {
  it("nothing to say with fresh stock", () => {
    expect(deskReason("playing", info("fresh"))).toBeNull();
    expect(deskReason("idle", info("fresh"))).toBeNull();
    expect(deskReason("playing", null)).toBeNull();
  });
  it("replaying, only while a puzzle is on", () => {
    expect(deskReason("playing", info("replay"))).toMatch(/^Replaying\. This puzzle has aired on this channel before/);
    expect(deskReason("idle", info("replay"))).toBeNull();
  });
  it("idle with no ready puzzles, or none family friendly", () => {
    expect(deskReason("idle", info("noReady"))).toMatch(/no ready puzzles: approve more words/);
    expect(deskReason("idle", info("noFamilyFriendly"))).toMatch(/family-friendly puzzles only/);
  });
  it("says how big the approved pool is, when known", () => {
    expect(deskReason("idle", info("noReady"))).toMatch(/140 words \(28 family friendly\), about 10 puzzles without a repeat/);
    expect(deskReason("idle", info("noReady", null as never))).not.toMatch(/pool/);
  });
  it("ending early when the puzzle on air was withdrawn", () => {
    expect(deskReason("playing", info("withdrawn"))).toMatch(/^Ending early\. This puzzle was withdrawn/);
    expect(deskReason("idle", info("withdrawn"))).toBeNull();
  });
});
