/**
 * Plan §8.2 — a crossword channel's settings live on
 * /admin/crosswords/channels/:id; the route hands its id to the settings page.
 */
jest.mock("../../../../../components/admin/crosswords/channels/ChannelSettingsPage", () => ({
  __esModule: true,
  default: () => null,
}));
import ChannelSettingsPage from "../../../../../components/admin/crosswords/channels/ChannelSettingsPage";
import Page from "./page";

it("renders the crossword settings page for the channel in the URL", async () => {
  const el = await Page({ params: Promise.resolve({ id: "puzzle-hour" }) });
  expect(el.type).toBe(ChannelSettingsPage);
  expect(el.props.sceneId).toBe("puzzle-hour");
});
