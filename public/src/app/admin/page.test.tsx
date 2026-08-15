import { existsSync } from "fs";
import path from "path";
import { render, screen, within } from "@testing-library/react";
import AdminPage, { ADMIN_LINKS } from "./page";

function pagePathForHref(href: string): string {
  if (href === "/") return path.join(process.cwd(), "src/app/page.tsx");
  return path.join(process.cwd(), "src/app", href.replace(/^\//, ""), "page.tsx");
}

describe("AdminPage", () => {
  it("links to the ready admin lists", () => {
    render(<AdminPage />);
    const breadcrumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumbs).getByText("Home").closest("a")).toHaveAttribute("href", "/");
    expect(within(breadcrumbs).getByText("Admin").closest("a")).toBeNull();
    expect(screen.getByRole("heading", { name: "Broadcast" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Signals" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Catalogs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Operations" })).toBeInTheDocument();
    expect(screen.getByText("Weather alerts").closest("a")).toHaveAttribute("href", "/admin/alerts");
    expect(screen.getByText("Cities").closest("a")).toHaveAttribute("href", "/cities");
    expect(screen.getByText("Live tracks").closest("a")).toHaveAttribute("href", "/admin/tracks");
    expect(screen.getByText("Vehicles").closest("a")).toHaveAttribute("href", "/admin/vehicles");
    expect(screen.getByText("Channels").closest("a")).toHaveAttribute("href", "/admin/scenes");
  });

  it("only links to existing static pages", () => {
    for (const link of ADMIN_LINKS) {
      expect(existsSync(pagePathForHref(link.href))).toBe(true);
    }
  });
});
