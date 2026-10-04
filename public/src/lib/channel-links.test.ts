import { consoleHref, crosswordSettingsHref, settingsHref, settingsHrefFor } from "./channel-links";

it("sends each kind of channel to its own console and settings page", () => {
  expect(consoleHref({ id: "default" })).toBe("/control");
  expect(consoleHref({ id: "wind", surface: "globe" })).toBe("/control?scene=wind");
  expect(consoleHref({ id: "xw", surface: "crossword" })).toBe("/admin/crosswords/desk/xw");
  expect(settingsHrefFor({ id: "wind" })).toBe(settingsHref("wind"));
  expect(settingsHrefFor({ id: "xw", surface: "crossword" })).toBe(crosswordSettingsHref("xw"));
  expect(crosswordSettingsHref("xw")).toBe("/admin/crosswords/channels/xw");
});
