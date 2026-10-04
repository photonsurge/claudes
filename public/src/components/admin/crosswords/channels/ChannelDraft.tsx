"use client";

/**
 * The staged draft behind a crossword channel's settings page (plan §8.2), the
 * weather page's SceneDraft pattern over the crossword's two documents: the
 * channel record's ControlState (music bed `audio`, `youtube`) and the
 * CrosswordConfig (look and game). Cards stage deltas; nothing reaches the
 * channel until Save writes each bucket once — `stage` → a SCENE_STATE emit
 * plus an awaited PATCH of /api/scenes/:id, `stageCrossword` → PATCH
 * /api/crossword/:scene/config. Both buckets shallow-merge, so a card stages
 * whole top-level fields (the whole `theme`, the whole `youtube`).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_CONTROL_STATE, mergeControlState, type ControlState } from "@photonsurge/shared/control";
import { DEFAULT_CROSSWORD_CONFIG, type CrosswordConfig } from "@photonsurge/shared/crossword";
import { emitScenePatch, fetchSceneState, patchScene } from "../../../../lib/scenes";
import { useSocket } from "../../../../lib/socket-provider";
import { fetchCrosswordConfig, patchCrosswordConfig } from "./client";

export type ChannelDraftValue = {
  sceneId: string;
  /** Both documents have loaded. Cards render only once this is true. */
  ready: boolean;
  /** The channel record as last saved. */
  saved: ControlState;
  /** The channel record with its staged delta on top. */
  state: ControlState;
  /** The crossword config with its staged delta on top. */
  crossword: CrosswordConfig;
  stage: (patch: Partial<ControlState>) => void;
  stageCrossword: (patch: Partial<CrosswordConfig>) => void;
  pending: Partial<ControlState>;
  pendingCrossword: Partial<CrosswordConfig>;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  save: () => void;
  discard: () => void;
};

const ChannelDraftContext = createContext<ChannelDraftValue | null>(null);

export function useChannelDraft(): ChannelDraftValue {
  const v = useContext(ChannelDraftContext);
  if (!v) throw new Error("useChannelDraft must be used inside <ChannelDraftProvider>");
  return v;
}

export default function ChannelDraftProvider({ sceneId, children }: { sceneId: string; children: ReactNode }) {
  const { socket } = useSocket();
  const [base, setBase] = useState<ControlState | null>(null);
  const [baseCrossword, setBaseCrossword] = useState<CrosswordConfig | null>(null);
  const [pending, setPending] = useState<Partial<ControlState>>({});
  const [pendingCrossword, setPendingCrossword] = useState<Partial<CrosswordConfig>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBase(null);
    setBaseCrossword(null);
    setPending({});
    setPendingCrossword({});
    fetchSceneState(sceneId).then(({ state }) => {
      if (!cancelled) setBase(state);
    });
    fetchCrosswordConfig(sceneId).then((c) => {
      if (!cancelled) setBaseCrossword(c);
    });
    return () => {
      cancelled = true;
    };
  }, [sceneId]);

  const stage = useCallback((over: Partial<ControlState>) => {
    setPending((prev) => ({ ...prev, ...over }));
    setSaveError(null);
  }, []);
  const stageCrossword = useCallback((over: Partial<CrosswordConfig>) => {
    setPendingCrossword((prev) => ({ ...prev, ...over }));
    setSaveError(null);
  }, []);

  const ready = base !== null && baseCrossword !== null;
  const state = useMemo(() => (base ? mergeControlState(base, pending) : DEFAULT_CONTROL_STATE), [base, pending]);
  // The cards clamp what they stage and the server clamps again on Save.
  const crossword = useMemo(
    () => ({ ...(baseCrossword ?? DEFAULT_CROSSWORD_CONFIG), ...pendingCrossword }),
    [baseCrossword, pendingCrossword],
  );
  const dirty = Object.keys(pending).length > 0 || Object.keys(pendingCrossword).length > 0;

  const save = useCallback(() => {
    if (!dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    const out = { ...pending };
    const game = { ...pendingCrossword };
    let savedGame: CrosswordConfig | null = null;

    void (async () => {
      const errors: string[] = [];
      if (Object.keys(out).length > 0) {
        // Push the delta so the output cuts over now, and do the durable write
        // here so a failure is reported by this Save.
        emitScenePatch(socket, sceneId, out, () => {});
        const res = await patchScene(sceneId, out);
        if (!res.ok) errors.push(res.error ?? "channel save failed");
      }
      if (Object.keys(game).length > 0) {
        try {
          savedGame = await patchCrosswordConfig(sceneId, game);
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
      }
      setSaving(false);
      if (errors.length > 0) {
        // Keep the draft: the operator's edits are still the only copy.
        setSaveError(errors.join(" · "));
        return;
      }
      setBase((prev) => (prev ? mergeControlState(prev, out) : prev));
      // The route returns the clamped result, which is the truth to show.
      if (savedGame) setBaseCrossword(savedGame);
      setPending({});
      setPendingCrossword({});
    })();
  }, [dirty, saving, pending, pendingCrossword, socket, sceneId]);

  const discard = useCallback(() => {
    setPending({});
    setPendingCrossword({});
    setSaveError(null);
  }, []);

  // Leaving with staged edits loses them; the browser's own prompt catches a closed tab too.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const value: ChannelDraftValue = {
    sceneId,
    ready,
    saved: base ?? DEFAULT_CONTROL_STATE,
    state,
    crossword,
    stage,
    stageCrossword,
    pending,
    pendingCrossword,
    dirty,
    saving,
    saveError,
    save,
    discard,
  };
  return <ChannelDraftContext.Provider value={value}>{children}</ChannelDraftContext.Provider>;
}
