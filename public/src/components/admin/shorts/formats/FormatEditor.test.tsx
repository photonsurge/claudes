/**
 * /admin/shorts/formats/:id — the format editor end to end over mocked APIs:
 * its own card list (Video first), ONE Save for the look, the director config
 * and the short settings, the title preview against the format's most recent
 * script, Play sample (play the latest script, or generate one first) and
 * Copy look from… (confirm, then a fresh draft).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_CONTROL_STATE } from "@photonsurge/shared/control";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import { defaultShortFormat, type ShortFormat } from "@photonsurge/shared/short-format";
import type { ShortsListResponse } from "../../../../lib/shorts";
import FormatEditor from "./FormatEditor";

// The channel cards a format shares are covered by their own tests; stubbed
// here by anchor id (they're slow to render and this file is about the editor).
jest.mock("../../scenes/ThemeSettings", () => ({ __esModule: true, default: () => <div data-testid="theme" /> }));
jest.mock("../../scenes/CameraSettings", () => ({ __esModule: true, default: () => <div data-testid="camera" /> }));
jest.mock("../../scenes/AudioSettings", () => ({ __esModule: true, default: () => <div data-testid="audio" /> }));
jest.mock("../../scenes/PaceSettings", () => ({ __esModule: true, default: () => <div data-testid="pace" /> }));
jest.mock("../../scenes/ChannelSettings", () => ({ __esModule: true, default: () => <div data-testid="widgets" /> }));
jest.mock("../../scenes/ReportSettings", () => ({ __esModule: true, default: () => <div data-testid="report" /> }));
jest.mock("../../scenes/SlidesSettings", () => ({ __esModule: true, default: () => <div data-testid="deck" /> }));
jest.mock("../../scenes/TickerSettings", () => ({ __esModule: true, default: () => <div data-testid="crawl" /> }));
jest.mock("../../scenes/AboutCardSettings", () => ({ __esModule: true, default: () => <div data-testid="about" /> }));

// A whole settings page per test: generous under a parallel ./test run. The
// page has ~80 code chips (all buttons), so whole-page role queries are slow:
// buttons are found by their text here.
jest.setTimeout(30_000);

const fetchSceneState = jest.fn(async () => ({ state: DEFAULT_CONTROL_STATE, tokenError: false, ok: true }));
const patchScene = jest.fn(async () => ({ ok: true }));
jest.mock("../../../../lib/scenes", () => ({
  fetchSceneState: (...a: unknown[]) => fetchSceneState(...(a as [])),
  patchScene: (...a: unknown[]) => patchScene(...(a as [])),
  emitScenePatch: jest.fn(),
  listScenes: jest.fn(async () => []),
}));
const patchDirectorConfig = jest.fn(async () => ({}));
jest.mock("../../../../lib/director", () => ({
  fetchDirectorConfig: jest.fn(async () => DEFAULT_DIRECTOR_CONFIG),
  patchDirectorConfig: (...a: unknown[]) => patchDirectorConfig(...(a as [])),
  mergeConfig: (prev: object, patch: object) => ({ ...prev, ...patch }),
}));

let stored: ShortFormat;
const saveShortFormat = jest.fn(async (id: string, patch: Partial<ShortFormat>) => {
  stored = { ...stored, ...patch, id };
  return stored;
});
const copyFormatLook = jest.fn(async () => ({ ok: true as const, data: { format: stored } }));
jest.mock("../../../../lib/short-formats", () => ({
  ...jest.requireActual("../../../../lib/short-formats"),
  getShortFormat: jest.fn(async () => ({ ok: true, data: stored })),
  saveShortFormat: (...a: unknown[]) => saveShortFormat(...(a as [string, Partial<ShortFormat>])),
  fetchRenderOptions: jest.fn(async () => ({ encoders: [], accounts: [] })),
  loadFormatSources: jest.fn(async () => ({ channels: [{ id: "wind", name: "Atlantic Wind" }], formats: [] })),
  copyFormatLook: (...a: unknown[]) => copyFormatLook(...(a as [])),
}));

let list: ShortsListResponse;
const generateShort = jest.fn(async () => ({ ok: true as const, data: { id: "new", title: "World", clips: 3, durationMs: 60_000 } }));
const playShortPreview = jest.fn(async () => ({ ok: true as const, data: { ok: true as const, playNonce: 1, sceneId: "short-eu" } }));
const getShort = jest.fn(async (id: string) => ({
  ok: true as const,
  data: { id, formatId: "short-eu", title: "Europe · Tuesday", values: { place: "Northern Europe" }, clips: [] },
}));
jest.mock("../../../../lib/shorts", () => ({
  ...jest.requireActual("../../../../lib/shorts"),
  useShortsList: () => ({ data: list, error: null, refresh: jest.fn(async () => {}) }),
  generateShort: (...a: unknown[]) => generateShort(...(a as [])),
  playShortPreview: (...a: unknown[]) => playShortPreview(...(a as [])),
  getShort: (...a: unknown[]) => getShort(...(a as [string])),
  stopShortPreview: jest.fn(async () => ({ ok: true })),
}));

const formatRow = { id: "short-eu", name: "Europe", preview: { sceneId: "short-eu", exists: true, watchToken: "tok", mode: "off" as const } };

beforeEach(() => {
  jest.clearAllMocks();
  stored = defaultShortFormat("short-eu", "Europe");
  stored.video.title = "%{place} round-up";
  list = { scripts: [], formats: [formatRow] };
  window.history.replaceState(null, "", "/admin/shorts/formats/short-eu");
});

it("opens on the Video group with the format's own cards and its /watch preview", async () => {
  render(<FormatEditor formatId="short-eu" />);
  expect(await screen.findByText("Template")).toBeInTheDocument();
  for (const t of ["Opener and close", "YouTube video", "Timing", "Render defaults"]) expect(screen.getByText(t)).toBeInTheDocument();
  expect(screen.getByTitle("Short preview")).toHaveAttribute("src", "/watch/short-eu?token=tok");
  const rail = screen.getByRole("navigation", { name: "Settings groups" });
  expect(within(rail).getAllByRole("button").map((b) => b.textContent)).toEqual(["Video", "Layout", "Presentation", "Identity"]);
});

it("saves the short settings and the director config with one Save", async () => {
  render(<FormatEditor formatId="short-eu" />);
  await screen.findByText("Template");

  fireEvent.change(screen.getByLabelText("Format name"), { target: { value: "Europe at six" } });
  fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "%{place} at six" } });

  fireEvent.click(screen.getByText("Presentation"));
  expect(screen.getByTestId("theme")).toBeInTheDocument();
  const looks = await screen.findByRole("region", { name: "Looks and thresholds" });
  fireEvent.change(within(looks).getAllByRole("slider")[0], { target: { value: "6.5" } });

  expect(screen.getByText(/3 unsaved changes/)).toBeInTheDocument();
  expect(saveShortFormat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Save changes"));

  await waitFor(() => expect(screen.queryByText("Save changes")).not.toBeInTheDocument());
  expect(saveShortFormat).toHaveBeenCalledTimes(1);
  const [id, patch] = saveShortFormat.mock.calls[0];
  expect(id).toBe("short-eu");
  expect(patch.name).toBe("Europe at six");
  expect(patch.video?.title).toBe("%{place} at six");
  expect(patchDirectorConfig).toHaveBeenCalledTimes(1);
  expect(patchDirectorConfig).toHaveBeenCalledWith("short-eu", { transitionSeconds: 6.5 });
  expect(patchScene).not.toHaveBeenCalled();
  expect(screen.getByText("Format: Europe at six")).toBeInTheDocument();
});

it("previews the title with the most recent script's values and plays that script", async () => {
  list = {
    scripts: [{ id: "s9", formatId: "short-eu", title: "Europe · Tuesday", scope: { type: "globe" }, status: "draft", clipCount: 4, durationMs: 60_000 }],
    formats: [formatRow],
  };
  render(<FormatEditor formatId="short-eu" />);
  await waitFor(() => expect(screen.getByTestId("video-title-preview")).toHaveTextContent("Northern Europe round-up"));

  fireEvent.click(screen.getByText("Play sample"));
  await waitFor(() => expect(playShortPreview).toHaveBeenCalledWith("s9"));
  expect(generateShort).not.toHaveBeenCalled();
});

it("generates a sample when the format has no script yet, then plays it", async () => {
  render(<FormatEditor formatId="short-eu" />);
  await screen.findByText("Template");
  expect(screen.getByText(/Play sample generates one from the saved template/)).toBeInTheDocument();

  fireEvent.click(screen.getByText("Play sample"));
  await waitFor(() => expect(playShortPreview).toHaveBeenCalledWith("new"));
  expect(generateShort).toHaveBeenCalledWith({ formatId: "short-eu", scope: { type: "globe" } });
});

it("copies a look after a confirm and reloads the draft", async () => {
  render(<FormatEditor formatId="short-eu" />);
  await screen.findByText("Template");
  expect(fetchSceneState).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByText("Copy look from…"));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("button", { name: "Copy look" })).toBeDisabled();
  fireEvent.mouseDown(within(dialog).getByLabelText("Copy from"));
  fireEvent.click(await screen.findByRole("option", { name: "Atlantic Wind" }));
  expect(within(dialog).getByText(/can't be undone/)).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy look" }));

  await waitFor(() => expect(copyFormatLook).toHaveBeenCalledWith("short-eu", "wind"));
  expect(await screen.findByText("Copied the look from “Atlantic Wind”.")).toBeInTheDocument();
  await waitFor(() => expect(fetchSceneState).toHaveBeenCalledTimes(2));
});
