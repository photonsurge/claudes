import AdminThemeProvider from "../../theme/AdminThemeProvider";

/**
 * /countries is a first-class catalog page (reached via the /admin/countries
 * redirect) that lives OUTSIDE the /admin subtree, so it doesn't inherit
 * /admin/layout's AdminThemeProvider. Without it, AdminPageShell's MUI theme
 * tokens (`bgcolor: "background.default"`, `text.*`) resolve against MUI's
 * default LIGHT theme — a white background. Mount the same provider here so the
 * catalog (and its /countries/[id] detail pages) get the dark admin theme.
 */
export default function CountriesLayout({ children }: { children: React.ReactNode }) {
  return <AdminThemeProvider>{children}</AdminThemeProvider>;
}
