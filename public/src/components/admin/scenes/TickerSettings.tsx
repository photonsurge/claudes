"use client";

/**
 * Per-channel bottom-crawl (GLOBAL FEED) content editor — which content kinds
 * ride the crawl, plus a crawl-specific alert-hazard filter. The band's
 * visibility itself is a chrome widget ("Bottom crawl" in the widgets card);
 * its title chip text lives in Theme settings. STAGED as a DELTA patch
 * (tickerKindsOff / tickerHazardsOff) — the page's Save bar applies it.
 */
import { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { TICKER_KINDS, type TickerKind } from "@photonsurge/shared/broadcast-ticker";
import type { HazardType } from "@photonsurge/shared/alerts/hazard";
import { type ControlState } from "@photonsurge/shared/control";
import { fetchSceneState } from "../../../lib/scenes";
import { useSceneDraft } from "./SceneDraft";
import AlertHazardChips from "../../AlertHazardChips";

export default function TickerSettings({ sceneId }: { sceneId: string }) {
  const { stage: patch, epoch } = useSceneDraft();
  const [state, setState] = useState<ControlState | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSceneState(sceneId).then(({ state: s }) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, [sceneId, epoch]);

  const kindsOff = useMemo(() => new Set<string>(state?.tickerKindsOff ?? []), [state]);

  if (!state) {
    return (
      <Typography variant="body2" color="text.secondary">
        Loading channel…
      </Typography>
    );
  }

  const apply = (over: Partial<ControlState>) => {
    setState({ ...state, ...over });
    patch(sceneId, over);
  };

  const setKind = (id: TickerKind, on: boolean) => {
    const next = new Set(kindsOff);
    if (on) next.delete(id);
    else next.add(id);
    apply({ tickerKindsOff: [...next] as TickerKind[] });
  };

  return (
    <Paper sx={{ p: 1.75 }}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Bottom crawl
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1.25 }}>
        What rides this channel&apos;s bottom feed band. The band itself is toggled in the chrome
        widgets above (&quot;Bottom crawl&quot;); its title chip text is set in Theme settings.
        Sponsor mentions here are the crawl&apos;s AD lines only — sponsor slides are managed in Ads.
      </Typography>

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
            onChange={(next: HazardType[]) => apply({ tickerHazardsOff: next })}
          />
        </Box>
      )}
    </Paper>
  );
}
