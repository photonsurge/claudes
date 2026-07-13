import { discoverJmaCameraPages, parseJmaCameraPage } from "./jma";
test("JMA discovers camera ids and timestamped images from detail pages", () => { const page = discoverJmaCameraPages('<a href="volcam.php?VC=50601">Sakurajima (Kurokami)</a>')[0]; expect(page.id).toBe("50601");
  expect(parseJmaCameraPage('<img src="/vois/data/obs/camera/506_x/20260713141800.jpg">', page)).toMatchObject({ sourceCameraId: "50601", volcanoName: "Sakurajima", imageUrl: "https://www.data.jma.go.jp/vois/data/obs/camera/506_x/20260713141800.jpg" }); });
