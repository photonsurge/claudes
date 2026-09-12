/**
 * LogoutButton — the sign-out control for every operator surface outside /admin.
 * Tiny, but the one property that matters is easy to lose in a restyle: it must
 * sign out by POST, never by a GET link something could prefetch.
 */
import { render, screen } from "@testing-library/react";
import LogoutButton from "./LogoutButton";

describe("LogoutButton", () => {
  it.each([[false], [true]])("logs out by POST to /api/auth/logout (compact=%s)", (compact) => {
    const { container } = render(<LogoutButton compact={compact} />);

    const form = container.querySelector("form")!;
    expect(form).toHaveAttribute("method", "POST");
    expect(form).toHaveAttribute("action", "/api/auth/logout");
    expect(screen.getByRole("button", { name: "Log out" })).toHaveAttribute("type", "submit");
    // …and it is never a link.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
