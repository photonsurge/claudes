/**
 * /crossword/:channel, from the plan (§3, §5, §5.1, §12 public): the page is
 * tokened like the weather one and refuses without the channel's token; a globe
 * channel opened here goes to /watch/<id>; the channel's theme becomes CSS
 * variables once, at the top, and nothing on the page wears the weather
 * broadcast theme or its ink tokens.
 */
import fs from "fs";
import path from "path";
import { render, screen, act } from "@testing-library/react";
import { crosswordThemeVars, type CrosswordTheme } from "@photonsurge/shared/crossword";
import { pub, HIDDEN_ANSWERS } from "../../../components/crossword/plan.fixture";

const mockReplace = jest.fn();
let mockSearch = "token=good";
jest.mock("next/navigation", () => ({
  useParams: () => ({ channel: "xw" }),
  useSearchParams: () => new URLSearchParams(mockSearch),
  useRouter: () => ({ replace: mockReplace, push: mockReplace }),
  usePathname: () => "/crossword/xw",
}));
jest.mock("../../../lib/socket-provider", () => ({ useSocket: () => ({ socket: null, connected: false }) }));
jest.mock("../../../components/audio/BroadcastBed", () => () => null);

import CrosswordRoute from "./page";

const THEME: CrosswordTheme = {
  preset: "prototype",
  brand: { title: "Grid Night", logoUrl: "" },
  colors: {
    background: "#101820",
    panel: "#fefefe",
    cell: "#f8fafc",
    cellSolved: "#eef2ff",
    block: "#0f172a",
    ink: "#0f172b",
    inkMuted: "#475569",
    accent: "#f97316",
  },
  font: { display: "Georgia, serif", text: "Verdana, sans-serif" },
};

let surface: "crossword" | "globe" = "crossword";
let fetched: string[] = [];

/** The server as the plan describes it: the token gates the scene and state routes. */
function serve() {
  fetched = [];
  global.fetch = jest.fn(async (input: string) => {
    const url = new URL(String(input), "http://x");
    fetched.push(url.pathname + url.search);
    const tokenOk = url.searchParams.get("token") === "good";
    const reply = (status: number, body: unknown = {}) => ({ ok: status < 300, status, json: async () => body });
    if (url.pathname === "/api/scenes") return reply(200, { scenes: [{ id: "xw", name: "XW", surface }] });
    if (url.pathname === "/api/scenes/xw") return tokenOk ? reply(200, {}) : reply(401, { error: "token" });
    if (url.pathname === "/api/crossword/xw/state") {
      if (surface !== "crossword") return reply(404, { error: "no such crossword scene" });
      return tokenOk ? reply(200, { ...pub(), theme: THEME }) : reply(401, { error: "token" });
    }
    return reply(404);
  }) as unknown as typeof fetch;
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });

beforeEach(() => {
  mockReplace.mockReset();
  mockSearch = "token=good";
  surface = "crossword";
  serve();
});

describe("the token gate", () => {
  it("refuses a missing token and draws no board", async () => {
    mockSearch = "";
    const { container } = render(<CrosswordRoute />);
    await flush();
    expect(container.textContent ?? "").toMatch(/token/i);
    expect(container.textContent ?? "").not.toContain("Particles");
    expect(container.textContent ?? "").not.toContain("Building block of a proton");
  });

  it("refuses a bad token and draws no board", async () => {
    mockSearch = "token=nope";
    const { container } = render(<CrosswordRoute />);
    await flush();
    expect(container.textContent ?? "").toMatch(/token/i);
    expect(container.textContent ?? "").not.toContain("Particles");
    expect(container.textContent ?? "").not.toContain("Building block of a proton");
  });

  it("draws the board for the channel's token", async () => {
    const { container } = render(<CrosswordRoute />);
    await flush();
    expect(container.textContent ?? "").toContain("Building block of a proton");
    expect(container.textContent ?? "").not.toMatch(/invalid or missing/i);
  });

  it("passes the token to the state route", async () => {
    render(<CrosswordRoute />);
    await flush();
    expect(fetched.some((u) => u.startsWith("/api/crossword/xw/state") && u.includes("token=good"))).toBe(true);
  });
});

describe("routing by surface", () => {
  it("sends a globe channel opened here to /watch/<id>", async () => {
    surface = "globe";
    render(<CrosswordRoute />);
    await flush();
    expect(mockReplace).toHaveBeenCalled();
    const target = String(mockReplace.mock.calls[0][0]);
    expect(target.startsWith("/watch/xw")).toBe(true);
    expect(target).toContain("token=good");
  });

  it("does not redirect a crossword channel", async () => {
    render(<CrosswordRoute />);
    await flush();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe("its own theme", () => {
  it("sets every theme variable once, on the page's top element", async () => {
    const { container } = render(<CrosswordRoute />);
    await flush();
    const top = container.firstElementChild as HTMLElement;
    const vars = crosswordThemeVars(THEME);
    expect(Object.keys(vars).length).toBeGreaterThan(0);
    for (const [k, v] of Object.entries(vars)) {
      expect(top.style.getPropertyValue(k)).toBe(v);
    }
    // Set once: no element below the top redefines them.
    for (const k of Object.keys(vars)) {
      const setters = Array.from(container.querySelectorAll<HTMLElement>("[style]")).filter((el) => el.style.getPropertyValue(k) !== "");
      expect(setters).toEqual([top]);
    }
  });

  it("shows the channel's brand title", async () => {
    const { container } = render(<CrosswordRoute />);
    await flush();
    expect(container.textContent ?? "").toContain("Grid Night");
  });

  it("wears no weather broadcast theme variables or ink tokens", async () => {
    const { container } = render(<CrosswordRoute />);
    await flush();
    expect(container.innerHTML).not.toMatch(/--gods-/);
  });

  it("draws no unsolved answer", async () => {
    const { container } = render(<CrosswordRoute />);
    await flush();
    for (const a of HIDDEN_ANSWERS) expect(container.textContent ?? "").not.toContain(a);
  });
});

describe("its sources", () => {
  const root = path.resolve(__dirname, "../../..");
  const files = [
    path.join(root, "app/crossword/[channel]/page.tsx"),
    ...fs
      .readdirSync(path.join(root, "components/crossword"))
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !/fixture/.test(f))
      .map((f) => path.join(root, "components/crossword", f)),
  ];

  it.each(files.map((f) => [path.relative(root, f), f]))("%s uses no weather theme, ink tokens or map libraries", (_n, f) => {
    const src = fs.readFileSync(f, "utf8");
    expect(src).not.toMatch(/broadcastTheme/);
    expect(src).not.toMatch(/--gods-/);
    expect(src).not.toMatch(/from ["'][^"']*components\/broadcast\//);
    expect(src).not.toMatch(/from ["']\.\.\/broadcast\//);
    expect(src).not.toMatch(/from ["'][^"']*(deck\.gl|@deck\.gl|maplibre|weatherlayers)/);
  });
});
