"use client";

/**
 * Draft buffer for the per-channel settings page. The setting cards STAGE their
 * delta patches here instead of emitting them live; a sticky bar appears once
 * anything is staged and Save applies the whole accumulated delta as ONE patch
 * (Discard drops it and bumps `epoch`, which makes every card refetch the
 * server state). A card rendered without a provider falls back to the old
 * live-patch behaviour.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { type ControlState } from "@photonsurge/shared/control";
import { useScenePatcher } from "../../../lib/scenes";

type SceneDraftValue = {
  /** Stage a delta for later Save (same signature as useScenePatcher's fn). */
  stage: (sceneId: string, patch: Partial<ControlState>) => void;
  /** Bumped on Discard — cards refetch on it to drop their staged local state. */
  epoch: number;
};

const SceneDraftContext = createContext<SceneDraftValue | null>(null);

/** What the setting cards call in place of useScenePatcher: staged inside a
 * SceneDraftProvider, live (immediate patch) without one. */
export function useSceneDraft(): SceneDraftValue {
  const live = useScenePatcher();
  const ctx = useContext(SceneDraftContext);
  return ctx ?? { stage: live, epoch: 0 };
}

export default function SceneDraftProvider({
  sceneId,
  children,
}: {
  sceneId: string;
  children: ReactNode;
}) {
  const patch = useScenePatcher();
  const [pending, setPending] = useState<Partial<ControlState>>({});
  const [epoch, setEpoch] = useState(0);

  const stage = useCallback((_id: string, over: Partial<ControlState>) => {
    setPending((prev) => ({ ...prev, ...over }));
  }, []);

  const value = useMemo(() => ({ stage, epoch }), [stage, epoch]);
  const dirty = Object.keys(pending).length > 0;

  const save = () => {
    const out = { ...pending };
    // spinEpoch means "camera motion restarts NOW" — restamp it at apply time,
    // not at the click that staged it minutes earlier.
    if ("spinEpoch" in out) out.spinEpoch = Date.now();
    patch(sceneId, out);
    setPending({});
  };

  const discard = () => {
    setPending({});
    setEpoch((e) => e + 1);
  };

  return (
    <SceneDraftContext.Provider value={value}>
      {children}
      {dirty && (
        <Paper
          elevation={6}
          sx={{
            position: "sticky",
            bottom: 12,
            zIndex: 10,
            mt: 2,
            p: 1.25,
            pl: 1.75,
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <Typography variant="body2" sx={{ flex: 1 }}>
            Unsaved changes — nothing has gone on air yet.
          </Typography>
          <Button size="small" color="inherit" onClick={discard}>
            Discard
          </Button>
          <Button size="small" variant="contained" onClick={save}>
            Save changes
          </Button>
        </Paper>
      )}
    </SceneDraftContext.Provider>
  );
}
