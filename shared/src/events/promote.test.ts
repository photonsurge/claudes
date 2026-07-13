import type { iAlert, iAlertInfo } from "../db/alert-model";
import { alertToWatchedEvent, watchedEventTypeForAlert, timelineUpdatesFromChanges } from "./promote";

const info = (over: Partial<iAlertInfo> = {}): iAlertInfo => ({
  category: ["Met"],
  event: "Tropical Cyclone",
  severityRank: 3,
  area: [{ areaDesc: "Coast", geometry: { type: "Point", coordinates: [120, 14] }, geocodes: [] }],
  ...over,
});

const alert = (over: Partial<iAlert> = {}): iAlert => ({
  source: "gdacs",
  identifier: "TC1000123",
  sender: "GDACS",
  sent: "2026-07-12T14:00:00Z",
  msgType: "Alert",
  status: "Actual",
  references: [],
  info: [info()],
  ingestedAt: "2026-07-12T14:00:00Z",
  active: true,
  maxSeverityRank: 3,
  ...over,
});

describe("watchedEventTypeForAlert", () => {
  it("maps GDACS hazard codes ahead of the event text", () => {
    expect(watchedEventTypeForAlert(alert({ info: [info({ parameters: { gdacsEventType: "TC" } })] }))).toBe("CYCLONE");
    expect(watchedEventTypeForAlert(alert({ info: [info({ parameters: { gdacsEventType: "FL" } })] }))).toBe("FLOOD");
    expect(watchedEventTypeForAlert(alert({ info: [info({ parameters: { gdacsEventType: "WF" } })] }))).toBe("WILDFIRE");
    // Unknown/volcanic GDACS code falls through to the CAP event text (its own,
    // not the cyclone default) → WEATHER_ALERT for a volcanic bulletin.
    expect(
      watchedEventTypeForAlert(alert({ info: [info({ event: "Volcanic Activity", parameters: { gdacsEventType: "VO" } })] })),
    ).toBe("WEATHER_ALERT");
  });

  it("classifies non-GDACS alerts from the CAP event text", () => {
    expect(watchedEventTypeForAlert(alert({ info: [info({ event: "Coastal Flood Warning", parameters: {} })] }))).toBe(
      "FLOOD",
    );
    expect(watchedEventTypeForAlert(alert({ info: [info({ event: "Red Flag Fire Warning", parameters: {} })] }))).toBe(
      "WILDFIRE",
    );
    expect(watchedEventTypeForAlert(alert({ info: [info({ event: "Severe Thunderstorm", parameters: {} })] }))).toBe(
      "WEATHER_ALERT",
    );
  });
});

describe("alertToWatchedEvent", () => {
  it("derives the lean event core with framing", () => {
    const core = alertToWatchedEvent(
      alert({ info: [info({ parameters: { gdacsEventType: "TC" }, headline: "Cyclone Alpha" })] }),
    );
    expect(core.type).toBe("CYCLONE");
    expect(core.status).toBe("ACTIVE");
    expect(core.title).toBe("Cyclone Alpha");
    expect(core.primarySource).toBe("gdacs");
    expect(core.primarySourceId).toBe("TC1000123");
    expect(core.repPoint).toEqual({ type: "Point", coordinates: [120, 14] });
    expect(core.bbox).toBeTruthy();
  });

  it("reads status from lifecycle: Cancel → CANCELLED, inactive → ENDED", () => {
    expect(alertToWatchedEvent(alert({ msgType: "Cancel" })).status).toBe("CANCELLED");
    const ended = alertToWatchedEvent(alert({ active: false, expiresAt: "2026-07-12T13:00:00Z" }));
    expect(ended.status).toBe("ENDED");
    expect(ended.endedAt).toBe("2026-07-12T13:00:00Z");
  });

  it("prefers onset for startedAt, falling back to sent", () => {
    expect(alertToWatchedEvent(alert({ info: [info({ onset: "2026-07-12T13:30:00Z" })] })).startedAt).toBe(
      "2026-07-12T13:30:00Z",
    );
    expect(alertToWatchedEvent(alert({ info: [info({ onset: undefined, effective: undefined })] })).startedAt).toBe(
      "2026-07-12T14:00:00Z",
    );
  });
});

describe("timelineUpdatesFromChanges", () => {
  it("maps alert changes to labelled beats with severity/area carried through", () => {
    const beats = timelineUpdatesFromChanges(
      "evt-1",
      [
        { type: "SEVERITY_CHANGED", from: "2", to: "3" },
        { type: "AREA_CHANGED", from: "1000", to: "1500" },
        { type: "CANCELLED" },
      ],
      "2026-07-12T14:17:00Z",
      "gdacs",
    );
    expect(beats.map((b) => b.type)).toEqual(["SEVERITY_CHANGED", "AREA_CHANGED", "CANCELLED"]);
    expect(beats[0]).toMatchObject({ eventId: "evt-1", source: "gdacs", severityRank: 3 });
    expect(beats[0].label).toContain("Severity");
    expect(beats[1].areaKm2).toBe(1500);
    expect(beats[2].label).toBe("Cancelled by issuer");
  });
});
