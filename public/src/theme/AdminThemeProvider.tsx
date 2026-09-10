"use client";

import { useMemo } from "react";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { adminTheme, makeAdminTheme } from "./adminTheme";
import { mixHex, PAGE_TINT, type Instance } from "../lib/instance";
import { surface } from "./tokens";

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
 *
 * `instance` washes the page ground with the deployment's own colour so the
 * test console can't be mistaken for the live one (lib/instance.ts). It arrives
 * as a plain object from the server layout — a runtime env read — which is why
 * the theme is built here rather than imported ready-made.
 */
export default function AdminThemeProvider({
  instance,
  children,
}: {
  instance?: Instance | null;
  children: React.ReactNode;
}) {
  // Keyed on the colour, not the object: the server layout hands us a fresh
  // object on every navigation and createTheme isn't free.
  const color = instance?.color;
  const theme = useMemo(
    () => (color ? makeAdminTheme({ pageBg: mixHex(surface.page, color, PAGE_TINT) }) : adminTheme),
    [color],
  );

  return (
    <AppRouterCacheProvider options={{ key: "adm", enableCssLayer: true }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
