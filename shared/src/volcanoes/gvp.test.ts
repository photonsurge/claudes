import { parseGvpWeekly } from "./gvp";

const NOW = Date.parse("2026-07-06T12:00:00Z");

// Trimmed but structurally real fixture (from the live feed): plain-text
// description with HTML-escaped entities, no CDATA — matches what stripHtml
// needs to handle.
const RSS = `<?xml version="1.0" encoding="ISO-8859-1"?>
<rss version="2.0" xmlns:georss="http://www.georss.org/georss">
<channel>
<title>Smithsonian / USGS Weekly Volcanic Activity Report</title>

<item>
<title>Etna (Italy) - Report for 25 June-1 July 2026 - New Eruptive Activity</title>
<description>
&lt;p&gt;The Sezione di Catania - Osservatorio Etneo (INGV) reported eruptive activity at Etna's summit craters during May-June.&lt;/p&gt;
&lt;p&gt;Sources: INGV&lt;/p&gt;
</description>
<link>https://volcano.si.edu/reports_weekly.cfm</link>
<guid isPermaLink="true">https://volcano.si.edu/reports_weekly.cfm#vn_211060</guid>
<pubDate>Mon, 06 Jul 2026 05:54:14 -0400</pubDate>
<georss:point>37.7480 14.9990</georss:point>
</item>

<item>
<title>Kelimutu (Indonesia) - Report for 25 June-1 July 2026 - Continuing Unrest</title>
<description>
&lt;p&gt;PVMBG reported ongoing unrest at Kelimutu.&lt;/p&gt;
</description>
<link>https://volcano.si.edu/reports_weekly.cfm</link>
<guid isPermaLink="true">https://volcano.si.edu/reports_weekly.cfm#vn_264230</guid>
<pubDate>Mon, 06 Jul 2026 05:54:14 -0400</pubDate>
<georss:point>-8.7700 121.8200</georss:point>
</item>

<item>
<title>Bad Item With No Guid Number</title>
<description>irrelevant</description>
<guid isPermaLink="true">https://volcano.si.edu/reports_weekly.cfm#not-a-volcano-number</guid>
<georss:point>10.0000 10.0000</georss:point>
</item>

<item>
<title>Missing Point Volcano (Nowhere) - Report for 1-7 July 2026 - New Eruptive Activity</title>
<guid isPermaLink="true">https://volcano.si.edu/reports_weekly.cfm#vn_999999</guid>
</item>

</channel>
</rss>`;

describe("parseGvpWeekly", () => {
  it("parses name/country/coords/id from a well-formed item", () => {
    const volcanoes = parseGvpWeekly(RSS, NOW);
    const etna = volcanoes.find((v) => v.id === "gvp:211060");
    expect(etna).toBeDefined();
    expect(etna!.name).toBe("Etna");
    expect(etna!.country).toBe("Italy");
    expect(etna!.lat).toBeCloseTo(37.748);
    expect(etna!.lng).toBeCloseTo(14.999);
    expect(etna!.sourceUrl).toBe("https://volcano.si.edu/volcano.cfm?vn=211060");
    expect(etna!.reportDateRange).toBe("25 June-1 July 2026");
  });

  it("classifies status from the report's own activity label, not a time window", () => {
    const volcanoes = parseGvpWeekly(RSS, NOW);
    expect(volcanoes.find((v) => v.id === "gvp:211060")!.status).toBe("erupting");
    expect(volcanoes.find((v) => v.id === "gvp:264230")!.status).toBe("unrest");
  });

  it("strips HTML tags and un-escapes entities in the report text", () => {
    const [etna] = parseGvpWeekly(RSS, NOW);
    expect(etna.latestReport).toContain("The Sezione di Catania - Osservatorio Etneo (INGV) reported");
    expect(etna.latestReport).not.toMatch(/<p>|&lt;/);
  });

  it("uses the bulletin's publish date for both first/last seen on a fresh parse", () => {
    const [etna] = parseGvpWeekly(RSS, NOW);
    expect(etna.lastDate).toBe(Date.parse("Mon, 06 Jul 2026 05:54:14 -0400"));
    expect(etna.firstDate).toBe(etna.lastDate);
  });

  it("skips items with no parseable volcano number, missing point, or unmatched title", () => {
    const volcanoes = parseGvpWeekly(RSS, NOW);
    expect(volcanoes).toHaveLength(2);
    expect(volcanoes.find((v) => v.name.includes("Bad Item"))).toBeUndefined();
    expect(volcanoes.find((v) => v.id === "gvp:999999")).toBeUndefined();
  });
});
