/**
 * /admin/scenes/:id for a crossword channel sends the operator to
 * /admin/crosswords/channels/:id (plan §8.2); a weather channel stays put. The
 * page's own behaviour is pinned in page.test.tsx.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import ChannelSettingsPage from "./page";

let mockParams = { id: "word-up" };
jest.mock("next/navigation", () => ({ useParams: () => mockParams }));
jest.mock("../../../../lib/channel-links", () => ({
  ...jest.requireActual("../../../../lib/channel-links"),
  replaceLocation: jest.fn(),
}));
jest.mock("../../../../lib/scenes", () => ({
  listScenes: jest.fn(async () => [
    { id: "wind", name: "Wind", surface: "globe" },
    { id: "word-up", name: "Word Up", surface: "crossword" },
  ]),
  fetchSceneState: jest.fn(async () => ({ state: DEFAULT_CONTROL_STATE, tokenError: false })),
  patchScene: jest.fn(),
  useScenePatcher: () => jest.fn(),
}));
jest.mock("../../../../lib/director", () => ({
  fetchDirectorConfig: jest.fn(async () => DEFAULT_DIRECTOR_CONFIG),
  patchDirectorConfig: jest.fn(),
  mergeConfig: (a: object, b: object) => ({ ...a, ...b }),
}));
import { replaceLocation } from "../../../../lib/channel-links";

beforeEach(() => (replaceLocation as jest.Mock).mockClear());

it("redirects a crossword channel to its own settings page", async () => {
  mockParams = { id: "word-up" };
  render(<ChannelSettingsPage />);
  await waitFor(() => expect(replaceLocation).toHaveBeenCalledWith("/admin/crosswords/channels/word-up"));
  expect(screen.getByLabelText("Opening the crossword settings")).toBeInTheDocument();
});

it("leaves a weather channel where it is", async () => {
  mockParams = { id: "wind" };
  render(<ChannelSettingsPage />);
  await screen.findByText("Channel: Wind");
  expect(replaceLocation).not.toHaveBeenCalled();
});
