import { harvestGdacsExtras } from "./gdacs-extras";
import type { iAlert } from "@photonsurge/shared/db/alert-model";

const NOW = new Date("2026-07-12T15:00:00Z");

function gdacsAlert(props: Record<string, unknown>): iAlert {
  return {
    source: "gdacs",
    identifier: "TC1000",
    sender: "GDACS",
    sent: "2026-07-12T12:00:00Z",
    msgType: "Alert",
    status: "Actual",
    references: [],
    ingestedAt: NOW.toISOString(),
    active: true,
    maxSeverityRank: 3,
    info: [
      {
        category: ["Met"],
        event: "Tropical Cyclone",
        severityRank: 3,
        area: [{ areaDesc: "", geometry: { type: "Point", coordinates: [120, 15] }, geocodes: [] }],
      },
    ],
    id: "alert-1",
    raw: { properties: props },
  } as unknown as iAlert;
}

function fakeDb() {
  const samples: any[] = [];
  const resources: any[] = [];
  let nextAppended = true;
  const db = {
    alertSeries: {
      async appendSample(s: any) {
        samples.push(s);
        return { appended: nextAppended };
      },
    },
    alertResources: {
      async upsertMany(rs: any[]) {
        resources.push(...rs);
        return { upserted: rs.length, matched: 0 };
      },
    },
  } as any;
  return { db, samples, resources, setAppended: (v: boolean) => (nextAppended = v) };
}

describe("harvestGdacsExtras", () => {
  it("promotes numeric metrics to series samples and links to resources", async () => {
    const { db, samples, resources } = fakeDb();
    const a = gdacsAlert({
      alertscore: 1.8,
      episodealertscore: 2.1,
      severitydata: { severity: 185, severityunit: "km/h", severitytext: "Category 4" },
      population: 3_400_000,
      url: { report: "https://www.gdacs.org/report.aspx?eventid=1000", details: "https://www.gdacs.org/details" },
      iconoverall: "https://www.gdacs.org/images/gdacs_icons/maps/Red/TC.png",
    });
    const res = await harvestGdacsExtras(a, db, NOW);

    expect(samples.map((s) => s.metric).sort()).toEqual(["alertscore", "episodealertscore", "population", "severity"]);
    // Loc + alertId threaded through for the nearest-series lookup.
    expect(samples[0]).toMatchObject({ source: "gdacs", identifier: "TC1000", alertId: "alert-1", lng: 120, lat: 15 });
    expect(res.samples).toBe(4);

    const urls = resources.map((r) => r.url);
    expect(urls).toContain("https://www.gdacs.org/report.aspx?eventid=1000");
    expect(urls).toContain("https://www.gdacs.org/images/gdacs_icons/maps/Red/TC.png");
    expect(resources.find((r) => r.kind === "icon")).toBeTruthy();
    expect(res.resources).toBe(3);
  });

  it("skips non-numeric metrics and non-http resource values", async () => {
    const { db, samples, resources } = fakeDb();
    const a = gdacsAlert({ alertscore: "n/a", population: 5, url: { report: "not-a-url" } });
    const res = await harvestGdacsExtras(a, db, NOW);
    expect(samples.map((s) => s.metric)).toEqual(["population"]);
    expect(resources).toHaveLength(0);
    expect(res).toEqual({ samples: 1, resources: 0 });
  });

  it("no-ops when the alert has no raw feature", async () => {
    const { db, samples, resources } = fakeDb();
    const a = gdacsAlert({});
    (a as { raw?: unknown }).raw = undefined;
    const res = await harvestGdacsExtras(a, db, NOW);
    expect(samples).toHaveLength(0);
    expect(resources).toHaveLength(0);
    expect(res).toEqual({ samples: 0, resources: 0 });
  });
});
