/**
 * The Video group's other cards and Looks and thresholds — each a pure form
 * over the editor's draft that stages whole top-level fields.
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { defaultShortFormat, type ShortFormat } from "@photonsurge/shared/short-format";
import { renderInDraft } from "../../scenes/draft-harness";
import { SettingsCatalogContext } from "../../scenes/catalog-context";
import { FORMAT_CATALOG } from "./format-catalog";
import FormatTemplateSettings from "./FormatTemplateSettings";
import FormatOpenerSettings from "./FormatOpenerSettings";
import FormatTimingSettings from "./FormatTimingSettings";
import FormatRenderSettings from "./FormatRenderSettings";
import FormatLooksSettings, { shortKindsView } from "./FormatLooksSettings";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";

const base = (): ShortFormat => defaultShortFormat("short-eu", "Europe");

const renderCard = (ui: React.ReactElement, format: ShortFormat = base(), config = {}) =>
  renderInDraft(<SettingsCatalogContext.Provider value={FORMAT_CATALOG}>{ui}</SettingsCatalogContext.Provider>, {
    sceneId: "short-eu",
    format,
    config,
  });

const commit = (label: string, value: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe("Template", () => {
  it("renames the format", () => {
    const h = renderCard(<FormatTemplateSettings />);
    fireEvent.change(screen.getByLabelText("Format name"), { target: { value: "Europe at six" } });
    expect(h.lastFormat()).toEqual({ name: "Europe at six" });
  });

  it("picks a country scope from the catalog, and clears it again", () => {
    const h = renderCard(<FormatTemplateSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Country" }));
    const scope = h.lastFormat().template?.scope;
    expect(scope?.type).toBe("country");
    expect(scope && "id" in scope && scope.id).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ask at Generate" }));
    expect(h.lastFormat().template?.scope).toBeUndefined();
  });

  it("several places: an ordered list with the main areas quick-fill, and the world round-up switch", () => {
    const h = renderCard(<FormatTemplateSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Several places" }));
    expect(h.lastFormat().template?.scope).toEqual({ type: "places", places: [] });
    fireEvent.click(screen.getByRole("button", { name: "Main areas" }));
    const scope = h.lastFormat().template?.scope;
    expect(scope?.type === "places" && scope.places.map((p) => p.id)).toEqual(["europe", "usa", "asia", "australia", "africa", "south_america"]);
    fireEvent.click(screen.getByRole("button", { name: "Move Asia up" }));
    const moved = h.lastFormat().template?.scope;
    expect(moved?.type === "places" && moved.places.slice(0, 3).map((p) => p.id)).toEqual(["europe", "asia", "usa"]);
    fireEvent.click(screen.getByRole("switch", { name: /Open on the world round-up/ }));
    expect(h.lastFormat().template?.openWithWorld).toBe(true);
  });

  it("keeps the event switches visible and off by default", () => {
    const h = renderCard(<FormatTemplateSettings />);
    const alerts = screen.getByRole("switch", { name: "Alerts" });
    expect(alerts).not.toBeChecked();
    fireEvent.click(alerts);
    expect(h.lastFormat().template?.include).toEqual({ alerts: true, quakes: false, volcanoes: false });
  });

  it("stages the budget in milliseconds", () => {
    const h = renderCard(<FormatTemplateSettings />);
    commit("Length budget", "90");
    expect(h.lastFormat().template?.budgetMs).toBe(90_000);
  });
});

describe("Opener and close", () => {
  it("stages the round-up depth and the opener share", () => {
    const h = renderCard(<FormatOpenerSettings />);
    fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    expect(h.lastFormat().opener?.roundupDepth).toBe("summary");
    commit("Opener share with events", "50");
    expect(h.lastFormat().opener?.budgetShare).toBe(0.5);
  });

  it("stages the close", () => {
    const h = renderCard(<FormatOpenerSettings />);
    fireEvent.click(screen.getByRole("switch", { name: "End on a wide shot" }));
    expect(h.lastFormat().close).toEqual({ enabled: false, ms: 6000 });
    commit("Close length", "4");
    expect(h.lastFormat().close).toEqual({ enabled: false, ms: 4000 });
  });
});

describe("Timing", () => {
  it("stages lead-in and lead-out in milliseconds", () => {
    const h = renderCard(<FormatTimingSettings />);
    commit("Lead-in", "2.5");
    expect(h.lastFormat().timing).toEqual({ leadInMs: 2500, leadOutMs: 5000 });
  });
});

describe("Render defaults", () => {
  const load = jest.fn(async () => ({
    encoders: [
      { id: "obs-2", name: "gds1 b", url: "ws://x", enabled: true, hasPassword: false, use: "videos" as const, occupancy: { state: "free" as const, label: "free", canQueueVideo: true } },
      { id: "obs-1", name: "gds1 a", url: "ws://y", enabled: true, hasPassword: false, use: "channels" as const, occupancy: { state: "live" as const, label: "live: Main", canQueueVideo: false } },
    ],
    accounts: [{ channelId: "UC1", channelTitle: "Weather Globe" }],
  }));

  it("picks the encoder with the video encoder picker, and clears the defaults", async () => {
    const f = { ...base(), render: { accountId: "UC1" } };
    const h = renderCard(<FormatRenderSettings load={load as any} />, f);
    await waitFor(() => expect(load).toHaveBeenCalled());

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Encoder" }));
    const listbox = await screen.findByRole("listbox");
    // The video picker: what each encoder is doing, a live channel encoder not offered.
    expect(within(listbox).getByRole("option", { name: /gds1 a/ })).toHaveAttribute("aria-disabled", "true");
    expect(within(listbox).getByText("Channel encoders")).toBeInTheDocument();
    fireEvent.click(within(listbox).getByRole("option", { name: /gds1 b\s*free/ }));
    expect(h.lastFormat().render).toEqual({ accountId: "UC1", encoderId: "obs-2" });

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Encoder" }));
    fireEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name: /Any video encoder/ }));
    expect(h.lastFormat().render).toEqual({ accountId: "UC1" });

    fireEvent.mouseDown(screen.getByLabelText("YouTube channel"));
    fireEvent.click(await screen.findByRole("option", { name: "Default channel" }));
    expect(h.lastFormat().render).toEqual({});
  });

  it("names a saved encoder that no longer exists", async () => {
    renderCard(<FormatRenderSettings load={load as any} />, { ...base(), render: { encoderId: "obs-gone" } });
    expect(await screen.findByText(/The saved encoder "obs-gone" no longer exists/)).toBeInTheDocument();
  });
});

describe("Looks and thresholds", () => {
  it("lists a script's shot kinds, whatever the copied channel had on", () => {
    const view = shortKindsView({ ...DEFAULT_DIRECTOR_CONFIG, kinds: { ...DEFAULT_DIRECTOR_CONFIG.kinds, country: false, ad: true } });
    expect(view.kinds.country).toBe(true);
    expect(view.kinds.region).toBe(true);
    expect(view.kinds.ad).toBe(false);
  });

  it("reuses the director panel's sections and stages into the director bucket", () => {
    const h = renderCard(<FormatLooksSettings />);
    const card = screen.getByRole("region", { name: "Looks and thresholds" });
    expect(within(card).getByText(/Transition:/)).toBeInTheDocument();
    expect(within(card).getByText(/Min quake magnitude:/)).toBeInTheDocument();
    expect(within(card).getByText(/Look per shot type:/)).toBeInTheDocument();

    const sliders = within(card).getAllByRole("slider");
    fireEvent.change(sliders[0], { target: { value: "6.5" } });
    expect(h.lastDirector()).toEqual({ transitionSeconds: 6.5 });
    expect(h.stagedFormat).toEqual([]);
  });
});
