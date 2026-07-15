import { fireEvent, render, screen } from "@testing-library/react";
import AdminPageShell from "./AdminPageShell";

afterEach(() => window.localStorage.clear());

const shell = () => render(<AdminPageShell title="Worker jobs">body</AdminPageShell>);

// jsdom keeps `zoom` on the style object but never serialises it, so
// toHaveStyle/computed styles can't see it — read the property itself.
const zoomOf = (c: HTMLElement) => (c.querySelector("section") as HTMLElement).style.zoom;

describe("admin text size", () => {
  it("offers the size control on every admin page, defaulting to normal", () => {
    shell();
    const group = screen.getByRole("group", { name: "Text size" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "M" })).toHaveAttribute("aria-pressed", "true");
  });

  it("scales the page and remembers the choice", () => {
    const { container, unmount } = shell();
    fireEvent.click(screen.getByRole("button", { name: "XL" }));

    expect(zoomOf(container)).toBe("1.3");
    expect(window.localStorage.getItem("admin.textScale")).toBe("1.3");

    // A different admin page picks the same size back up.
    unmount();
    const second = shell();
    expect(zoomOf(second.container)).toBe("1.3");
    expect(screen.getByRole("button", { name: "XL" })).toHaveAttribute("aria-pressed", "true");
  });

  it("ignores a junk stored value rather than collapsing the page", () => {
    window.localStorage.setItem("admin.textScale", "0");
    const { container } = shell();
    expect(zoomOf(container)).toBe("1");
  });
});
