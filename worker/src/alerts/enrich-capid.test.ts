import type { AppDb } from "@photonsurge/shared/db/index";
import type { iAlert } from "@photonsurge/shared/db/alert-model";
import { enrichCapIds } from "./enrich-capid";
import { parseCapIdentifier } from "./wmo-capid";

const alert = (source: string, identifier: string): iAlert =>
  ({ source, identifier, info: [] }) as unknown as iAlert;

const fakeDb = (cache: Record<string, string>) => {
  const calls: string[][] = [];
  const db = {
    capIds: {
      async byCapurls(keys: string[]) {
        calls.push(keys);
        return new Map(Object.entries(cache).filter(([k]) => keys.includes(k)));
      },
    },
  } as unknown as AppDb;
  return { db, calls };
};

describe("enrichCapIds", () => {
  it("takes MeteoAlarm's identifier as the canonical CAP id, with no lookup", async () => {
    const { db, calls } = fakeDb({});
    const a = alert("meteoalarm", "2.49.0.0.616.0.PL.Sk20260715120207440.PL3202");

    const res = await enrichCapIds([a], db);

    expect(a.capId).toBe("2.49.0.0.616.0.PL.Sk20260715120207440.PL3202");
    expect(res.filled).toBe(1);
    expect(calls).toHaveLength(0); // it's free — never hit the cache for these
  });

  it("does the same for NWS", async () => {
    const { db } = fakeDb({});
    const a = alert("nws", "urn:oid:2.49.0.1.840.0.abc.001.1");

    await enrichCapIds([a], db);

    expect(a.capId).toBe("urn:oid:2.49.0.1.840.0.abc.001.1");
  });

  it("resolves WMO's capurl through the cache", async () => {
    const capurl = "pl-imgw-xx/2026/07/15/12/02/00-13bbaeab.xml";
    const { db } = fakeDb({ [capurl]: "2.49.0.0.616.0.PL.Sk20260715120207440.PL3202" });
    const a = alert("wmo", capurl);

    const res = await enrichCapIds([a], db);

    // The whole point: the WMO copy now shares an exact key with the MeteoAlarm one.
    expect(a.capId).toBe("2.49.0.0.616.0.PL.Sk20260715120207440.PL3202");
    expect(res.filled).toBe(1);
  });

  it("leaves an unresolved WMO alert unstamped and counts it", async () => {
    const { db } = fakeDb({});
    const a = alert("wmo", "pl-imgw-xx/not-resolved-yet.xml");

    const res = await enrichCapIds([a], db);

    expect(a.capId).toBeUndefined();
    expect(res).toMatchObject({ filled: 0, unresolved: 1 });
  });

  it("never gives GDACS a capId — it has no national CAP behind it", async () => {
    const { db, calls } = fakeDb({ x: "y" });
    const a = alert("gdacs", "gdacs-EQ-12345");

    const res = await enrichCapIds([a], db);

    expect(a.capId).toBeUndefined();
    expect(res.filled).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("looks WMO up in ONE batched query for the whole tick", async () => {
    const { db, calls } = fakeDb({});
    await enrichCapIds([alert("wmo", "a.xml"), alert("wmo", "b.xml")], db);

    expect(calls).toEqual([["a.xml", "b.xml"]]);
  });
});

describe("parseCapIdentifier", () => {
  it("pulls the identifier and sender out of a real CAP XML", () => {
    const xml = `<?xml version="1.0"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
      <identifier>2.49.0.0.616.0.PL.Sk20260715120207440.PL3202</identifier>
      <sender>https://www.imgw.pl</sender>
      <status>Actual</status></alert>`;

    expect(parseCapIdentifier(xml)).toEqual({
      capId: "2.49.0.0.616.0.PL.Sk20260715120207440.PL3202",
      sender: "https://www.imgw.pl",
    });
  });

  it("returns a null capId rather than throwing when there isn't one", () => {
    expect(parseCapIdentifier("<alert><status>Actual</status></alert>").capId).toBeNull();
    expect(parseCapIdentifier("not xml at all").capId).toBeNull();
    expect(parseCapIdentifier("<alert><identifier>  </identifier></alert>").capId).toBeNull();
  });

  it("tolerates a value wrapped across lines", () => {
    expect(parseCapIdentifier("<alert><identifier>\n  urn:oid:1.2\n</identifier></alert>").capId).toBe(
      "urn:oid:1.2",
    );
  });
});
