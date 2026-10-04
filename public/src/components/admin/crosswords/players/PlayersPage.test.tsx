/** PlayersPage — over a faked API: totals per player, hide and unhide. */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import PlayersPage from "./PlayersPage";

const patches: { url: string; body: unknown }[] = [];

beforeEach(() => {
  patches.length = 0;
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;
    if (u === "/api/crossword/players")
      return json({
        players: [
          { id: "youtube:abc", name: "Ann", hidden: false, firstSeen: 1, lastSeen: 5, points: 4, words: 1 },
          { id: "sim:rich", name: "rich", hidden: true, firstSeen: 1, lastSeen: 9, points: 30, words: 6 },
        ],
      });
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      patches.push({ url: u, body });
      return json({ ok: true, hidden: body.hidden });
    }
    return json({ error: "nope" }, 404);
  }) as typeof fetch;
});

it("lists players by points with their totals", async () => {
  render(<PlayersPage />);
  await screen.findByText("Ann");
  const rows = screen.getAllByRole("row").slice(1);
  expect(within(rows[0]).getByText("rich")).toBeInTheDocument();
  expect(within(rows[0]).getByText("30")).toBeInTheDocument();
  expect(within(rows[0]).getByText("hidden")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Ann")).toBeInTheDocument();
});

it("hides and unhides", async () => {
  render(<PlayersPage />);
  const ann = (await screen.findByText("Ann")).closest("tr")!;
  await act(async () => {
    fireEvent.click(within(ann).getByRole("button", { name: "Hide" }));
  });
  expect(patches[0]).toEqual({ url: "/api/crossword/players/youtube%3Aabc", body: { hidden: true } });
  expect(within(ann).getByRole("button", { name: "Unhide" })).toBeInTheDocument();

  const rich = screen.getByText("rich").closest("tr")!;
  await act(async () => {
    fireEvent.click(within(rich).getByRole("button", { name: "Unhide" }));
  });
  expect(patches[1]).toEqual({ url: "/api/crossword/players/sim%3Arich", body: { hidden: false } });
});

it("filters by search", async () => {
  render(<PlayersPage />);
  await screen.findByText("Ann");
  fireEvent.change(screen.getByLabelText("Search"), { target: { value: "ann" } });
  expect(screen.queryByText("rich")).not.toBeInTheDocument();
});
