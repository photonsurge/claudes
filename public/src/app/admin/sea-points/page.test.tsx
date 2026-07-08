import { render, screen, within } from "@testing-library/react";
import SeaPointsPage from "./page";

beforeEach(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ count: 0, seaPoints: [] }),
  })) as unknown as typeof fetch;
});

afterEach(() => jest.restoreAllMocks());

describe("SeaPointsPage", () => {
  it("wraps the sea-points table in the admin shell", async () => {
    render(<SeaPointsPage />);

    expect(screen.getByRole("heading", { name: "Sea points" })).toBeInTheDocument();
    expect(screen.getByText(/Ocean-monitoring points/)).toBeInTheDocument();

    const breadcrumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumbs).getByText("Home").closest("a")).toHaveAttribute("href", "/");
    expect(within(breadcrumbs).getByText("Admin").closest("a")).toHaveAttribute("href", "/admin");
    expect(within(breadcrumbs).getByText("Sea points").closest("a")).toBeNull();

    // the table itself mounts and settles on the empty catalog
    expect(screen.getByRole("button", { name: "+ Add sea point" })).toBeInTheDocument();
    expect(await screen.findByText("No sea points yet — add one above.")).toBeInTheDocument();
    expect(screen.getByText("0 of 0 sea points")).toBeInTheDocument();
  });
});
