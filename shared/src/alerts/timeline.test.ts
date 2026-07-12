import { buildTimeline, latestBeats, type AlertTimelineBeat } from "./timeline";
import type { iAlertRevision } from "../db/alert-revision-model";
import type { AlertChange } from "./diff";
import type { AlertMsgType, SeverityRank, iAlertModel } from "../db/alert-model";

type TimelineAlert = Pick<
  iAlertModel,
  "source" | "identifier" | "sent" | "active" | "expiresAt" | "maxSeverityRank" | "msgType"
>;
type ChainMsg = Pick<iAlertModel, "id" | "sent" | "msgType" | "maxSeverityRank">;

const NOW = new Date("2026-07-12T20:00:00Z");

const alert = (o: Partial<TimelineAlert> = {}): TimelineAlert => ({
  source: "wmo",
  identifier: "c1",
  sent: "2026-07-12T14:00:00Z",
  active: true,
  expiresAt: "2026-07-12T22:00:00Z",
  maxSeverityRank: 2,
  msgType: "Alert",
  ...o,
});

let seq = 0;
const rev = (at: string, changes: AlertChange[], sev: SeverityRank, areaKm2 = 0): iAlertRevision => ({
  source: "wmo",
  identifier: "c1",
  alertId: "a1",
  seq: ++seq,
  at,
  msgType: "Update" as AlertMsgType,
  status: "Actual",
  changes,
  severityRank: sev,
  areaKm2,
});

const types = (beats: AlertTimelineBeat[]) => beats.map((b) => b.type);

describe("buildTimeline (in-place / WMO-GDACS revisions)", () => {
  it("opens with ISSUED then one beat per change, in time order", () => {
    const revisions = [
      rev("2026-07-12T14:17:00Z", [{ type: "SEVERITY_CHANGED", from: "2", to: "3" }], 3),
      rev("2026-07-12T14:42:00Z", [{ type: "AREA_CHANGED", from: "12400", to: "18900" }], 3, 18900),
    ];
    const beats = buildTimeline(alert(), [], revisions, NOW);
    expect(types(beats)).toEqual(["ISSUED", "SEVERITY_CHANGED", "AREA_CHANGED"]);
    // ISSUED reflects the pre-change severity (the `from` of the first severity change).
    expect(beats[0].severityRank).toBe(2);
    // Area beat carries the +52% growth in its label.
    expect(beats[2].label).toContain("+52%");
  });

  it("synthesises ENDED when the alert lapsed (inactive, expired, not cancelled)", () => {
    const beats = buildTimeline(
      alert({ active: false, expiresAt: "2026-07-12T17:51:00Z" }),
      [],
      [],
      NOW,
    );
    expect(types(beats)).toEqual(["ISSUED", "ENDED"]);
    expect(beats[1].at).toBe("2026-07-12T17:51:00Z");
  });

  it("does NOT synthesise ENDED when the issuer cancelled", () => {
    const revisions = [rev("2026-07-12T17:51:00Z", [{ type: "CANCELLED" }], 2)];
    const beats = buildTimeline(
      alert({ active: false, expiresAt: "2026-07-12T17:51:00Z" }),
      [],
      revisions,
      NOW,
    );
    expect(types(beats)).toEqual(["ISSUED", "CANCELLED"]);
    expect(types(beats)).not.toContain("ENDED");
  });

  it("does NOT synthesise ENDED while the alert is still active", () => {
    expect(types(buildTimeline(alert({ active: true }), [], [], NOW))).toEqual(["ISSUED"]);
  });
});

describe("buildTimeline (CAP references chain / NWS-MeteoAlarm)", () => {
  it("maps the chain to ISSUED / UPDATED / CANCELLED beats", () => {
    const chain: ChainMsg[] = [
      { id: "m1", sent: "2026-07-12T14:00:00Z", msgType: "Alert", maxSeverityRank: 2 },
      { id: "m2", sent: "2026-07-12T15:00:00Z", msgType: "Update", maxSeverityRank: 3 },
      { id: "m3", sent: "2026-07-12T16:00:00Z", msgType: "Cancel", maxSeverityRank: 3 },
    ];
    const focal = alert({ source: "nws", active: false, msgType: "Cancel", expiresAt: "2026-07-12T16:00:00Z" });
    const beats = buildTimeline(focal, chain, [], NOW);
    expect(types(beats)).toEqual(["ISSUED", "UPDATED", "CANCELLED"]);
    expect(beats[1].refAlertId).toBe("m2");
    expect(types(beats)).not.toContain("ENDED"); // cancelled, so no natural-lapse tail
  });
});

describe("latestBeats", () => {
  it("returns the last n beats (newest last)", () => {
    const beats = buildTimeline(
      alert(),
      [],
      [
        rev("2026-07-12T14:17:00Z", [{ type: "SEVERITY_CHANGED", from: "2", to: "3" }], 3),
        rev("2026-07-12T14:42:00Z", [{ type: "INSTRUCTION_CHANGED" }], 3),
        rev("2026-07-12T15:03:00Z", [{ type: "EXPIRY_CHANGED", from: "2026-07-12T17:00:00Z", to: "2026-07-12T19:00:00Z" }], 3),
      ],
      NOW,
    );
    const last2 = latestBeats(beats, 2);
    expect(last2).toHaveLength(2);
    expect(last2[last2.length - 1].type).toBe("EXPIRY_CHANGED");
    expect(last2[last2.length - 1].label).toBe("Warning extended");
  });
});
