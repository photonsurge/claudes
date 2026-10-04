import { fireEvent, screen, within } from "@testing-library/react";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import { DEFAULT_DIRECTOR_POOLS, DEFAULT_DIRECTOR_ROTATION } from "@photonsurge/shared/director-tuning";
import DirectorPoolSettings from "./DirectorPoolSettings";
import { renderInDraft } from "./draft-harness";

const type = (label: string, value: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
};
const choose = (label: string, option: string) => {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: label }));
  fireEvent.click(within(screen.getByRole("listbox")).getByText(option));
};

describe("DirectorPoolSettings", () => {
  it("stages the pool magnitude bar", () => {
    const d = renderInDraft(<DirectorPoolSettings />);
    choose("Smallest earthquake", "M5.5");
    expect(d.lastDirector()).toEqual({ minQuakeMag: 5.5 });
  });

  it("stages the pool severity bar", () => {
    const d = renderInDraft(<DirectorPoolSettings />);
    choose("Mildest weather warning", "Moderate");
    expect(d.lastDirector()).toEqual({ minAlertSeverity: 2 });
  });

  it("keeps an off-list stored magnitude selectable", () => {
    renderInDraft(<DirectorPoolSettings />, { config: { minQuakeMag: 4.7 } });
    expect(screen.getByRole("combobox", { name: "Smallest earthquake" })).toHaveTextContent("M4.7");
  });

  it("stages the complete pools object", () => {
    const d = renderInDraft(<DirectorPoolSettings />);
    type("Warnings per country", "5");
    expect(d.lastDirector()).toEqual({ pools: { ...DEFAULT_DIRECTOR_POOLS, alertCountryCap: 5 } });
  });

  it("rounds counts and clamps to bounds", () => {
    const d = renderInDraft(<DirectorPoolSettings />);
    type("Weather warnings in the pool", "999.7");
    expect(d.lastDirector()).toEqual({ pools: { ...DEFAULT_DIRECTOR_POOLS, alertPoolCap: 200 } });
  });

  it("stages the complete rotation object", () => {
    const d = renderInDraft(<DirectorPoolSettings />);
    type("Min distance between shots", "12.5");
    expect(d.lastDirector()).toEqual({ rotation: { ...DEFAULT_DIRECTOR_ROTATION, geoCooldownDeg: 12.5 } });
  });

  it("resets everything it owns", () => {
    const d = renderInDraft(<DirectorPoolSettings />, { config: { minQuakeMag: 6 } });
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(d.lastDirector()).toEqual({
      minQuakeMag: DEFAULT_DIRECTOR_CONFIG.minQuakeMag,
      minAlertSeverity: DEFAULT_DIRECTOR_CONFIG.minAlertSeverity,
      pools: DEFAULT_DIRECTOR_POOLS,
      rotation: DEFAULT_DIRECTOR_ROTATION,
    });
  });
});
