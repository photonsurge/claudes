/**
 * The Channels list's YouTube column against docs/crossword-mode-plan.md
 * §8.1 and §10 and the batch's intent: the scene list itself carries each
 * channel's `youtubeAccountId`, so every row names its YouTube channel from
 * the one list call, with no read per channel.
 */
import { render, screen } from "@testing-library/react";
import ScenesPage from "./page";

jest.mock("../../../lib/scenes", () => ({
  listScenes: jest.fn(),
  createScene: jest.fn(),
  deleteScene: jest.fn(),
  fetchSceneState: jest.fn(),
}));
jest.mock("../../../components/admin/crosswords/channels/client", () => ({ fetchYoutubeChannels: jest.fn() }));
import { fetchSceneState, listScenes } from "../../../lib/scenes";
import { fetchYoutubeChannels } from "../../../components/admin/crosswords/channels/client";

beforeEach(() => {
  jest.clearAllMocks();
  (listScenes as jest.Mock).mockResolvedValue([
    { id: "default", name: "Main" },
    { id: "puzzle-hour", name: "Puzzle Hour", surface: "crossword", youtubeAccountId: "UCpuzzle" },
    { id: "late-xw", name: "Late Crossword", surface: "crossword" },
  ]);
  (fetchSceneState as jest.Mock).mockRejectedValue(new Error("not expected"));
  (fetchYoutubeChannels as jest.Mock).mockResolvedValue([{ id: "UCpuzzle", title: "Puzzle Hour Live", needsReconnect: false }]);
});

it("names each row's YouTube channel from the list's youtubeAccountId, with no per-channel read", async () => {
  render(<ScenesPage />);
  expect(await screen.findByTestId("youtube-puzzle-hour")).toHaveTextContent("Puzzle Hour Live");
  expect(screen.getByTestId("youtube-late-xw")).not.toHaveTextContent("Puzzle Hour Live");
  expect(fetchSceneState).not.toHaveBeenCalled();
});
