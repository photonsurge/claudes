import { discoverGvpImageDetails, parseGvpImageDetail } from "./gvpImages";
test("GVP discovers image details and maps item rights", () => {
  expect(discoverGvpImageDetails('<a href="/gallery/ShowImage.cfm?photo=GVP-1">x</a>', "https://volcano.si.edu/volcano.cfm?vn=1"))
    .toEqual(["https://volcano.si.edu/gallery/ShowImage.cfm?photo=GVP-1"]);
  expect(parseGvpImageDetail('<h1>Eruption</h1><img src="/img/a.jpg"> Credit: Jane Public Domain',
    "https://volcano.si.edu/gallery/ShowImage.cfm?photo=GVP-1")).toMatchObject({ sourceMediaId: "GVP-1", reuseAllowed: true });
});
