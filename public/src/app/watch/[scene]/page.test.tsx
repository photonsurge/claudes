/**
 * /watch/:scene — only the crossword hand-off is pinned here: a crossword
 * scene opened on the weather page is sent to /watch/crossword/:scene with its
 * query, and a globe scene stays and draws the globe surface. The globe, the
 * director and the data hooks are stubbed; each has its own suite.
 */
import { render, screen, act } from "@testing-library/react";

const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
  useParams: () => ({ scene: "atlantic" }),
  useSearchParams: () => new URLSearchParams("token=tok"),
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock("../../../lib/socket-provider", () => ({ useSocket: () => ({ socket: null, connected: false }) }));
jest.mock("../../../components/WatchSurface", () => () => <div data-testid="watch-surface" />);
jest.mock("../../../components/ViewingOverlay", () => () => null);
jest.mock("../../../lib/viewer", () => ({ useViewerState: () => null }));
jest.mock("../../../lib/useRegionCities", () => ({ useRegionCities: (c: unknown) => c }));
jest.mock("../../../lib/manifest", () => ({ MANIFEST_POLL_MS: 60_000, fetchManifest: async () => null, pickManifest: (_p: unknown, m: unknown) => m }));
jest.mock("../../../lib/cities", () => ({ listCities: async () => [] }));
jest.mock("../../../lib/director", () => ({
  cutMapTypeIds: () => [],
  useDirector: () => null,
  useDirectorConfig: () => ({ config: { activeSlideId: {}, kindSlides: {}, alertCycleSeconds: 10 } }),
  useDirectorCut: () => ({ patch: null, segment: null, focus: null }),
  useEventPulse: () => null,
  activeCountryIso: () => null,
  activeRegionBbox: () => null,
}));

import SceneWatchPage from "./page";

const serveScenes = (surface: string) => {
  global.fetch = jest.fn(async (url: string) => {
    const path = String(url).split("?")[0];
    if (path === "/api/scenes") {
      return { ok: true, status: 200, json: async () => ({ scenes: [{ id: "atlantic", name: "Atlantic", surface }] }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }) as unknown as typeof fetch;
};

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

beforeEach(() => mockReplace.mockReset());

describe("/watch/:scene surface hand-off", () => {
  it("sends a crossword scene to its own page with the token", async () => {
    serveScenes("crossword");
    render(<SceneWatchPage />);
    await flush();
    expect(mockReplace).toHaveBeenCalledWith("/watch/crossword/atlantic?token=tok");
    expect(screen.queryByTestId("watch-surface")).toBeNull();
  });

  it("keeps a globe scene and draws the globe surface", async () => {
    serveScenes("globe");
    render(<SceneWatchPage />);
    await flush();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByTestId("watch-surface")).toBeInTheDocument();
  });
});
