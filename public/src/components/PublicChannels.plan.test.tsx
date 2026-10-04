/**
 * Plan §8.1 — the public home card for a crossword channel shows the same
 * "Puzzle N · X of Y" line as the launcher, and no operator links.
 */
import { render, screen, within } from "@testing-library/react";
import PublicChannels from "./PublicChannels";

jest.mock("../lib/scenes", () => ({ listScenes: jest.fn() }));
jest.mock("../lib/director", () => ({ useDirector: jest.fn(() => null), skipToNextShot: jest.fn() }));
jest.mock("../lib/stream", () => ({ usePublicLiveRuns: jest.fn(() => ({})) }));
import { listScenes } from "../lib/scenes";

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

it("shows the puzzle line on a crossword card, with no Desk, Output or Settings link", async () => {
  (listScenes as jest.Mock).mockResolvedValue([
    { id: "gusts", name: "Gusts" },
    { id: "puzzle-hour", name: "Puzzle Hour", surface: "crossword" },
  ]);
  const state = { puzzleNo: 7, entries: [{ id: "1A", solved: { name: "A", points: 1 } }, { id: "2D" }, { id: "3A" }] };
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => state })) as unknown as typeof fetch;

  render(<PublicChannels />);
  const card = await screen.findByRole("article", { name: "Puzzle Hour" });
  expect(await within(card).findByText(/Puzzle 7 · 1 of 3/)).toBeInTheDocument();
  expect(within(card).queryByRole("link")).not.toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: "Gusts" })).queryByText(/Puzzle \d+/)).not.toBeInTheDocument();
});

it("renders the crossword card without a line when the state can't be read", async () => {
  (listScenes as jest.Mock).mockResolvedValue([{ id: "puzzle-hour", name: "Puzzle Hour", surface: "crossword" }]);
  global.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })) as unknown as typeof fetch;
  render(<PublicChannels />);
  const card = await screen.findByRole("article", { name: "Puzzle Hour" });
  expect(within(card).queryByText(/Puzzle \d+/)).not.toBeInTheDocument();
  expect(within(card).getByText(/OFF AIR/)).toBeInTheDocument();
});
