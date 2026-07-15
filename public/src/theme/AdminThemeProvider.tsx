"use client";

import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { adminTheme } from "./adminTheme";

/**
 * Mounts the MUI/emotion runtime for the /admin subtree only.
 *
 * Kept out of the root layout on purpose: /watch is the streamed broadcast
 * surface and shouldn't ship or run emotion alongside its WebGL globe, and its
 * glass look is a separate design language anyway (DESIGN_BIBLE §2).
 *
 * `enableCssLayer` wraps MUI's output in `@layer mui`, so the plain inline
 * styles still on the not-yet-converted admin pages keep winning over MUI's
 * base rules while the rollout is in progress.
 */
export default function AdminThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ key: "adm", enableCssLayer: true }}>
      <ThemeProvider theme={adminTheme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
