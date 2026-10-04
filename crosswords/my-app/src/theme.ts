import { alpha, createTheme, PaletteMode } from "@mui/material/styles";

export const getAppTheme = (mode: PaletteMode) =>
  createTheme({
    palette: {
      mode,
      ...(mode === "dark"
        ? {
            background: { default: "#0b1220", paper: "#111a2e" },
            primary: { main: "#4cc9f0" },
            secondary: { main: "#ff8a65" },
            text: { primary: "#ecf2ff", secondary: "#b6c2df" },
          }
        : {
            background: { default: "#f3f6fb", paper: "#ffffff" },
            primary: { main: "#0f5fa8" },
            secondary: { main: "#bf5b2c" },
            text: { primary: "#0d1b2a", secondary: "#4c6078" },
          }),
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
      button: { textTransform: "none", fontWeight: 600 },
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: ({ theme }) => ({
            border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
            backgroundImage: "none",
          }),
        },
      },
      MuiButton: {
        styleOverrides: {
          contained: ({ theme }) => ({
            boxShadow: `0 8px 20px ${alpha(theme.palette.primary.main, 0.28)}`,
          }),
        },
      },
    },
  });
