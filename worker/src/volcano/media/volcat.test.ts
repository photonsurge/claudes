import { fetchVolcatImages } from "./volcat";

test("VOLCAT walks the live sector menu and returns the latest matching product", async () => {
  const fetchImpl = jest.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("sector:null")) return Response.json({ sector: { name: ["Etna", "Other"] } });
    if (url.includes("image_type:null")) return Response.json({ image_type: ["Ash_RGB"] });
    return Response.json({ endtime: [{ datetime: "2026-07-13_05-10-00", filename: "data/sector_imagery/etna.png", sat: "MSG", instr: "SEVIRI" }] });
  }) as unknown as typeof fetch;
  const rows = await fetchVolcatImages(["Etna"], fetchImpl);
  expect(rows[0]).toMatchObject({ sectorId: "Etna", satellite: "MSG", instrument: "SEVIRI", product: "Ash_RGB", type: "SATELLITE" });
  expect(rows[0].imageUrl).toBe("https://volcano.ssec.wisc.edu/data/sector_imagery/etna.png");
});
