import { readFileSync } from "fs";
import { join } from "path";
import { nwsSource } from "./nws";
import { ingestSource } from "./ingest";
import type { RawPayload } from "@photonsurge/shared/alerts/types";

const sampleBody = readFileSync(join(__dirname, "__fixtures__", "nws-sample.json"), "utf8");
const raw: RawPayload[] = [
  { contentType: "application/geo+json", body: sampleBody, fetchedAt: "2026-06-28T17:00:00Z" },
];
const NOW = new Date("2026-06-28T17:00:00Z"); // 12:00 CDT — before both expiries

describe("nwsSource.parse", () => {
  const msgs = nwsSource.parse(raw);

  it("maps each feature to a CAP message", () => {
    expect(msgs).toHaveLength(2);
    expect(msgs[0].source).toBe("nws");
    expect(msgs[0].identifier).toBe("urn:oid:2.49.0.1.840.0.aaa.001.1");
    expect(msgs[0].msgType).toBe("Alert");
  });

  it("normalises severity into severityRank while keeping the native value", () => {
    expect(msgs[0].info[0].severityRank).toBe(3); // Severe
    expect(msgs[0].info[0].sourceSeverity).toBe("Severe");
    expect(msgs[1].info[0].severityRank).toBe(4); // Extreme (tornado)
  });

  it("carries polygon geometry through and flattens geocodes", () => {
    expect(msgs[0].info[0].area[0].geometry?.type).toBe("Polygon");
    expect(msgs[0].info[0].area[0].geocodes).toEqual([
      { valueName: "SAME", value: "017031" },
      { valueName: "UGC", value: "ILC031" },
    ]);
    expect(msgs[1].info[0].area[0].geometry).toBeNull(); // geocode-only feature
  });

  it("formats references as 'sender,identifier,sent'", () => {
    expect(msgs[1].references).toEqual([
      "w-nws.webmaster@noaa.gov,urn:oid:2.49.0.1.840.0.bbb.001.1,2026-06-28T11:15:00-05:00",
    ]);
  });

  it("ignores malformed payloads without throwing", () => {
    expect(nwsSource.parse([{ contentType: "x", body: "not json", fetchedAt: "x" }])).toEqual([]);
  });
});

describe("nwsSource.normalise", () => {
  it("derives active + maxSeverityRank from parsed messages", () => {
    const canon = nwsSource.normalise(nwsSource.parse(raw), NOW);
    expect(canon[0].active).toBe(true);
    expect(canon[0].maxSeverityRank).toBe(3);
    expect(canon[1].maxSeverityRank).toBe(4);
    expect(canon[0].expiresAt).toBe("2026-06-28T17:30:00.000Z"); // 12:30 CDT → UTC
  });
});

describe("ingestSource", () => {
  // Stub fetch so the test never touches the live NWS API — feed the fixture.
  const offlineSource = { ...nwsSource, fetch: async () => raw };

  it("upserts each alert and supersedes referenced chains via a fake repo", async () => {
    const upserts: string[] = [];
    const superseded: { source: string; ids: string[] }[] = [];
    let expiredCalls = 0;

    const fakeDb = {
      alerts: {
        async upsert(a: any) {
          upserts.push(a.identifier);
          return { inserted: true };
        },
        async supersede(source: string, ids: string[]) {
          superseded.push({ source, ids });
          return ids.length;
        },
        async expire() {
          expiredCalls++;
          return 0;
        },
        async deactivateMissing() {
          return 0;
        },
      },
    } as any;

    const res = await ingestSource(offlineSource, fakeDb, NOW);

    expect(res).toMatchObject({ source: "nws", count: 2, inserted: 2, superseded: 1 });
    expect(upserts).toHaveLength(2);
    expect(superseded).toEqual([
      { source: "nws", ids: ["urn:oid:2.49.0.1.840.0.bbb.001.1"] },
    ]);
    expect(expiredCalls).toBe(1);
  });
});
