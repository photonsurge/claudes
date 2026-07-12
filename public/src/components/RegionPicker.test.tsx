import { render, screen, fireEvent } from "@testing-library/react";
import RegionPicker from "./RegionPicker";
import { getRegion } from "@photonsurge/shared/regions";
import { getCountry } from "@photonsurge/shared/countries";

describe("RegionPicker", () => {
  it("renders the Favorites strip and every group heading", () => {
    render(<RegionPicker onFitBounds={() => {}} />);
    // Headings are role=heading, so they don't collide with same-named chips
    // (e.g. the "Europe" group heading vs the "Europe" continent chip).
    for (const label of ["★ Favorites", "Oceans", "Continents", "Europe", "N. America", "Asia"]) {
      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    }
  });

  it("fitBounds to a preset's bbox when its chip is clicked", () => {
    const onFitBounds = jest.fn();
    render(<RegionPicker onFitBounds={onFitBounds} />);
    // "Balkans" is unique to the Europe group (not a favorite, not an admin-0 country).
    fireEvent.click(screen.getByText("Balkans"));
    expect(onFitBounds).toHaveBeenCalledWith(getRegion("balkans")!.bbox);
  });

  it("fitBounds to a country's bbox when picked from the dropdown", () => {
    const onFitBounds = jest.fn();
    render(<RegionPicker onFitBounds={onFitBounds} />);
    fireEvent.change(screen.getByLabelText("all countries"), { target: { value: "fr" } });
    expect(onFitBounds).toHaveBeenCalledWith(getCountry("fr")!.bbox);
  });

  it("ignores the placeholder dropdown option", () => {
    const onFitBounds = jest.fn();
    render(<RegionPicker onFitBounds={onFitBounds} />);
    fireEvent.change(screen.getByLabelText("all countries"), { target: { value: "" } });
    expect(onFitBounds).not.toHaveBeenCalled();
  });
});
