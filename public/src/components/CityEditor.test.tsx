import { render, screen, fireEvent } from "@testing-library/react";
import CityEditor from "./CityEditor";

describe("CityEditor", () => {
  it("submits a validated city", () => {
    const onSubmit = jest.fn();
    render(<CityEditor onSubmit={onSubmit} submitLabel="Create" />);

    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Paris" } });
    fireEvent.change(screen.getByLabelText("lat"), { target: { value: "48.85" } });
    fireEvent.change(screen.getByLabelText("lng"), { target: { value: "2.35" } });
    fireEvent.change(screen.getByLabelText("country"), { target: { value: "FR" } });
    fireEvent.click(screen.getByLabelText("is capital"));

    fireEvent.click(screen.getByText("Create"));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Paris",
      country: "FR",
      lat: 48.85,
      lng: 2.35,
      population: undefined,
      isCapital: true,
    });
  });

  it("shows validation errors and does not submit when invalid", () => {
    const onSubmit = jest.fn();
    render(<CityEditor onSubmit={onSubmit} />);
    fireEvent.click(screen.getByText("Save"));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Name is required")).toBeInTheDocument();
  });

  it("prefills from initial values", () => {
    render(
      <CityEditor
        onSubmit={() => {}}
        initial={{ name: "Tokyo", lat: 35.6, lng: 139.7, isCapital: true }}
      />,
    );
    expect(screen.getByLabelText("name")).toHaveValue("Tokyo");
    expect(screen.getByLabelText("lat")).toHaveValue("35.6");
  });
});
