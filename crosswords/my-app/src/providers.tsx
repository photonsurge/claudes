"use client";

import { useMemo } from "react";
import { ThemeProvider, CssBaseline } from "@mui/material";
import useMediaQuery from "@mui/material/useMediaQuery";
import { SessionProvider } from "next-auth/react";
import { getAppTheme } from "@/theme";

export const Providers = ({ children }: { children: React.ReactNode }) => {
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = useMemo(() => getAppTheme(prefersDark ? "dark" : "light"), [prefersDark]);

  return (
    <SessionProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </SessionProvider>
  );
};
