/**
 * /admin/scenes — the Channels list, both kinds together (plan §8.1): a Type
 * chip per row, a filter by type, a type picker on the New channel form, Output
 * links built with `outputPath`, and Control going to /control for weather and
 * to the Desk for a crossword.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ScenesPage from "./page";

jest.mock("../../../lib/scenes", () => ({
  listScenes: jest.fn(),
  createScene: jest.fn(),
  deleteScene: jest.fn(),
  fetchSceneState: jest.fn(),
}));
jest.mock("../../../components/admin/crosswords/channels/client", () => ({
  fetchYoutubeChannels: jest.fn(),
}));
import { createScene, fetchSceneState, listScenes } from "../../../lib/scenes";
import { fetchYoutubeChannels } from "../../../components/admin/crosswords/channels/client";

const mockList = listScenes as jest.Mock;
const mockCreate = createScene as jest.Mock;

beforeEach(() => {
  mockList.mockReset().mockResolvedValue([
    { id: "default", name: "Main" },
    { id: "wind", name: "Atlantic Wind", surface: "globe" },
    { id: "word-up", name: "Word Up", surface: "crossword" },
  ]);
  mockCreate.mockReset().mockResolvedValue({ id: "new" });
  // Each channel's own record says which YouTube channel it goes out on.
  (fetchSceneState as jest.Mock).mockReset().mockImplementation(async (id: string) => ({
    state: { youtube: { accountId: id === "word-up" ? "UCword" : "" } },
  }));
  (fetchYoutubeChannels as jest.Mock).mockReset().mockResolvedValue([
    { id: "UCword", title: "Word Up TV", needsReconnect: false },
  ]);
});

/** The row (Paper) that carries a channel's name. */
const rowOf = async (name: string) => (await screen.findByText(name, { selector: "p" })).closest(".MuiPaper-root") as HTMLElement;

describe("Channels list", () => {
  it("chips each row with its type", async () => {
    render(<ScenesPage />);
    expect(within(await rowOf("Atlantic Wind")).getByText("Weather")).toBeInTheDocument();
    expect(within(await rowOf("Main")).getByText("Weather")).toBeInTheDocument();
    expect(within(await rowOf("Word Up")).getByText("Crossword")).toBeInTheDocument();
  });

  it("builds Watch with outputPath and Control by type", async () => {
    render(<ScenesPage />);
    const wind = await rowOf("Atlantic Wind");
    expect(within(wind).getByRole("link", { name: "Output ↗" })).toHaveAttribute("href", "/watch/wind");
    expect(within(wind).getByRole("link", { name: "Control" })).toHaveAttribute("href", "/control?scene=wind");
    expect(within(wind).getByText(/\/watch\/wind$/)).toBeInTheDocument();

    const xw = await rowOf("Word Up");
    expect(within(xw).getByRole("link", { name: "Output ↗" })).toHaveAttribute("href", "/crossword/word-up");
    expect(within(xw).getByRole("link", { name: "Desk" })).toHaveAttribute("href", "/admin/crosswords/desk/word-up");
    expect(within(xw).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/admin/crosswords/channels/word-up");

    const main = await rowOf("Main");
    expect(within(main).getByRole("link", { name: "Control" })).toHaveAttribute("href", "/control");
  });

  it("sends Settings to the page for the channel's kind", async () => {
    render(<ScenesPage />);
    const wind = await rowOf("Atlantic Wind");
    expect(within(wind).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/admin/scenes/wind");
  });

  it("names the YouTube channel each row goes out on", async () => {
    render(<ScenesPage />);
    await rowOf("Word Up");
    await waitFor(() => expect(screen.getByTestId("youtube-word-up")).toHaveTextContent("Word Up TV"));
    // No channel chosen: "none" for a crossword channel, the default for a weather one.
    (fetchSceneState as jest.Mock).mockImplementation(async () => ({ state: { youtube: { accountId: "" } } }));
    render(<ScenesPage />);
    await waitFor(() => expect(screen.getAllByTestId("youtube-word-up").some((e) => e.textContent === "none")).toBe(true));
    expect(screen.getAllByTestId("youtube-wind")[1]).toHaveTextContent("default channel");
  });

  it("filters the list by type", async () => {
    render(<ScenesPage />);
    await screen.findByText("Word Up");

    fireEvent.click(screen.getByRole("button", { name: "Crossword" }));
    expect(screen.getByText("Word Up")).toBeInTheDocument();
    expect(screen.queryByText("Atlantic Wind")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Weather" }));
    expect(screen.queryByText("Word Up")).not.toBeInTheDocument();
    expect(screen.getByText("Atlantic Wind")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Word Up")).toBeInTheDocument();
  });

  it("creates a channel of the picked type", async () => {
    render(<ScenesPage />);
    await screen.findByText("Word Up");

    fireEvent.change(screen.getByLabelText("New channel name"), { target: { value: "Clue Time" } });
    // MUI select: open it, pick the option.
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "type" }));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Crossword" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith("Clue Time", "default", "crossword"));
  });

  it("creates a weather channel by default", async () => {
    render(<ScenesPage />);
    await screen.findByText("Word Up");
    fireEvent.change(screen.getByLabelText("New channel name"), { target: { value: "Gusts" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith("Gusts", "default", "globe"));
  });
});
