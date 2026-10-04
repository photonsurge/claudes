/**
 * The crossword channel's settings page (plan §8.2): cards in groups, one Save
 * bar, nothing written until Save. Look and Game save to the crossword config;
 * the music bed and the YouTube channel save to the channel record.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { DEFAULT_CROSSWORD_CONFIG } from "@photonsurge/shared/crossword";
import ChannelSettingsPage from "./ChannelSettingsPage";

jest.mock("../../../../lib/scenes", () => ({
  listScenes: jest.fn(async () => [{ id: "xw", name: "Word Up", surface: "crossword" }]),
  fetchSceneState: jest.fn(async () => ({ state: DEFAULT_CONTROL_STATE, tokenError: false, ok: true })),
  patchScene: jest.fn(async () => ({ ok: true })),
  emitScenePatch: jest.fn(),
}));
jest.mock("./client", () => ({
  fetchCrosswordConfig: jest.fn(),
  patchCrosswordConfig: jest.fn(),
  fetchYoutubeChannels: jest.fn(),
}));
import { emitScenePatch, patchScene } from "../../../../lib/scenes";
import { fetchCrosswordConfig, fetchYoutubeChannels, patchCrosswordConfig } from "./client";

beforeEach(() => {
  jest.clearAllMocks();
  (fetchCrosswordConfig as jest.Mock).mockResolvedValue(DEFAULT_CROSSWORD_CONFIG);
  (patchCrosswordConfig as jest.Mock).mockImplementation(async (_id: string, p: object) => ({
    ...DEFAULT_CROSSWORD_CONFIG,
    ...p,
  }));
  (fetchYoutubeChannels as jest.Mock).mockResolvedValue([
    { id: "UC1", title: "Word Up TV", needsReconnect: false },
    { id: "UC2", title: "Old Channel", needsReconnect: true },
  ]);
  window.history.replaceState(null, "", "/admin/crosswords/channels/xw");
});

const group = (name: string) => fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));

it("shows the Look group first, with a live preview of the brand", async () => {
  render(<ChannelSettingsPage sceneId="xw" />);
  const title = await screen.findByLabelText("Brand title");
  expect(screen.getByTestId("theme-preview")).toHaveTextContent("Crossword");
  fireEvent.change(title, { target: { value: "Word Up" } });
  expect(screen.getByTestId("theme-preview")).toHaveTextContent("Word Up");
  expect(screen.getByText(/1 unsaved change/)).toBeInTheDocument();
  expect(patchCrosswordConfig).not.toHaveBeenCalled();
});

it("stages both documents and saves each once", async () => {
  render(<ChannelSettingsPage sceneId="xw" />);
  fireEvent.change(await screen.findByLabelText("Brand title"), { target: { value: "Word Up" } });
  fireEvent.click(screen.getByLabelText("Mute"));

  group("Game");
  const clue = await screen.findByLabelText("Clue time");
  fireEvent.change(clue, { target: { value: "90" } });
  fireEvent.blur(clue);

  group("YouTube");
  const pick = await screen.findByRole("combobox", { name: "Goes out on" });
  await waitFor(() => expect(pick).not.toHaveAttribute("aria-disabled", "true"));
  fireEvent.mouseDown(pick);
  const list = within(await screen.findByRole("listbox"));
  expect(list.getByRole("option", { name: /Old Channel — needs reconnect/ })).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(list.getByRole("option", { name: "Word Up TV" }));

  expect(screen.getByText(/4 unsaved changes/)).toBeInTheDocument();
  expect(patchScene).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(patchCrosswordConfig).toHaveBeenCalledTimes(1));
  const [id, game] = (patchCrosswordConfig as jest.Mock).mock.calls[0];
  expect(id).toBe("xw");
  expect(game.clueS).toBe(90);
  expect(game.theme.brand.title).toBe("Word Up");

  await waitFor(() => expect(patchScene).toHaveBeenCalledTimes(1));
  const [sceneId, record] = (patchScene as jest.Mock).mock.calls[0];
  expect(sceneId).toBe("xw");
  expect(record.audio.muted).toBe(true);
  expect(record.youtube.accountId).toBe("UC1");
  expect(emitScenePatch).toHaveBeenCalled();

  await waitFor(() => expect(screen.queryByText(/unsaved change/)).not.toBeInTheDocument());
}, 20000);

it("keeps the draft when a write fails", async () => {
  (patchCrosswordConfig as jest.Mock).mockRejectedValue(new Error("nope"));
  render(<ChannelSettingsPage sceneId="xw" />);
  fireEvent.change(await screen.findByLabelText("Brand title"), { target: { value: "X" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText(/Save failed/)).toHaveTextContent("nope");
  expect(screen.getByLabelText("Brand title")).toHaveValue("X");
});

it("explains the missing YouTube channel and refuses nothing silently", async () => {
  (fetchYoutubeChannels as jest.Mock).mockResolvedValue([]);
  render(<ChannelSettingsPage sceneId="xw" />);
  await screen.findByLabelText("Brand title");
  group("YouTube");
  expect(await screen.findByText(/No YouTube channel is connected/)).toBeInTheDocument();
});
