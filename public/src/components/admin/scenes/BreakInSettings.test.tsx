import { fireEvent, screen, within } from "@testing-library/react";
import { DEFAULT_DIRECTOR_CONFIG } from "@photonsurge/shared/director";
import BreakInSettings, { effectiveBreakIn } from "./BreakInSettings";
import { renderInDraft } from "./draft-harness";

const B = DEFAULT_DIRECTOR_CONFIG.breakIn;
const open = (label: string) => fireEvent.mouseDown(screen.getByRole("combobox", { name: label }));
const option = (text: string | RegExp) => within(screen.getByRole("listbox")).getByText(text);

describe("BreakInSettings", () => {
  it("stages the complete breakIn object when the master switch flips", () => {
    const d = renderInDraft(<BreakInSettings />);
    fireEvent.click(screen.getByRole("switch", { name: "Cut to breaking events" }));
    expect(d.lastDirector()).toEqual({ breakIn: { ...B, enabled: false } });
  });

  it("reveals guard and cooldown only in interrupt mode", () => {
    const d = renderInDraft(<BreakInSettings />);
    expect(screen.queryByLabelText("Never cut a shot younger than")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Interrupt the current shot" }));
    expect(d.lastDirector().breakIn?.interrupt).toBe("immediate");
    expect(screen.getByLabelText("Never cut a shot younger than")).toBeInTheDocument();
    expect(screen.getByText("A commercial break always finishes first.")).toBeInTheDocument();
  });

  it("prints the pool bar beside the break-in bar", () => {
    renderInDraft(<BreakInSettings />, { config: { minQuakeMag: 4.5, breakIn: { ...B, minQuakeMag: 6 } } });
    expect(screen.getByText("This channel airs M4.5+ · breaking in at M6.0+")).toBeInTheDocument();
  });

  it("never offers a magnitude below the pool bar", () => {
    renderInDraft(<BreakInSettings />, { config: { minQuakeMag: 5 } });
    open("Earthquakes from");
    expect(option(/M4\.0/).closest("li")).toHaveAttribute("aria-disabled", "true");
    expect(option(/M6\.0/).closest("li")).not.toHaveAttribute("aria-disabled");
  });

  it("stages a higher quake bar", () => {
    const d = renderInDraft(<BreakInSettings />);
    open("Earthquakes from");
    fireEvent.click(option(/M7\.0/));
    expect(d.lastDirector().breakIn?.minQuakeMag).toBe(7);
  });

  it("stages a stricter warning bar and the volcano level", () => {
    const d = renderInDraft(<BreakInSettings />);
    open("Warnings from");
    fireEvent.click(option("Extreme"));
    expect(d.lastDirector().breakIn?.minAlertSeverity).toBe(4);
    open("Volcanoes on");
    fireEvent.click(option("Eruptions and unrest"));
    expect(d.lastDirector().breakIn).toMatchObject({ minAlertSeverity: 4, volcanoMin: "unrest" });
  });

  it("dims every setting below the master switch when break-ins are off", () => {
    renderInDraft(<BreakInSettings />, { config: { breakIn: { ...B, enabled: false } } });
    expect(screen.getByText("When").closest("[aria-disabled]")).toHaveAttribute("aria-disabled", "true");
  });

  it("shows the bar the server will save while a pool edit is staged", () => {
    expect(effectiveBreakIn({ breakIn: { ...B, minQuakeMag: 4.5, minAlertSeverity: 3 }, minQuakeMag: 6, minAlertSeverity: 4 })).toMatchObject({
      minQuakeMag: 6,
      minAlertSeverity: 4,
    });
  });

  it("warns when a reason's slide type is off", () => {
    renderInDraft(<BreakInSettings />, { config: { kinds: { ...DEFAULT_DIRECTOR_CONFIG.kinds, volcano: false } } });
    expect(screen.getByText(/Volcanoes are off in the Content card/)).toBeInTheDocument();
  });

  it("turns round-ups on and only then offers the world round-up and cooldown", () => {
    const d = renderInDraft(<BreakInSettings />);
    expect(screen.getByRole("switch", { name: "World round-up too" })).toBeDisabled();
    fireEvent.click(screen.getByRole("switch", { name: "Round-ups" }));
    expect(d.lastDirector().breakIn?.reasons).toEqual({ ...B.reasons, roundup: true });
    expect(screen.getByLabelText("At most one per")).toBeInTheDocument();
  });

  it("stages the incoming reticle mode", () => {
    const d = renderInDraft(<BreakInSettings />);
    fireEvent.click(screen.getByRole("radio", { name: "Every event shot" }));
    expect(d.lastDirector().breakIn?.incoming).toBe("allEvents");
  });

  it("explains that nothing breaks in while the director is off", () => {
    renderInDraft(<BreakInSettings />);
    expect(screen.getByText(/director is off on this channel/)).toBeInTheDocument();
  });

  it("resets to defaults at this channel's pool bar", () => {
    const d = renderInDraft(<BreakInSettings />, { config: { minQuakeMag: 5.5, breakIn: { ...B, windowMinutes: 90 } } });
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(d.lastDirector()).toEqual({ breakIn: { ...B, minQuakeMag: 5.5, minAlertSeverity: 3 } });
  });
});
