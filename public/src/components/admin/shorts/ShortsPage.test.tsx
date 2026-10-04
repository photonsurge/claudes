/**
 * ShortsPage — wiring over a faked /api/shorts: loads and selects the newest
 * script, shows its clips, previews (play → list refresh), and polls only
 * while a preview is in progress.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ShortsPage from "./ShortsPage";
import { SHORTS_POLL_MS, type ShortsListResponse } from "../../../lib/shorts";

const script = {
  id: "s1",
  template: "lineup",
  scope: { type: "globe" },
  include: { alerts: false, quakes: false, volcanoes: false },
  title: "World round-up",
  status: "draft",
  clips: [{ id: "a", target: "global:roundup", durationMs: 60_000, label: { title: "World round-up spin" } }],
};

let list: ShortsListResponse;
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  list = {
    scripts: [{ id: "s1", title: "World round-up", scope: { type: "globe" }, status: "draft", clipCount: 1, durationMs: 60_000 }],
    preview: { sceneId: "shorts-preview", exists: true, watchToken: "tok", mode: "off" },
  };
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method ?? "GET"} ${u}`);
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
    if (u === "/api/shorts") return json(list);
    if (u === "/api/shorts/s1/play") {
      list = { ...list, preview: { ...list.preview, mode: "script", scriptId: "s1", playNonce: 9 } };
      return json({ ok: true, playNonce: 9 });
    }
    if (u === "/api/shorts/s1") return json(script);
    return { ok: false, status: 404, json: async () => ({ error: "nope" }) } as Response;
  }) as typeof fetch;
});

afterEach(() => jest.useRealTimers());

it("selects the newest script and lists its clips", async () => {
  render(<ShortsPage />);
  expect(await screen.findByText("World round-up spin")).toBeInTheDocument();
  expect(screen.getByTitle("Short preview")).toHaveAttribute("src", "/watch/shorts-preview?token=tok");
});

it("previews a script, then polls while it plays", async () => {
  jest.useFakeTimers();
  render(<ShortsPage />);
  await act(async () => {
    await jest.runOnlyPendingTimersAsync();
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "Play" })).toBeEnabled());

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
  });
  await waitFor(() => expect(screen.getByText("starting…")).toBeInTheDocument());
  expect(calls).toContain("POST /api/shorts/s1/play");

  const before = calls.filter((c) => c === "GET /api/shorts").length;
  await act(async () => {
    await jest.advanceTimersByTimeAsync(SHORTS_POLL_MS * 2);
  });
  expect(calls.filter((c) => c === "GET /api/shorts").length).toBeGreaterThan(before);
});

it("doesn't poll while nothing is playing", async () => {
  jest.useFakeTimers();
  render(<ShortsPage />);
  await act(async () => {
    await jest.runOnlyPendingTimersAsync();
  });
  const before = calls.filter((c) => c === "GET /api/shorts").length;
  await act(async () => {
    await jest.advanceTimersByTimeAsync(SHORTS_POLL_MS * 3);
  });
  expect(calls.filter((c) => c === "GET /api/shorts").length).toBe(before);
});
