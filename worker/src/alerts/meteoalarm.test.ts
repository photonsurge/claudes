import { meteoalarmSource, alertToCapMessage } from "./meteoalarm";
import type { RawPayload } from "@photonsurge/shared/alerts/types";

// One Italian thunderstorm warning, trimmed to the MeteoAlarm JSON shape.
const ALERT = {
  identifier: "2.49.0.0.380.3.IT.260624114443.001",
  sender: "aerocnmca@aeronautica.difesa.it",
  sent: "2026-06-24T11:44:43+02:00",
  msgType: "Update",
  status: "Actual",
  scope: "Public",
  references:
    "aerocnmca.1sv@aeronautica.difesa.it,2.49.0.0.380.3.IT.260623130828.078,2026-06-23T13:08:28+02:00",
  info: [
    {
      language: "en-GB",
      category: "Met",
      event: "Green Thunderstorm Warning",
      urgency: "Future",
      severity: "Minor",
      certainty: "Likely",
      onset: "2026-06-24T11:44:00+02:00",
      expires: "2026-06-26T23:59:00+02:00",
      senderName: "Italian Air Force National Meteorological Service",
      parameter: [
        { value: "1; green; Minor", valueName: "awareness_level" },
        { value: "3; Thunderstorm", valueName: "awareness_type" },
      ],
      area: [{ areaDesc: "Valle d'Aosta", geocode: [{ value: "IT004", valueName: "EMMA_ID" }] }],
    },
  ],
};

const body = JSON.stringify({ warnings: [{ alert: ALERT }, { alert: { identifier: "x", info: [] } }] });
const raw: RawPayload[] = [{ contentType: "application/json", body, fetchedAt: "2026-06-24T10:00:00Z" }];

describe("meteoalarmSource.parse", () => {
  const msgs = meteoalarmSource.parse(raw);

  it("maps each alert with info to a CAP message (drops infoless alerts)", () => {
    expect(msgs).toHaveLength(1);
    expect(msgs[0].source).toBe("meteoalarm");
    expect(msgs[0].identifier).toBe(ALERT.identifier);
    expect(msgs[0].msgType).toBe("Update");
  });

  it("ranks CAP severity while keeping the native value", () => {
    expect(msgs[0].info[0].severityRank).toBe(1); // Minor
    expect(msgs[0].info[0].sourceSeverity).toBe("Minor");
  });

  it("flattens the parameter array and geocodes; geometry is null", () => {
    expect(msgs[0].info[0].parameters?.awareness_type).toBe("3; Thunderstorm");
    expect(msgs[0].info[0].area[0].geocodes[0]).toEqual({ valueName: "EMMA_ID", value: "IT004" });
    expect(msgs[0].info[0].area[0].geometry).toBeNull();
  });

  it("splits the whitespace-delimited CAP references string", () => {
    expect(msgs[0].references).toHaveLength(1);
    expect(msgs[0].references[0]).toContain("260623130828.078");
  });

  it("returns null for a malformed alert", () => {
    expect(alertToCapMessage(null)).toBeNull();
    expect(alertToCapMessage({ identifier: "no-info" })).toBeNull();
  });
});
