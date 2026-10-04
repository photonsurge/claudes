/**
 * /watch/crossword/:scene — the gate and the routing: a bad token gets the
 * same refusal as the weather page, a globe scene is sent to /watch/:scene with
 * its query, and a crossword scene with a good token draws the board.
 */
import { render, screen, act } from "@testing-library/react";

const mockReplace = jest.fn();
let mockSearch = "token=tok";
jest.mock("next/navigation", () => ({
  useParams: () => ({ scene: "xw" }),
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock("../../../../lib/socket-provider", () => ({ useSocket: () => ({ socket: null, connected: false }) }));
jest.mock("../../../../components/audio/BroadcastBed", () => () => null);

import CrosswordWatchPage from "./page";

type Routes = Record<string, { status: number; body?: unknown }>;
const serve = (routes: Routes) => {
  global.fetch = jest.fn(async (url: string) => {
    const path = String(url).split("?")[0];
    const r = routes[path] ?? { status: 500 };
    return { ok: r.status < 300, status: r.status, json: async () => r.body ?? {} };
  }) as unknown as typeof fetch;
};

const idle = { sceneId: "xw", seq: 0, serverNow: Date.now(), phase: "idle", phaseEndsAt: 0, puzzleNo: 0, title: "", width: 0, height: 0, rows: [], entries: [], spotlight: null, scores: [], today: [], feed: [], inputLive: false, paused: false };

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

beforeEach(() => {
  mockReplace.mockReset();
  mockSearch = "token=tok";
});

describe("/watch/crossword/:scene", () => {
  it("refuses a bad token", async () => {
    mockSearch = "token=bad";
    serve({
      "/api/scenes": { status: 200, body: { scenes: [{ id: "xw", name: "XW", surface: "crossword" }] } },
      "/api/scenes/xw": { status: 401 },
      "/api/crossword/xw/state": { status: 401 },
    });
    render(<CrosswordWatchPage />);
    await flush();
    expect(screen.getByText("Invalid or missing watch token.")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects a globe scene to the weather page, keeping the token", async () => {
    mockSearch = "token=tok&obs=1";
    serve({
      "/api/scenes": { status: 200, body: { scenes: [{ id: "xw", name: "Atlantic", surface: "globe" }] } },
      "/api/scenes/xw": { status: 200, body: {} },
      "/api/crossword/xw/state": { status: 404 },
    });
    render(<CrosswordWatchPage />);
    await flush();
    expect(mockReplace).toHaveBeenCalledWith("/watch/xw?token=tok&obs=1");
  });

  it("draws the holding card for a crossword scene with no game yet", async () => {
    serve({
      "/api/scenes": { status: 200, body: { scenes: [{ id: "xw", name: "XW", surface: "crossword" }] } },
      "/api/scenes/xw": { status: 200, body: {} },
      "/api/crossword/xw/state": { status: 200, body: idle },
    });
    render(<CrosswordWatchPage />);
    await flush();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId("cw-holding")).toBeInTheDocument();
    expect(screen.getByTestId("cw-howto").textContent).toContain("DEMO ROUND");
  });
});
