import { parsePhivolcsCameras, parsePhivolcsVolcanoes } from "./phivolcs";
test("PHIVOLCS discovers volcano codes and camera images", () => {
  expect(parsePhivolcsVolcanoes('<select><option value="">Select</option><option value="mvo">Mayon</option></select>'))
    .toEqual([{ code: "mvo", name: "Mayon" }]);
  expect(parsePhivolcsCameras('<img src="/cam/mayon.jpg" alt="Ligñon Hill">', { code: "mvo", name: "Mayon" },
    "https://wovodat.phivolcs.dost.gov.ph/monitor/instruments?volcano=mvo")[0]).toMatchObject({ volcanoName: "Mayon", name: "Ligñon Hill" });
});
