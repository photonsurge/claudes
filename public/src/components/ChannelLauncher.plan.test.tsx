/**
 * Plan §8.1 — the home launcher (operator face): output links come from
 * `outputPath`; a crossword card shows the puzzle and its progress
 * ("Puzzle 42 · 7 of 14") where a weather card shows now/next, with Desk /
 * Output / Settings links.
 */
import { render, screen, within } from "@testing-library/react";
import ChannelLauncher from "./ChannelLauncher";

jest.mock("../lib/scenes", () => ({ listScenes: jest.fn() }));
jest.mock("../lib/director", () => ({ useDirector: jest.fn(() => null), skipToNextShot: jest.fn() }));
jest.mock("../lib/stream", () => ({ usePublicLiveRuns: jest.fn(() => ({})) }));
import { listScenes } from "../lib/scenes";

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

/** 14 entries, 7 solved. */
const state = {
  puzzleNo: 42,
  entries: Array.from({ length: 14 }, (_, i) => (i < 7 ? { id: `${i}A`, solved: { name: "Ann", points: 1 } } : { id: `${i}A` })),
};

beforeEach(() => {
  (listScenes as jest.Mock).mockResolvedValue([
    { id: "gusts", name: "Gusts" },
    { id: "puzzle-hour", name: "Puzzle Hour", surface: "crossword" },
  ]);
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => state })) as unknown as typeof fetch;
});

/** A card is the nearest ancestor holding links. */
const cardOf = async (name: string) => {
  let el: HTMLElement | null = await screen.findByText(name);
  while (el && within(el).queryAllByRole("link").length === 0) el = el.parentElement;
  return el as HTMLElement;
};

it("links each card's output through outputPath", async () => {
  render(<ChannelLauncher />);
  expect(within(await cardOf("Gusts")).getByRole("link", { name: /Output/ })).toHaveAttribute("href", "/watch/gusts");
  expect(within(await cardOf("Puzzle Hour")).getByRole("link", { name: /Output/ })).toHaveAttribute(
    "href",
    "/crossword/puzzle-hour",
  );
});

it("shows 'Puzzle N · X of Y' on a crossword card, with Desk and the crossword Settings", async () => {
  render(<ChannelLauncher />);
  const card = await cardOf("Puzzle Hour");
  expect(await within(card).findByText(/Puzzle 42 · 7 of 14/)).toBeInTheDocument();
  expect(within(card).getByRole("link", { name: "Desk" })).toHaveAttribute("href", "/admin/crosswords/desk/puzzle-hour");
  expect(within(card).getByRole("link", { name: "Settings" })).toHaveAttribute(
    "href",
    "/admin/crosswords/channels/puzzle-hour",
  );
  // The weather card has no puzzle line and keeps Control.
  const gusts = await cardOf("Gusts");
  expect(within(gusts).queryByText(/Puzzle \d+/)).not.toBeInTheDocument();
  expect(within(gusts).getByRole("link", { name: "Control" })).toHaveAttribute("href", "/control?scene=gusts");
});
