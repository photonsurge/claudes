/**
 * Director: pacing — holds, between-shot timing and within-shot tempo. Every
 * edit stages a COMPLETE top-level DirectorConfig field, so the shallow-merging
 * Save can't drop a sibling.
 */
import { fireEvent, screen } from "@testing-library/react";
import {
  DEFAULT_DIRECTOR_CONFIG,
  DEFAULT_KIND_HOLD_SECONDS,
  DEFAULT_QUAKE_HOLD_SECONDS,
  DEFAULT_STORM_HOLD_SECONDS,
} from "@photonsurge/shared/director";
import { DEFAULT_DIRECTOR_TEMPO } from "@photonsurge/shared/director-tuning";
import DirectorPacingSettings from "./DirectorPacingSettings";
import { renderInDraft } from "./draft-harness";

const type = (label: string, value: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};

describe("DirectorPacingSettings", () => {
  it("stages the complete kind-hold map when one kind's hold changes", () => {
    const d = renderInDraft(<DirectorPacingSettings />);
    type("Countries", "30");
    expect(d.lastDirector()).toEqual({ kindHoldSeconds: { ...DEFAULT_KIND_HOLD_SECONDS, country: 30 } });
  });

  it("keeps a first edit when a second kind is edited (no partial maps)", () => {
    const d = renderInDraft(<DirectorPacingSettings />);
    type("Countries", "30");
    type("Ships", "20");
    expect(d.lastDirector().kindHoldSeconds).toMatchObject({ country: 30, ship: 20 });
  });

  it("lists holds only for the kinds the channel airs", () => {
    renderInDraft(<DirectorPacingSettings />, { config: { kinds: { ...DEFAULT_DIRECTOR_CONFIG.kinds, ship: false } } });
    expect(screen.queryByLabelText("Ships")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Countries")).toBeInTheDocument();
  });

  it("splits quakes by magnitude, showing only bands that can air", () => {
    const d = renderInDraft(<DirectorPacingSettings />, { config: { minQuakeMag: 6 } });
    expect(screen.queryByLabelText("Quake: Light")).not.toBeInTheDocument();
    type("Quake: Great", "45");
    expect(d.lastDirector()).toEqual({ quakeHoldSeconds: { ...DEFAULT_QUAKE_HOLD_SECONDS, great: 45 } });
  });

  it("splits storms by severity at or above the pool bar", () => {
    const d = renderInDraft(<DirectorPacingSettings />, { config: { minAlertSeverity: 3 } });
    expect(screen.queryByLabelText("Storm: Moderate")).not.toBeInTheDocument();
    type("Storm: Extreme", "40");
    expect(d.lastDirector()).toEqual({ stormHoldSeconds: { ...DEFAULT_STORM_HOLD_SECONDS, extreme: 40 } });
  });

  it("clamps a hold to the server's 3 s floor", () => {
    const d = renderInDraft(<DirectorPacingSettings />);
    type("Countries", "1");
    expect(d.lastDirector().kindHoldSeconds?.country).toBe(3);
  });

  it("ignores a non-number and keeps the current value", () => {
    const d = renderInDraft(<DirectorPacingSettings />);
    type("Countries", "abc");
    expect(d.stagedDirector).toHaveLength(0);
    expect(screen.getByLabelText("Countries")).toHaveValue(String(DEFAULT_KIND_HOLD_SECONDS.country));
  });

  it("stages the complete tempo object", () => {
    const d = renderInDraft(<DirectorPacingSettings />);
    type("Each map look", "9");
    expect(d.lastDirector()).toEqual({ tempo: { ...DEFAULT_DIRECTOR_TEMPO, mapStepS: 9 } });
  });

  it("shows the ad cadence only when ads air", () => {
    renderInDraft(<DirectorPacingSettings />);
    expect(screen.queryByLabelText("Ad break every")).not.toBeInTheDocument();
    const d = renderInDraft(<DirectorPacingSettings />, { config: { kinds: { ...DEFAULT_DIRECTOR_CONFIG.kinds, ad: true } } });
    type("Ad break every", "4.4");
    expect(d.lastDirector()).toEqual({ adEveryNShots: 4 });
  });

  it("stages every field it owns on Reset to defaults", () => {
    const d = renderInDraft(<DirectorPacingSettings />, { config: { transitionSeconds: 9 } });
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(d.lastDirector()).toEqual({
      kindHoldSeconds: DEFAULT_KIND_HOLD_SECONDS,
      quakeHoldSeconds: DEFAULT_QUAKE_HOLD_SECONDS,
      stormHoldSeconds: DEFAULT_STORM_HOLD_SECONDS,
      volcanoHoldSeconds: DEFAULT_DIRECTOR_CONFIG.volcanoHoldSeconds,
      transitionSeconds: DEFAULT_DIRECTOR_CONFIG.transitionSeconds,
      alertCycleSeconds: DEFAULT_DIRECTOR_CONFIG.alertCycleSeconds,
      adEveryNShots: DEFAULT_DIRECTOR_CONFIG.adEveryNShots,
      tempo: DEFAULT_DIRECTOR_TEMPO,
    });
  });
});
