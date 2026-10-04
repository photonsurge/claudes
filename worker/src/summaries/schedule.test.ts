import { DEFAULT_ROUNDUP_SETTINGS, sanitizeRoundupSettings } from "@photonsurge/shared/roundup-settings";
import { planSummaryTick, hourliesInWindow, TICK_PERIODS } from "./schedule";

const at = (iso: string) => new Date(iso);

describe("planSummaryTick", () => {
  it("runs hourly before 12h before daily", () => {
    expect(TICK_PERIODS).toEqual(["hourly", "12h", "daily"]);
    // 00:05Z with nothing ever generated: every default slot is open.
    const plan = planSummaryTick(at("2026-07-11T00:05:00Z"), DEFAULT_ROUNDUP_SETTINGS, {});
    expect(plan.due).toEqual(["hourly", "12h", "daily"]);
    expect(plan.skipped).toEqual({});
  });

  it("at defaults mid-morning only the hourly is due", () => {
    const now = at("2026-07-11T09:07:00Z");
    const plan = planSummaryTick(now, DEFAULT_ROUNDUP_SETTINGS, {
      hourly: at("2026-07-11T08:07:00Z"),
      "12h": at("2026-07-11T00:07:00Z"),
      daily: at("2026-07-11T00:07:00Z"),
    });
    expect(plan.due).toEqual(["hourly"]);
    expect(plan.skipped).toEqual({ "12h": "not-due", daily: "not-due" });
  });

  it("skips a period whose slot was already served (e.g. a manual Generate now)", () => {
    const plan = planSummaryTick(at("2026-07-11T12:09:00Z"), DEFAULT_ROUNDUP_SETTINGS, {
      hourly: at("2026-07-11T12:01:00Z"),
      "12h": at("2026-07-11T00:09:00Z"),
      daily: at("2026-07-11T00:09:00Z"),
    });
    expect(plan.due).toEqual(["12h"]);
  });

  it("reports a disabled period as disabled, not just not-due", () => {
    const settings = sanitizeRoundupSettings({ "global-hourly": { enabled: false } });
    const plan = planSummaryTick(at("2026-07-11T00:05:00Z"), settings, {});
    expect(plan.due).toEqual(["12h", "daily"]);
    expect(plan.skipped).toEqual({ hourly: "disabled" });
  });

  it("follows thinned hourly slots", () => {
    const settings = sanitizeRoundupSettings({ "global-hourly": { hours: [0, 6, 12, 18] } });
    const last = { hourly: at("2026-07-11T06:04:00Z") };
    expect(planSummaryTick(at("2026-07-11T07:04:00Z"), settings, last).due).not.toContain("hourly");
    expect(planSummaryTick(at("2026-07-11T12:04:00Z"), settings, last).due).toContain("hourly");
  });
});

describe("hourliesInWindow", () => {
  const now = at("2026-07-11T12:10:00Z");
  const doc = (iso: string) => ({ generatedAt: at(iso) });

  it("keeps only hourlies generated in the last 12 hours, whatever their count", () => {
    const docs = [
      doc("2026-07-11T12:05:00Z"),
      doc("2026-07-11T06:05:00Z"),
      doc("2026-07-11T00:15:00Z"), // 11h55m ago — in
      doc("2026-07-11T00:05:00Z"), // 12h05m ago — out
      doc("2026-07-09T18:05:00Z"), // days old (hourlies were switched off) — out
    ];
    expect(hourliesInWindow(docs, now)).toEqual(docs.slice(0, 3));
  });

  it("is empty when no hourly was written in the window", () => {
    expect(hourliesInWindow([doc("2026-07-10T18:00:00Z")], now)).toEqual([]);
  });

  it("drops undated docs and docs from the future", () => {
    expect(hourliesInWindow([{ generatedAt: "nope" as any }, doc("2026-07-11T13:00:00Z")], now)).toEqual([]);
  });
});
