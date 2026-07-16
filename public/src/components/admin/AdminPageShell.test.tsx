/**
 * The shell's breadcrumb derivation — the one piece of real logic here, and the
 * bit that's easy to get subtly wrong: it has to prepend Home/Admin, decide
 * whether the page title is itself the last crumb or already supplied, and never
 * render Admin twice on /admin itself.
 *
 * (The text-size control the shell also mounts is covered in AdminTextSize.test.tsx.)
 */
import { render, screen, within } from "@testing-library/react";
import AdminPageShell from "./AdminPageShell";

afterEach(() => window.localStorage.clear());

/** The trail as a reader sees it, with each crumb's link target (null = plain text). */
const trail = () =>
  within(screen.getByRole("navigation", { name: "Breadcrumb" }))
    .getAllByText(/.+/)
    .filter((el) => el.tagName === "A" || el.tagName === "P" || el.tagName === "SPAN")
    .filter((el) => !el.className.includes("separator"))
    .map((el) => [el.textContent, el.getAttribute("href")]);

describe("AdminPageShell breadcrumbs", () => {
  it("roots every page at Home / Admin and ends on the page title", () => {
    render(<AdminPageShell title="Worker jobs">body</AdminPageShell>);

    expect(trail()).toEqual([
      ["Home", "/"],
      ["Admin", "/admin"],
      ["Worker jobs", null], // where you are — text, not a link back to itself
    ]);
  });

  it("does not repeat Admin as its own child on /admin itself", () => {
    // The special case: title IS "Admin", so the derived trail would otherwise
    // read Home / Admin / Admin.
    render(<AdminPageShell title="Admin">body</AdminPageShell>);

    expect(trail()).toEqual([
      ["Home", "/"],
      ["Admin", null], // the terminal crumb, so no longer a link
    ]);
  });

  it("keeps a page called Admin under a deeper trail linked", () => {
    // Same title, but it's genuinely a sub-page now — the collapse must not fire.
    render(
      <AdminPageShell title="Admin" crumbs={[{ href: "/admin/alerts", label: "Alerts" }]}>
        body
      </AdminPageShell>,
    );

    expect(trail()).toEqual([
      ["Home", "/"],
      ["Admin", "/admin"],
      ["Alerts", "/admin/alerts"],
    ]);
  });

  it("threads supplied crumbs between Admin and the page", () => {
    render(
      <AdminPageShell title="Etna" crumbs={[{ href: "/admin/volcanoes", label: "Volcanoes" }]}>
        body
      </AdminPageShell>,
    );

    expect(trail()).toEqual([
      ["Home", "/"],
      ["Admin", "/admin"],
      ["Volcanoes", "/admin/volcanoes"],
    ]);
  });

  it("renders a crumb with no href as plain text, not a dead link", () => {
    render(
      <AdminPageShell title="Etna" crumbs={[{ label: "Volcanoes" }]}>
        body
      </AdminPageShell>,
    );

    expect(trail()).toEqual([
      ["Home", "/"],
      ["Admin", "/admin"],
      ["Volcanoes", null],
    ]);
  });

  it("survives two crumbs sharing a label", () => {
    // The key is `${label}.${i}` for exactly this — duplicate labels are legal
    // (a "Regions" catalog under a "Regions" section) and must not collide.
    render(
      <AdminPageShell
        title="Leaf"
        crumbs={[
          { href: "/admin/regions", label: "Regions" },
          { href: "/admin/regions/eu", label: "Regions" },
        ]}
      >
        body
      </AdminPageShell>,
    );

    expect(trail()).toEqual([
      ["Home", "/"],
      ["Admin", "/admin"],
      ["Regions", "/admin/regions"],
      ["Regions", "/admin/regions/eu"],
    ]);
  });
});

describe("AdminPageShell layout", () => {
  it("shows the title, description and actions", () => {
    render(
      <AdminPageShell title="Worker jobs" description="Kick a job by hand." actions={<button>Run all</button>}>
        <p>body</p>
      </AdminPageShell>,
    );

    expect(screen.getByRole("heading", { name: "Worker jobs" })).toBeInTheDocument();
    expect(screen.getByText("Kick a job by hand.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run all" })).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("omits the description and actions rows entirely when unused", () => {
    // They're conditional so a bare page doesn't carry empty boxes and their margins.
    const { container } = render(<AdminPageShell title="Worker jobs">body</AdminPageShell>);

    expect(container.querySelectorAll("button")).toHaveLength(4); // the text-size group only
    expect(screen.getByRole("heading", { name: "Worker jobs" }).parentElement?.textContent).toBe("Worker jobs");
  });

  it("caps the column by default but lets a wide page opt out", () => {
    // Tables of ~80 jobs need the viewport; the default 1100 would waste it.
    // `maxWidth` rides `sx` (an emotion class), not the inline style `zoom` uses,
    // so it's the computed value that tells the truth here.
    const capped = render(<AdminPageShell title="Narrow">body</AdminPageShell>);
    expect(getComputedStyle(capped.container.querySelector("section")!).maxWidth).toBe("1100px");

    const wide = render(
      <AdminPageShell title="Wide" maxWidth="none">
        body
      </AdminPageShell>,
    );
    expect(getComputedStyle(wide.container.querySelectorAll("section")[0]).maxWidth).toBe("none");
  });
});
