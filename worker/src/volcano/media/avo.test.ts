import { parseAvoCameraDetail, parseAvoCameraIndex } from "./avo";

describe("AVO webcam adapter", () => {
  it("discovers cameras under volcano headings and classifies modes", () => {
    const rows = parseAvoCameraIndex(`
      <h2>Great Sitkin</h2>
      <a href="view/1054">Great Sitkin Vis [GSCK] Jul 12, 2026 20:40:00 AKDT 2026-07-13 04:40:00 UTC</a>
      <a href="/webcam/view/1055">Great Sitkin IR [GSIR] Jul 12, 2026 20:41:00 AKDT 2026-07-13 04:41:00 UTC</a>
    `);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sourceCameraId: "1054", volcanoName: "Great Sitkin", mode: "VISIBLE" });
    expect(rows[1].mode).toBe("IR");
  });

  it("discovers still/video URLs and camera geometry from a detail page", () => {
    const entry = parseAvoCameraIndex('<h2>Spurr</h2><a href="/webcam/view/1054">Spurr Lowlight Cam</a>')[0];
    const detail = parseAvoCameraDetail(entry, `
      <h1>Spurr</h1><a href="/webcam/image/1054.jpg">Image</a>
      Last Image: 2026-07-13 05:00:00 UTC
      Latitude: 61.2002 Longitude: -152.2085 Bearing: 342°
      <a href="/webcam/video/1054.mp4">Download Video</a>
    `);
    expect(detail).toMatchObject({ latitude: 61.2002, longitude: -152.2085, bearing: 342 });
    expect(detail.currentImageUrl).toBe("https://avo.alaska.edu/webcam/image/1054.jpg");
    expect(detail.video12hUrl).toBe("https://avo.alaska.edu/webcam/video/1054.mp4");
  });
});
