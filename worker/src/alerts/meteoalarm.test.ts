import { meteoalarmSource, alertToCapMessage } from "./meteoalarm";
import type { RawPayload } from "@photonsurge/shared/alerts/types";

/**
 * One Italian thunderstorm warning, trimmed to the MeteoAlarm JSON shape.
 *
 * YELLOW on purpose. This fixture used to be the feed's real "Green Thunderstorm
 * Warning" and was the one every parse test leaned on — which stopped working the
 * moment green stopped entering the system, because `parse` now drops it and the
 * whole block asserted against an empty array. Green's own behaviour is covered
 * below, through `alertToCapMessage` (which ranks but does not filter) and the
 * drop tests.
 */
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
      event: "Yellow Thunderstorm Warning",
      urgency: "Future",
      severity: "Minor",
      certainty: "Likely",
      onset: "2026-06-24T11:44:00+02:00",
      expires: "2026-06-26T23:59:00+02:00",
      senderName: "Italian Air Force National Meteorological Service",
      parameter: [
        { value: "2; yellow; Moderate", valueName: "awareness_level" },
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

  /**
   * A real one: the feed calls this `severity: "Minor"` and `awareness_level:
   * "2; yellow; Moderate"` in the same breath. They disagree, the ingest trusted
   * `severity`, and 58% of the live feed came in at the wrong rank.
   *
   * The awareness level is what MeteoAlarm means and what its own site colours by.
   * The CAP field stays on the doc as `sourceSeverity` — it's still what the feed
   * said, it's just not what we rank on. Severity is also part of the dissolve's
   * bucket key, so a yellow ranked Minor never fused with the yellows it was
   * physically touching and drew stacked on them instead.
   */
  it("ranks on the awareness level, not the CAP severity they contradict", () => {
    expect(msgs[0].info[0].severityRank).toBe(2); // yellow, whatever CAP claims
    expect(msgs[0].info[0].sourceSeverity).toBe("Minor"); // what the feed claimed
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

/**
 * The rank a MeteoAlarm alert lands on decides its colour AND its dissolve bucket,
 * so getting it from the wrong field doesn't just mis-paint a shape — it stops it
 * fusing with its true neighbours and draws it stacked on them instead.
 */
describe("severity comes from the awareness level", () => {
  const build = (params: { value: string; valueName: string }[], severity = "Minor") => {
    const alert = {
      identifier: "2.49.0.0.ES.x",
      sent: "2026-07-16T02:00:00Z",
      info: [
        { language: "en", event: "Test", severity, parameter: params, area: [{ areaDesc: "Somewhere" }] },
      ],
    };
    return meteoalarmSource.parse([
      {
        contentType: "application/json",
        body: JSON.stringify({ warnings: [{ alert }] }),
        fetchedAt: "2026-07-16T02:00:00Z",
      },
    ] as RawPayload[]);
  };

  const lvl = (v: string) => [{ value: v, valueName: "awareness_level" }];

  it("green is NOT a warning", () => {
    // Via alertToCapMessage, not parse: parse now DROPS green outright, so the
    // rank is only observable here. The rule still has to be right — the drop is
    // a separate decision layered on top of it, not a replacement for it.
    const msg = alertToCapMessage({
      identifier: "g",
      sent: "2026-07-16T02:00:00Z",
      info: [
        {
          language: "en",
          event: "Test",
          severity: "Minor",
          parameter: [{ value: "1; green; Minor", valueName: "awareness_level" }],
          area: [{ areaDesc: "Somewhere" }],
        },
      ],
    });
    expect(msg!.info[0].severityRank).toBe(0);
  });

  it("maps yellow, orange and red", () => {
    expect(build(lvl("2; yellow; Moderate"))[0].info[0].severityRank).toBe(2);
    expect(build(lvl("3; orange; Severe"))[0].info[0].severityRank).toBe(3);
    expect(build(lvl("4; red; Extreme"))[0].info[0].severityRank).toBe(4);
  });

  it("believes the level over a CAP severity that contradicts it", () => {
    // A real one: event BÖEN, severity "Minor", awareness_level "2; yellow".
    // Ranked 1 by CAP, it missed the yellow bucket and never fused with the
    // yellow warnings it was touching.
    expect(build(lvl("2; yellow; Moderate"), "Minor")[0].info[0].severityRank).toBe(2);
  });

  it("falls back to CAP severity when there is no level at all", () => {
    // Must not silently mark a real warning as info.
    expect(build([], "Severe")[0].info[0].severityRank).toBe(3);
    expect(build([{ value: "3; Thunderstorm", valueName: "awareness_type" }], "Extreme")[0].info[0].severityRank).toBe(4);
  });

  it("falls back when the level is unparseable rather than zeroing it", () => {
    expect(build(lvl("nonsense"), "Severe")[0].info[0].severityRank).toBe(3);
  });
});

/**
 * Green never enters the system. It is 57% of this feed (1,546 of 2,708 live),
 * every one carrying full EMMA boundary geometry — so each was costing a Mongo
 * write, a 2dsphere index entry, a dissolve clip, a slot in the whole-planet
 * /api/alerts payload and a shape on the globe, to report that nothing is
 * happening.
 */
describe("meteoalarmSource.parse drops green (nothing expected)", () => {
  const feed = (...alerts: any[]) =>
    meteoalarmSource.parse([
      {
        contentType: "application/json",
        body: JSON.stringify({ warnings: alerts.map((alert) => ({ alert })) }),
        fetchedAt: "2026-07-16T02:00:00Z",
      },
    ] as RawPayload[]);

  const mk = (id: string, ...levels: (string | null)[]) => ({
    identifier: id,
    sent: "2026-07-16T02:00:00Z",
    info: levels.map((l) => ({
      language: "en",
      event: "Test",
      severity: "Minor",
      parameter: l == null ? [] : [{ value: l, valueName: "awareness_level" }],
      area: [{ areaDesc: "Somewhere" }],
    })),
  });

  it("drops an all-green alert", () => {
    expect(feed(mk("g", "1; green; Minor", "1; green; Minor"))).toHaveLength(0);
  });

  it("keeps yellow, orange and red", () => {
    expect(feed(mk("y", "2; yellow; Moderate"))).toHaveLength(1);
    expect(feed(mk("o", "3; orange; Severe"))).toHaveLength(1);
    expect(feed(mk("r", "4; red; Extreme"))).toHaveLength(1);
  });

  it("keeps an alert with ANY non-green block", () => {
    // ALL, not some — one real block among green ones must survive.
    expect(feed(mk("m", "1; green; Minor", "3; orange; Severe"))).toHaveLength(1);
  });

  it("keeps an alert with no awareness level at all", () => {
    // It falls back to CAP severity; absence of a level is not "nothing expected".
    expect(feed(mk("n", null))).toHaveLength(1);
  });

  it("drops only the greens out of a real mixed feed", () => {
    const msgs = feed(mk("g1", "1; green; Minor"), mk("y1", "2; yellow; Moderate"), mk("g2", "1; green; Minor"));
    expect(msgs.map((m) => m.identifier)).toEqual(["y1"]);
  });
});

describe("meteoalarmSource.fetchParsed", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.METEOALARM_COUNTRIES;
  });

  it("matches fetch()+parse() output, skipping failed countries silently", async () => {
    process.env.METEOALARM_COUNTRIES = "austria,france,germany";
    const de = { ...ALERT, identifier: "de-alert-1" };
    const bodies: Record<string, string> = {
      austria: JSON.stringify({ warnings: [{ alert: ALERT }] }),
      germany: JSON.stringify({ warnings: [{ alert: de }] }),
    };
    jest.spyOn(globalThis, "fetch").mockImplementation(async (url: any) => {
      const c = String(url).split("feeds-")[1];
      if (c === "france") return new Response("gateway timeout", { status: 504 });
      return new Response(bodies[c], { headers: { "content-type": "application/json" } });
    });

    const streamed = await meteoalarmSource.fetchParsed!();
    const buffered = meteoalarmSource.parse(await meteoalarmSource.fetch());
    expect(streamed).toEqual(buffered);
    expect(streamed.map((m) => m.identifier)).toEqual([ALERT.identifier, "de-alert-1"]);
  });
});
