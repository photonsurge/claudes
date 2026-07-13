import { parseMagmaCameras } from "./magma";
test("MAGMA classifies IR cameras", () => {
  const rows = parseMagmaCameras('<article><h3>View Anak Krakatau - Sertung Selatan (IR Camera)</h3><img src="/cctv/ak.jpg"></article>');
  expect(rows[0]).toMatchObject({ volcanoName: "Anak Krakatau", mode: "IR" });
});
