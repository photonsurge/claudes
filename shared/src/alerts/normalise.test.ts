import {
  isActive,
  earliestExpiry,
  canonicaliseCapMessage,
  referencedIdentifiers,
} from "./normalise";
import type { CapMessage } from "./types";

const NOW = new Date("2026-06-28T12:00:00Z");

const msg = (over: Partial<CapMessage> = {}): CapMessage => ({
  source: "nws",
  identifier: "URN:oid:2.49.0.1.840.0.abc",
  sender: "w-nws.webmaster@noaa.gov",
  sent: "2026-06-28T10:00:00Z",
  msgType: "Alert",
  status: "Actual",
  references: [],
  info: [
    {
      category: ["Met"],
      event: "Severe Thunderstorm Warning",
      severity: "Severe",
      severityRank: 3,
      expires: "2026-06-28T14:00:00Z",
      area: [{ areaDesc: "Cook County", geocodes: [] }],
    },
  ],
  ...over,
});

describe("isActive", () => {
  it("is active when Actual, not cancelled, and unexpired", () => {
    expect(isActive("Alert", "Actual", "2026-06-28T14:00:00Z", NOW)).toBe(true);
  });
  it("is inactive when expired", () => {
    expect(isActive("Alert", "Actual", "2026-06-28T11:00:00Z", NOW)).toBe(false);
  });
  it("is inactive for Cancel and non-Actual status", () => {
    expect(isActive("Cancel", "Actual", "2026-06-28T14:00:00Z", NOW)).toBe(false);
    expect(isActive("Alert", "Test", "2026-06-28T14:00:00Z", NOW)).toBe(false);
  });
  it("handles TZ-offset expiry correctly (not lexical)", () => {
    // 13:00-04:00 == 17:00Z, which is after NOW (12:00Z) → still active.
    expect(isActive("Alert", "Actual", "2026-06-28T13:00:00-04:00", NOW)).toBe(true);
  });
});

describe("earliestExpiry", () => {
  it("returns the earliest expiry normalised to UTC Z", () => {
    const got = earliestExpiry([
      { event: "a", severityRank: 0, category: [], area: [], expires: "2026-06-28T16:00:00Z" },
      { event: "b", severityRank: 0, category: [], area: [], expires: "2026-06-28T14:00:00Z" },
    ]);
    expect(got).toBe("2026-06-28T14:00:00.000Z");
  });
  it("returns undefined when no info has an expiry", () => {
    expect(earliestExpiry([{ event: "a", severityRank: 0, category: [], area: [] }])).toBeUndefined();
  });
});

describe("canonicaliseCapMessage", () => {
  it("derives active, maxSeverityRank, expiresAt and ingestedAt", () => {
    const c = canonicaliseCapMessage(msg(), NOW);
    expect(c.active).toBe(true);
    expect(c.maxSeverityRank).toBe(3);
    expect(c.expiresAt).toBe("2026-06-28T14:00:00.000Z");
    expect(c.ingestedAt).toBe(NOW.toISOString());
  });
  it("flags a Cancel message inactive but keeps it (history)", () => {
    const c = canonicaliseCapMessage(msg({ msgType: "Cancel" }), NOW);
    expect(c.active).toBe(false);
    expect(c.identifier).toBe("URN:oid:2.49.0.1.840.0.abc");
  });

  it("collapses a bilingual alert to its English block only", () => {
    const c = canonicaliseCapMessage(
      msg({
        info: [
          { language: "de", event: "Sturm", severity: "Severe", severityRank: 3, category: ["Met"], area: [] },
          { language: "en", event: "Storm", severity: "Severe", severityRank: 3, category: ["Met"], area: [] },
        ],
      }),
      NOW,
    );
    expect(c.info).toHaveLength(1);
    expect(c.info[0].language).toBe("en");
    expect(c.info[0].event).toBe("Storm");
    expect(c.maxSeverityRank).toBe(3);
  });

  it("keeps a national-only alert (no English edition) untouched", () => {
    const c = canonicaliseCapMessage(
      msg({ info: [{ language: "de", event: "Sturm", severityRank: 3, category: ["Met"], area: [] }] }),
      NOW,
    );
    expect(c.info).toHaveLength(1);
    expect(c.info[0].language).toBe("de");
  });
});

describe("referencedIdentifiers", () => {
  it("extracts the identifier from each 'sender,identifier,sent' ref", () => {
    expect(
      referencedIdentifiers([
        "w-nws@noaa.gov,URN:oid:prev-1,2026-06-28T09:00:00Z",
        "w-nws@noaa.gov,URN:oid:prev-2,2026-06-28T09:30:00Z",
      ]),
    ).toEqual(["URN:oid:prev-1", "URN:oid:prev-2"]);
  });
});
