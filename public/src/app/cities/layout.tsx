import AdminThemeProvider from "../../theme/AdminThemeProvider";

/**
 * /cities is a first-class catalog page (linked from the admin launcher) that
 * lives OUTSIDE the /admin subtree, so it doesn't inherit /admin/layout's
 * AdminThemeProvider. Without it, AdminPageShell's MUI theme tokens
 * (`bgcolor: "background.default"`, `text.*`) resolve against MUI's default
 * LIGHT theme — a white background. Mount the same provider here so the catalog
 * (and its /cities/[id] detail pages) get the dark admin theme.
 */
export default function CitiesLayout({ children }: { children: React.ReactNode }) {
  return <AdminThemeProvider>{children}</AdminThemeProvider>;
}
