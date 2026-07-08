import { fetchUsgsVonaAlerts } from "./usgs-vona";

// Trimmed but structurally real fixture, from a live response verified before
// writing this module — `vnum` is the same Smithsonian VOTW number our
// `volcanoId` ("gvp:<vnum>") already keys on.
const RAW = [
  {
    vName: "Kilauea",
    vnum: "332010",
    lat: 19.421,
    long: -155.287,
    alertLevel: "ADVISORY",
    colorCode: "YELLOW",
    noticeSynopsis: "HVO Kilauea YELLOW/ADVISORY - not erupting.",
    noticeUrl: "https://volcanoes.usgs.gov/hans2/view/notice/x",
    sentUtc: "2026-07-07 19:15:18",
  },
  { vName: "Bad Entry", vnum: "", lat: 1, long: 1, alertLevel: "WATCH", colorCode: "ORANGE", sentUtc: "2026-07-07 19:00:00" },
];

describe("fetchUsgsVonaAlerts", () => {
  it("maps vnum to our gvp:<vnum> volcanoId and parses sentUtc as UTC", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => RAW }) as unknown as typeof fetch;
    const alerts = await fetchUsgsVonaAlerts(fetchImpl);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      volcanoId: "gvp:332010",
      name: "Kilauea",
      alertLevel: "ADVISORY",
      colorCode: "YELLOW",
    });
    expect(alerts[0].updatedAtMs).toBe(Date.parse("2026-07-07T19:15:18Z"));
  });

  it("skips entries with no vnum or non-finite coordinates", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => RAW }) as unknown as typeof fetch;
    const alerts = await fetchUsgsVonaAlerts(fetchImpl);
    expect(alerts.find((a) => a.name === "Bad Entry")).toBeUndefined();
  });

  it("throws on a non-2xx response so the caller's snapshot job can log/retry", async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;
    await expect(fetchUsgsVonaAlerts(fetchImpl)).rejects.toThrow("503");
  });
});
