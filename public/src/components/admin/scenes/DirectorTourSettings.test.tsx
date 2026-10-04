import { fireEvent, screen } from "@testing-library/react";
import { DEFAULT_DIRECTOR_TOURS } from "@photonsurge/shared/director-tuning";
import DirectorTourSettings from "./DirectorTourSettings";
import { renderInDraft } from "./draft-harness";

const type = (label: string, value: string) => {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
};

describe("DirectorTourSettings", () => {
  it("shows every tour field with its default", () => {
    renderInDraft(<DirectorTourSettings />);
    expect(screen.getByLabelText("Time at each stop")).toHaveValue("40");
    expect(screen.getByText("default 40 s · 5–120")).toBeInTheDocument();
  });

  it("stages the complete tours object on Enter", () => {
    const d = renderInDraft(<DirectorTourSettings />);
    type("Stops on a country tour", "4");
    expect(d.lastDirector()).toEqual({ tours: { ...DEFAULT_DIRECTOR_TOURS, countryStops: 4 } });
  });

  it("does not stage an unchanged value", () => {
    const d = renderInDraft(<DirectorTourSettings />);
    type("Volcano zoom", "5");
    expect(d.stagedDirector).toHaveLength(0);
  });

  it("resets to the default tours", () => {
    const d = renderInDraft(<DirectorTourSettings />, { config: { tours: { ...DEFAULT_DIRECTOR_TOURS, countryStops: 2 } } });
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(d.lastDirector()).toEqual({ tours: DEFAULT_DIRECTOR_TOURS });
  });
});
