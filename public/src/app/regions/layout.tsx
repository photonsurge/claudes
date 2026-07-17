import AdminThemeProvider from "../../theme/AdminThemeProvider";

/**
 * /regions is a first-class catalog page (reached via the /admin/regions
 * redirect) that lives OUTSIDE the /admin subtree, so it doesn't inherit
 * /admin/layout's AdminThemeProvider. Without it, AdminPageShell's MUI theme
 * tokens (`bgcolor: "background.default"`, `text.*`) resolve against MUI's
 * default LIGHT theme — a white background. Mount the same provider here so the
 * catalog (and its /regions/[id] detail pages) get the dark admin theme.
 */
export default function RegionsLayout({ children }: { children: React.ReactNode }) {
  return <AdminThemeProvider>{children}</AdminThemeProvider>;
}
