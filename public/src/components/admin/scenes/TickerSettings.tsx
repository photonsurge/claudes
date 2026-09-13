"use client";

/**
 * Per-channel bottom-crawl (GLOBAL FEED) content editor — which content kinds
 * ride the crawl, plus a crawl-specific alert-hazard filter. The band's
 * visibility itself is a chrome widget ("Bottom crawl" in the widgets card);
 * its title chip text lives in Brand & theme. STAGED as a DELTA patch
 * (tickerKindsOff / tickerHazardsOff) — the page's Save bar applies it.
 */
import { useMemo } from "react";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { TICKER_KINDS, type TickerKind } from "@photonsurge/shared/broadcast-ticker";
import type { HazardType } from "@photonsurge/shared/alerts/hazard";
import AlertHazardChips from "../../AlertHazardChips";
import SettingsCard from "./SettingsCard";
import { useSceneDraft } from "./SceneDraft";

export default function TickerSettings() {
  const { state, stage } = useSceneDraft();

  const kindsOff = useMemo(() => new Set<string>(state.tickerKindsOff ?? []), [state.tickerKindsOff]);

  const setKind = (id: TickerKind, on: boolean) => {
    const next = new Set(kindsOff);
    if (on) next.delete(id);
    else next.add(id);
    stage({ tickerKindsOff: [...next] as TickerKind[] });
  };

  return (
    <SettingsCard
      id="crawl"
      blurb={
        <>
          What rides this channel&apos;s bottom feed band. The band itself is toggled in the
          on-air widgets card; its title chip text is set in Brand &amp; theme, and how fast it
          scrolls in Reading pace. Sponsor mentions here are the crawl&apos;s AD lines only —
          sponsor slides are managed in Ads.
        </>
      }
    >
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", mb: 1 }}>
        {TICKER_KINDS.map((k) => (
          <Tooltip key={k.id} title={k.hint} placement="top">
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={!kindsOff.has(k.id)}
                  onChange={(e) => setKind(k.id, e.target.checked)}
                  slotProps={{ input: { "aria-label": k.label } }}
                  sx={{ p: 0.5 }}
                />
              }
              label={<Typography variant="body2">{k.label}</Typography>}
            />
          </Tooltip>
        ))}
      </Stack>

      {!kindsOff.has("alert") && (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
            Alert hazards
          </Typography>
          <AlertHazardChips
            hazardsOff={state.tickerHazardsOff ?? []}
            onChange={(next: HazardType[]) => stage({ tickerHazardsOff: next })}
          />
        </Box>
      )}
    </SettingsCard>
  );
}
