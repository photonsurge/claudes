import { diffAlert, type DiffableAlert } from "./diff";
import type { AlertGeometry, AlertMsgType, SeverityRank } from "../db/alert-model";

const box = (w: number, s: number, span = 1): AlertGeometry => ({
  type: "Polygon",
  coordinates: [[[w, s], [w + span, s], [w + span, s + span], [w, s + span], [w, s]]],
});

interface Opt {
  msgType?: AlertMsgType;
  sev?: SeverityRank;
  expiresAt?: string;
  headline?: string;
  description?: string;
  instruction?: string;
  onset?: string;
  effective?: string;
  geometry?: AlertGeometry | null;
  translatedHeadline?: string;
}

function make(o: Opt = {}): DiffableAlert {
  return {
    msgType: o.msgType ?? "Alert",
    status: "Actual",
    maxSeverityRank: o.sev ?? 2,
    expiresAt: o.expiresAt,
    info: [
      {
        category: [],
        event: "Storm",
        severityRank: o.sev ?? 2,
        headline: o.headline ?? "Storm warning",
        description: o.description ?? "A storm is coming",
        instruction: o.instruction ?? "Take cover",
        onset: o.onset,
        effective: o.effective,
        translatedHeadline: o.translatedHeadline,
        area: [{ areaDesc: "", geometry: o.geometry ?? null, geocodes: [] }],
      },
    ],
  };
}

const types = (a: DiffableAlert, b: DiffableAlert) => diffAlert(a, b).events.map((e) => e.type);

describe("diffAlert", () => {
  it("returns no events for an identical re-poll", () => {
    expect(diffAlert(make(), make()).events).toEqual([]);
  });

  it("ignores a translation-only change (source text unchanged)", () => {
    const prev = make({ translatedHeadline: undefined });
    const next = make({ translatedHeadline: "Sturmwarnung übersetzt" });
    expect(diffAlert(prev, next).events).toEqual([]);
  });

  it("detects a severity change with from/to ranks", () => {
    const d = diffAlert(make({ sev: 2 }), make({ sev: 3 }));
    expect(d.events).toEqual([{ type: "SEVERITY_CHANGED", from: "2", to: "3" }]);
    expect(d.severity).toBe(3);
  });

  it("detects headline/description text changes", () => {
    expect(types(make({ headline: "A" }), make({ headline: "B" }))).toContain("TEXT_CHANGED");
    expect(types(make({ description: "x" }), make({ description: "y" }))).toContain("TEXT_CHANGED");
  });

  it("detects an instruction change", () => {
    expect(types(make({ instruction: "flee" }), make({ instruction: "stay" }))).toEqual(["INSTRUCTION_CHANGED"]);
  });

  it("detects a start-time change", () => {
    const a = make({ onset: "2026-07-12T14:00:00Z" });
    const b = make({ onset: "2026-07-12T15:30:00Z" });
    expect(types(a, b)).toEqual(["START_TIME_CHANGED"]);
  });

  it("detects an expiry change", () => {
    const a = make({ expiresAt: "2026-07-12T17:00:00Z" });
    const b = make({ expiresAt: "2026-07-12T19:00:00Z" });
    expect(types(a, b)).toEqual(["EXPIRY_CHANGED"]);
  });

  it("distinguishes CANCELLED (issuer withdrawal) from a natural expiry", () => {
    const active = make({ msgType: "Alert" });
    const cancelled = make({ msgType: "Cancel" });
    expect(types(active, cancelled)).toContain("CANCELLED");
    // Re-poll of an already-cancelled message emits nothing new.
    expect(types(cancelled, cancelled)).toEqual([]);
  });

  it("flags AREA_CHANGED when the polygon meaningfully grows, with km² from/to", () => {
    const d = diffAlert(make({ geometry: box(0, 0, 1) }), make({ geometry: box(0, 0, 2) }));
    const area = d.events.find((e) => e.type === "AREA_CHANGED");
    expect(area).toBeDefined();
    expect(Number(area!.to)).toBeGreaterThan(Number(area!.from));
    expect(d.areaKm2).toBeGreaterThan(0);
  });

  it("flags AREA_CHANGED when geometry first appears (null → polygon)", () => {
    expect(types(make({ geometry: null }), make({ geometry: box(0, 0, 1) }))).toContain("AREA_CHANGED");
  });

  it("ignores sub-1% vertex jitter (hash differs, area barely moves)", () => {
    const a = make({ geometry: box(0, 0, 1) });
    const jittered: AlertGeometry = {
      type: "Polygon",
      coordinates: [[[0, 0], [1, 0], [1.001, 1], [0, 1], [0, 0]]],
    };
    const b = make({ geometry: jittered });
    expect(types(a, b)).not.toContain("AREA_CHANGED");
  });

  it("collects multiple simultaneous changes", () => {
    const a = make({ sev: 2, geometry: box(0, 0, 1), expiresAt: "2026-07-12T17:00:00Z" });
    const b = make({ sev: 4, geometry: box(0, 0, 3), expiresAt: "2026-07-12T20:00:00Z" });
    const t = types(a, b);
    expect(t).toEqual(expect.arrayContaining(["SEVERITY_CHANGED", "AREA_CHANGED", "EXPIRY_CHANGED"]));
  });
});
