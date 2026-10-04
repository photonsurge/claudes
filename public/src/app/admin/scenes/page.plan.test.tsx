/**
 * Plan §8.1 / §10 — the Channels list holds both kinds together. Written from
 * the plan: a Type chip per row, a filter by type, a type picker on New
 * channel; per row the output link (`outputPath`), Settings to the page for
 * its kind (§8.2), Control to /control or the crossword Desk (§8.3), and the
 * YouTube channel the row goes out on (`youtube.accountId`, §10).
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

const ACCOUNTS: Record<string, string> = { "puzzle-hour": "UCpuzzle", gusts: "UCweather" };

beforeEach(() => {
  jest.clearAllMocks();
  (listScenes as jest.Mock).mockResolvedValue([
    { id: "default", name: "Main" },
    { id: "gusts", name: "Gusts", surface: "globe" },
    { id: "puzzle-hour", name: "Puzzle Hour", surface: "crossword" },
    { id: "late-xw", name: "Late Crossword", surface: "crossword" },
  ]);
  (createScene as jest.Mock).mockResolvedValue({ id: "x" });
  (fetchSceneState as jest.Mock).mockImplementation(async (id: string) => ({
    state: { youtube: { accountId: ACCOUNTS[id] ?? "" } },
  }));
  (fetchYoutubeChannels as jest.Mock).mockResolvedValue([
    { id: "UCpuzzle", title: "Puzzle Hour Live", needsReconnect: false },
    { id: "UCweather", title: "Weather Live", needsReconnect: false },
  ]);
});

/** The row (Paper) carrying a channel's name. */
async function row(name: string): Promise<HTMLElement> {
  const label = await screen.findByText(name, { selector: "p" });
  return label.closest(".MuiPaper-root") as HTMLElement;
}

const controlLink = (r: HTMLElement) => within(r).getByRole("link", { name: /^(Control|Desk)$/ });
const outputLink = (r: HTMLElement) =>
  within(r).getAllByRole("link").find((a) => /^\/(watch|crossword)\//.test(a.getAttribute("href") ?? "")) as HTMLElement;

describe("Channels list (plan §8.1)", () => {
  it("chips every row Weather or Crossword; a channel with no surface is weather", async () => {
    render(<ScenesPage />);
    for (const name of ["Main", "Gusts"]) {
      const r = await row(name);
      expect(within(r).getByText("Weather")).toBeInTheDocument();
      expect(within(r).queryByText("Crossword")).not.toBeInTheDocument();
    }
    for (const name of ["Puzzle Hour", "Late Crossword"]) {
      const r = await row(name);
      expect(within(r).getByText("Crossword")).toBeInTheDocument();
    }
  });

  it("links each row's output through outputPath: /watch/<id> or /crossword/<id>", async () => {
    render(<ScenesPage />);
    expect(outputLink(await row("Gusts"))).toHaveAttribute("href", "/watch/gusts");
    expect(outputLink(await row("Main"))).toHaveAttribute("href", "/watch/default");
    expect(outputLink(await row("Puzzle Hour"))).toHaveAttribute("href", "/crossword/puzzle-hour");
    // No crossword row points at a /watch page.
    const xw = await row("Late Crossword");
    for (const a of within(xw).getAllByRole("link")) {
      expect(a.getAttribute("href") ?? "").not.toMatch(/^\/watch\//);
    }
  });

  it("sends Settings to the weather page or the crossword one by kind", async () => {
    render(<ScenesPage />);
    expect(within(await row("Gusts")).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/admin/scenes/gusts",
    );
    expect(within(await row("Puzzle Hour")).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/admin/crosswords/channels/puzzle-hour",
    );
  });

  it("sends Control to /control for weather and to the crossword Desk for a crossword", async () => {
    render(<ScenesPage />);
    expect(controlLink(await row("Main"))).toHaveAttribute("href", "/control");
    expect(controlLink(await row("Gusts"))).toHaveAttribute("href", "/control?scene=gusts");
    expect(controlLink(await row("Puzzle Hour"))).toHaveAttribute("href", "/admin/crosswords/desk/puzzle-hour");
    expect(controlLink(await row("Late Crossword"))).toHaveAttribute("href", "/admin/crosswords/desk/late-xw");
  });

  it("names the YouTube channel each row goes out on, from the channel record's youtube.accountId", async () => {
    render(<ScenesPage />);
    const xw = await row("Puzzle Hour");
    await waitFor(() => expect(within(xw).getByText("Puzzle Hour Live")).toBeInTheDocument());
    expect(within(await row("Gusts")).getByText("Weather Live")).toBeInTheDocument();
    // Each row reads its own record.
    for (const id of ["default", "gusts", "puzzle-hour", "late-xw"]) {
      expect(fetchSceneState).toHaveBeenCalledWith(id);
    }
    // A crossword row with none chosen never borrows another channel's name.
    const late = await row("Late Crossword");
    expect(within(late).queryByText("Puzzle Hour Live")).not.toBeInTheDocument();
    expect(within(late).queryByText("Weather Live")).not.toBeInTheDocument();
  });

  it("filters the list to one kind and back", async () => {
    render(<ScenesPage />);
    await row("Puzzle Hour");
    const filter = screen.getByRole("group", { name: "Channel type" });

    fireEvent.click(within(filter).getByRole("button", { name: "Crossword" }));
    expect(screen.getByText("Puzzle Hour", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Late Crossword", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByText("Gusts", { selector: "p" })).not.toBeInTheDocument();
    expect(screen.queryByText("Main", { selector: "p" })).not.toBeInTheDocument();

    fireEvent.click(within(filter).getByRole("button", { name: "Weather" }));
    expect(screen.getByText("Gusts", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Main", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByText("Puzzle Hour", { selector: "p" })).not.toBeInTheDocument();

    fireEvent.click(within(filter).getByRole("button", { name: "All" }));
    expect(screen.getByText("Puzzle Hour", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("Gusts", { selector: "p" })).toBeInTheDocument();
  });

  it("offers both kinds in the New channel type picker and creates the picked one", async () => {
    render(<ScenesPage />);
    await row("Gusts");
    fireEvent.change(screen.getByLabelText("New channel name"), { target: { value: "Cryptic" } });
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /type/i }));
    const options = within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(["Weather", "Crossword"]));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Crossword" }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(createScene).toHaveBeenCalledWith("Cryptic", expect.anything(), "crossword"));
  });
});
