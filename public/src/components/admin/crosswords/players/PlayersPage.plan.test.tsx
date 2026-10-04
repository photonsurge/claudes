/**
 * Plan §8.3 — Players over a faked API: totals per player, hide and unhide.
 */
import { configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PlayersPage from "./PlayersPage";
// MUI pages render slowly when the whole suite runs in parallel.
configure({ asyncUtilTimeout: 5000 });


const patches: { url: string; body: unknown }[] = [];

beforeEach(() => {
  patches.length = 0;
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const json = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b }) as Response;
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      patches.push({ url: decodeURIComponent(u), body });
      return json({ ok: true, hidden: body.hidden });
    }
    if (u.startsWith("/api/crossword/players"))
      return json({
        players: [
          { id: "youtube:A", name: "Ann", hidden: false, firstSeen: 1_700_000_000_000, lastSeen: 1_700_000_500_000, points: 31, words: 4 },
          { id: "youtube:B", name: "Bea", hidden: true, firstSeen: 1_700_000_000_000, lastSeen: 1_700_000_400_000, points: 17, words: 3 },
        ],
      });
    return json({ error: "nope" }, 404);
  }) as typeof fetch;
});

const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

it("lists every player with points and words", async () => {
  render(<PlayersPage />);
  await screen.findByText("Ann");
  expect(within(rowOf("Ann")).getByText("31")).toBeInTheDocument();
  expect(within(rowOf("Ann")).getByText("4")).toBeInTheDocument();
  expect(within(rowOf("Bea")).getByText("17")).toBeInTheDocument();
  expect(within(rowOf("Bea")).getByText("3")).toBeInTheDocument();
});

it("hides a player and unhides a hidden one", async () => {
  render(<PlayersPage />);
  await screen.findByText("Ann");
  fireEvent.click(within(rowOf("Ann")).getByRole("button", { name: /^hide$/i }));
  await waitFor(() => expect(patches).toHaveLength(1));
  expect(patches[0]).toEqual({ url: "/api/crossword/players/youtube:A", body: { hidden: true } });
  await waitFor(() => expect(within(rowOf("Ann")).getByRole("button", { name: /unhide/i })).toBeInTheDocument());

  fireEvent.click(within(rowOf("Bea")).getByRole("button", { name: /unhide/i }));
  await waitFor(() => expect(patches).toHaveLength(2));
  expect(patches[1]).toEqual({ url: "/api/crossword/players/youtube:B", body: { hidden: false } });
});
