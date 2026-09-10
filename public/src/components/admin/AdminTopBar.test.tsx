/**
 * The admin bar. Small, but it carries the log-out control and the only way home
 * from a deep admin page, and it exists as its own client component because the
 * layout is an async server component that can't pass MUI's `component={Link}`
 * across the boundary — so "renders at all, given only a plain string" is itself
 * the regression worth catching.
 */
import { render, screen } from "@testing-library/react";
import AdminTopBar from "./AdminTopBar";
import { INSTANCE_COLOR, type Instance } from "../../lib/instance";

const LIVE: Instance = { id: "live", label: "LIVE", color: INSTANCE_COLOR.live };

describe("AdminTopBar", () => {
  it("makes the logo the way home", () => {
    render(<AdminTopBar email="ops@example.com" />);

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
  });

  it("labels the logo for a screen reader rather than leaving it decorative", () => {
    render(<AdminTopBar />);

    expect(screen.getByAltText(/G\.O\.D\.S/)).toBeInTheDocument();
  });

  it("links back to the admin index", () => {
    render(<AdminTopBar />);

    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
  });

  it("shows who's signed in, with a way out", () => {
    render(<AdminTopBar email="ops@example.com" />);

    expect(screen.getByText("ops@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("logs out by POST, never GET", () => {
    // A GET log-out is prefetchable/crawlable — the bar must not sign an
    // operator out because something touched the link.
    const { container } = render(<AdminTopBar email="ops@example.com" />);

    const form = container.querySelector("form")!;
    expect(form).toHaveAttribute("method", "POST");
    expect(form).toHaveAttribute("action", "/api/auth/logout");
    expect(screen.getByRole("button", { name: "Log out" })).toHaveAttribute("type", "submit");
  });

  it("hides the session controls when there's no session", () => {
    // Signed out, the bar is still the way home — but must not offer a log-out
    // for nobody, or render a blank where the email goes.
    render(<AdminTopBar />);

    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Home" })).toBeInTheDocument();
  });

  it("treats an empty email as signed out, not as a nameless session", () => {
    render(<AdminTopBar email="" />);

    expect(screen.queryByRole("button", { name: "Log out" })).not.toBeInTheDocument();
  });

  describe("which deployment am I driving", () => {
    // Three boxes run this same image. Before the badge, the only way to tell
    // the live console from the test one was to recognise the data on it.
    it("names the instance in the bar", () => {
      render(<AdminTopBar email="ops@example.com" instance={LIVE} />);

      expect(screen.getByText("LIVE")).toBeInTheDocument();
    });

    it("says nothing at all when the chrome is switched off", () => {
      render(<AdminTopBar email="ops@example.com" instance={null} />);

      expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
      // …and the bar still works.
      expect(screen.getByRole("link", { name: "Admin" })).toBeInTheDocument();
    });

    it("takes the label from the instance rather than hardcoding the three", () => {
      render(<AdminTopBar instance={{ id: "test", label: "STAGING", color: "#00ff00" }} />);

      expect(screen.getByText("STAGING")).toBeInTheDocument();
    });
  });
});
