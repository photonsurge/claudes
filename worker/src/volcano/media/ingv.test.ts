import { discoverIngvIframes, parseIngvCameraDocument } from "./ingv";
test("INGV discovers iframe camera documents and classifies their images", () => {
  expect(discoverIngvIframes('<iframe src="/cams/etna.html"></iframe>', "https://www.ct.ingv.it/page"))
    .toEqual(["https://www.ct.ingv.it/cams/etna.html"]);
  expect(parseIngvCameraDocument('<img src = "etna-thermal.jpg" alt="Etna thermal">', "https://cams.ingv.it/view/", "Etna")[0])
    .toMatchObject({ volcanoName: "Etna", mode: "THERMAL", imageUrl: "https://cams.ingv.it/view/etna-thermal.jpg" });
});

test("INGV collapses archive frames to the newest image per stable station", () => {
  const rows = parseIngvCameraDocument(`
    <img src="../../Dati/webcams/Epvh/20260713/0500/Epvh0118.jpg">
    <img src="../../Dati/webcams/Epvh/20260713/0500/Epvh0119.jpg">
    <img src="../../Dati/webcams/Emct/20260713/0500/Emct0119.jpg">
  `, "https://www.ct.ingv.it/cams/etna/index.html", "Etna");
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ sourceCameraId: "epvh", name: "Etna · Epvh", observedAt: "2026-07-13T05:00:00+02:00" });
  expect(rows[0].imageUrl).toBe("https://www.ct.ingv.it/Dati/webcams/Epvh/20260713/0500/Epvh0119.jpg");
});
