/**
 * DirectorSettings — the per-channel auto-director CONTENT card: which slide
 * types (kinds) air + their frequency, country/area favourites and one-click
 * presets. Everything stages COMPLETE top-level DirectorConfig fields; with no
 * SceneDraftProvider in these tests, useSceneDraft's fallback patches the
 * director route immediately, so `patchDirector` receives each staged delta.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_DIRECTOR_CONFIG, type DirectorConfig } from "@photonsurge/shared/director";
import { DIRECTOR_PRESETS } from "@photonsurge/shared/director-presets";
import DirectorSettings from "./DirectorSettings";
import SceneDraftProvider from "./SceneDraft";

const fetchConfig = jest.fn();
const patchDirector = jest.fn(async (..._args: unknown[]) => ({}));
jest.mock("../../../lib/director", () => ({
  fetchDirectorConfig: (...args: unknown[]) => fetchConfig(...args),
  patchDirectorConfig: (...args: unknown[]) => patchDirector(...args),
  // Faithful stand-in for the real client merge: top-level replace, kinds record merged.
  mergeConfig: (prev: DirectorConfig, patch: Partial<DirectorConfig>) => ({
    ...prev,
    ...patch,
    kinds: { ...prev.kinds, ...(patch.kinds ?? {}) },
  }),
}));
jest.mock("../../../lib/scenes", () => ({
  useScenePatcher: () => jest.fn(),
}));

beforeEach(() => {
  fetchConfig.mockClear();
  patchDirector.mockClear();
  fetchConfig.mockResolvedValue({ ...DEFAULT_DIRECTOR_CONFIG });
});

describe("DirectorSettings", () => {
  it("toggling a kind stages the COMPLETE kinds record", async () => {
    render(<DirectorSettings sceneId="wind" />);

    const ships = await screen.findByRole("checkbox", { name: "Ships" });
    expect(ships).toBeChecked();
    fireEvent.click(ships);

    expect(patchDirector).toHaveBeenCalledTimes(1);
    const [id, sent] = patchDirector.mock.calls[0] as unknown as [string, Partial<DirectorConfig>];
    expect(id).toBe("wind");
    expect(sent.kinds).toEqual({ ...DEFAULT_DIRECTOR_CONFIG.kinds, ship: false });
  });

  it("ticking a country stages the full favourites array", async () => {
    render(<DirectorSettings sceneId="wind" />);

    const france = await screen.findByRole("checkbox", { name: "🇫🇷 France" });
    expect(france).not.toBeChecked();
    fireEvent.click(france);

    const [, sent] = patchDirector.mock.calls[0] as unknown as [string, Partial<DirectorConfig>];
    // Defaults (uk, japan) survive — the patch carries the whole list.
    expect(new Set(sent.countries)).toEqual(new Set(["uk", "japan", "france"]));
  });

  it("keeps the areas picker editable while its kind is off, with a hint", async () => {
    render(<DirectorSettings sceneId="wind" />);

    // `region` is off by default → the info hint shows…
    const hints = await screen.findAllByText(/won't air until it's enabled above/);
    expect(hints.length).toBeGreaterThan(0);

    // …but the picker still stages edits (curate-ahead).
    const iberia = screen.getByRole("checkbox", { name: "Iberia" });
    fireEvent.click(iberia);
    const [, sent] = patchDirector.mock.calls[0] as unknown as [string, Partial<DirectorConfig>];
    expect(sent.regions).toEqual(["iberia"]);
  });

  it("shows the director mode as a read-only chip", async () => {
    render(<DirectorSettings sceneId="wind" />);

    expect(await screen.findByText("Off")).toBeInTheDocument();
    // No mode switch here — Auto/Off is a live control that stays on /control.
    expect(screen.queryByRole("checkbox", { name: /auto/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Control page" })).toHaveAttribute(
      "href",
      "/control?scene=wind",
    );
  });

  it("a preset chip stages the preset's content bundle", async () => {
    render(<DirectorSettings sceneId="wind" />);
    const preset = DIRECTOR_PRESETS.find((p) => p.id === "storms-only")!;

    fireEvent.click(await screen.findByText(preset.name));

    expect(patchDirector).toHaveBeenCalledWith("wind", preset.patch);
  });

  it("changing a kind's frequency stages the full weights map", async () => {
    render(<DirectorSettings sceneId="wind" />);

    const freq = await screen.findByRole("combobox", { name: "Severe storms frequency" });
    fireEvent.mouseDown(freq);
    fireEvent.click(within(screen.getByRole("listbox")).getByText("Often · ×2"));

    expect(patchDirector).toHaveBeenCalledWith("wind", { kindWeights: { storm: 2 } });
  });

  it("inside a provider, edits stage silently and Discard refetches (epoch bump)", async () => {
    render(
      <SceneDraftProvider sceneId="wind">
        <DirectorSettings sceneId="wind" />
      </SceneDraftProvider>,
    );

    const france = await screen.findByRole("checkbox", { name: "🇫🇷 France" });
    fireEvent.click(france);
    // Staged in the draft bucket — nothing PATCHed yet, the Save bar is up.
    expect(patchDirector).not.toHaveBeenCalled();
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await screen.findByRole("checkbox", { name: "🇫🇷 France" });
    // Epoch bump → the card refetched the saved config.
    expect(fetchConfig).toHaveBeenCalledTimes(2);
    expect(patchDirector).not.toHaveBeenCalled();
  });
});
