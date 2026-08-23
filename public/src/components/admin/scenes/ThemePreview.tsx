"use client";

/**
 * Live on-air preview for the Brand/theme editor: the REAL /watch chrome pieces
 * (masthead, ticker, left-column card) on a broadcast-gradient stage, driven by
 * the DRAFT-resolved theme via BroadcastThemeContext — so it recolours as the
 * operator edits, before anything is saved to air. Mirrors the admin/content
 * OnAirPreview seam: the frame is admin, everything inside it is broadcast.
 * Only pure prop-driven components belong here — nothing that fetches.
 */
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { BroadcastTheme } from "../../broadcast/config";
import { BroadcastThemeContext } from "../../broadcast/theme-context";
import BrandPanel from "../../broadcast/BrandPanel";
import Ticker from "../../broadcast/Ticker";
import BroadcastCard, { CardSection } from "../../broadcast/BroadcastCard";

const SAMPLE_TICKER = [
  "M6.1 EARTHQUAKE · KERMADEC ISLANDS",
  "HURRICANE WATCH · GULF COAST",
  "KP 5 GEOMAGNETIC STORM IN PROGRESS",
];

export default function ThemePreview({ theme }: { theme: BroadcastTheme }) {
  return (
    <Box>
      <Typography variant="overline" color="text.disabled" component="div" sx={{ mb: 1.25 }}>
        ON-AIR PREVIEW
      </Typography>
      <Box
        aria-label="Theme preview"
        sx={{
          background: "radial-gradient(120% 120% at 30% 10%, #12203a 0%, #060b14 60%)",
          border: 1,
          borderColor: "divider",
          borderRadius: 1.5,
          p: 2.25,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          alignItems: "flex-start",
          overflow: "hidden",
        }}
      >
        <BroadcastThemeContext.Provider value={theme}>
          {/* Masthead + LIVE badge (liveColor) + accent monogram. */}
          <BrandPanel
            theme={theme}
            live
            status={{ shotKind: "Country", shotTarget: "Iceland", attribute: "Wind gusts" }}
          />
          {/* The crawl self-positions absolutely — give it a band to live in. */}
          <Box sx={{ position: "relative", alignSelf: "stretch", height: 30 }}>
            <Ticker title={theme.tickerTitle} items={SAMPLE_TICKER} edge="top" />
          </Box>
          {/* Top-right deck header sample (the real ones live inside data-fetching
              panels): title ink + accent tag. */}
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              alignSelf: "stretch",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            <span style={{ fontSize: 14.3, fontWeight: 800, letterSpacing: 1.8, color: theme.titleColor }}>
              WORLD REPORT
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: theme.accent }}>
              LAST 24H
            </span>
          </div>
          {/* Left-column card: body/muted ink, panel glass + accent stripe, ON AIR pip. */}
          <BroadcastCard badge="Seismic" live theme={theme} width={396}>
            <CardSection eyebrow="Seismic Report" first>
              <div style={{ fontSize: 15, fontWeight: 700 }}>M6.1 · Kermadec Islands</div>
              <div style={{ fontSize: 13, color: theme.mutedColor, marginTop: 2 }}>
                28 km deep · 210 km NE of Raoul Island
              </div>
            </CardSection>
          </BroadcastCard>
        </BroadcastThemeContext.Provider>
      </Box>
      <Typography variant="caption" color="text.disabled" component="div" sx={{ mt: 1 }}>
        Real /watch components with sample data — recolours as you edit, applies on Save.
      </Typography>
    </Box>
  );
}
