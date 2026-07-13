import { discoverIngvIframes, parseIngvCameraDocument } from "./ingv";
test("INGV discovers iframe camera documents and classifies their images", () => {
  expect(discoverIngvIframes('<iframe src="/cams/etna.html"></iframe>', "https://www.ct.ingv.it/page"))
    .toEqual(["https://www.ct.ingv.it/cams/etna.html"]);
  expect(parseIngvCameraDocument('<img src = "etna-thermal.jpg" alt="Etna thermal">', "https://cams.ingv.it/view/", "Etna")[0])
    .toMatchObject({ volcanoName: "Etna", mode: "THERMAL", imageUrl: "https://cams.ingv.it/view/etna-thermal.jpg" });
});
