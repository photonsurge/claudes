import { render, screen } from "@testing-library/react";
import AdminPage from "./page";

describe("AdminPage", () => {
  it("links to the ready admin lists", () => {
    render(<AdminPage />);
    expect(screen.getByText("Weather alerts").closest("a")).toHaveAttribute("href", "/admin/alerts");
    expect(screen.getByText("Cities").closest("a")).toHaveAttribute("href", "/cities");
    expect(screen.getByText("Live tracks").closest("a")).toHaveAttribute("href", "/admin/tracks");
    expect(screen.getByText("Vehicles in DB").closest("a")).toHaveAttribute("href", "/admin/vehicles");
    expect(screen.getByText("Scenes").closest("a")).toHaveAttribute("href", "/admin/scenes");
  });
});
