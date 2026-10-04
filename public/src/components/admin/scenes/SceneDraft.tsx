"use client";

/**
 * Draft buffer for the per-channel settings page — and the page's ONE owner of
 * server data.
 *
 * The provider fetches this channel's `ControlState` and `DirectorConfig` once
 * and hands every card a MERGED view (`state` / `config` = the server doc with
 * the staged delta laid over it). Cards are therefore pure forms: they read
 * `state`, they call `stage`, and they hold no server data of their own. That
 * is what makes them safe to unmount — a card behind an unselected group tab
 * keeps its staged edit, because the edit never lived in the card.
 *
 * Nothing reaches the channel until Save applies the accumulated delta as ONE
 * write per bucket: `stage` → a SCENE_STATE emit plus an awaited PATCH of
 * /api/scenes/:id, `stageDirector` → PATCH /api/director/:scene/config, and on a
 * crossword channel `stageCrossword` → PATCH /api/crossword/:scene/config. A
 * crossword channel has no director, so its DirectorConfig is not read (the
 * defaults stand in); a weather channel never reads a crossword config. All
 * buckets shallow-merge, so cards MUST stage complete top-level fields (the
 * whole `kinds` record, the whole `countries` array…) — a partial nested object
 * would clobber staged siblings.
 *
 * The provider also FOLLOWS the live channel: a SCENE_STATE from the operator's
 * desk merges into the base, so fields nobody is editing stay true. It lands in
 * the base even for a field that IS staged — the staged value simply wins in
 * the merge — but the collision is recorded in `conflictKeys` so the Save bar
 * can say that saving will overwrite what the desk just did.
 *
 * No UI lives here. The Save bar is `SceneSaveBar`, which the page renders.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_CONTROL_STATE,
  mergeControlState,
  SCENE_STATE,
  type ControlState,
  type SceneStatePayload,
  type SceneSurface,
} from "@photonsurge/shared/control";
import { DEFAULT_DIRECTOR_CONFIG, type DirectorConfig } from "@photonsurge/shared/director";
import { DEFAULT_CROSSWORD_CONFIG, type CrosswordConfig } from "@photonsurge/shared/crossword";
import { emitScenePatch, fetchSceneState, patchScene } from "../../../lib/scenes";
import { fetchDirectorConfig, mergeConfig, patchDirectorConfig } from "../../../lib/director";
import { useSocket } from "../../../lib/socket-provider";
import { fetchCrosswordConfig, patchCrosswordConfig } from "./crossword-config";

export type SceneDraftValue = {
  sceneId: string;
  /** Which kind of channel this is; decides which documents are read. */
  surface: SceneSurface;
  /** Every document this channel uses has loaded. Cards render only once this is true. */
  ready: boolean;
  /** Server ControlState with the staged delta merged on top — what cards render. */
  state: ControlState;
  /** Server DirectorConfig with its staged delta merged on top. */
  config: DirectorConfig;
  /** Stage a ControlState delta. No sceneId: the provider knows which channel. */
  stage: (patch: Partial<ControlState>) => void;
  /** Stage a DirectorConfig delta for the same Save. */
  stageDirector: (patch: Partial<DirectorConfig>) => void;
  /** Server CrosswordConfig with its staged delta on top (defaults on a weather channel). */
  crossword: CrosswordConfig;
  /** Stage a CrosswordConfig delta for the same Save. */
  stageCrossword: (patch: Partial<CrosswordConfig>) => void;
  /** The staged deltas themselves — the Save bar names what they touch. */
  pending: Partial<ControlState>;
  pendingDirector: Partial<DirectorConfig>;
  pendingCrossword: Partial<CrosswordConfig>;
  dirty: boolean;
  /** Staged fields the operator's desk has ALSO changed since they were staged. */
  conflictKeys: readonly string[];
  saving: boolean;
  saveError: string | null;
  save: () => void;
  discard: () => void;
};

/** Exported for the test harness (draft-harness.tsx), which supplies a card a
 *  ready-made draft instead of standing up the fetching provider. Application
 *  code goes through `useSceneDraft`. */
export const SceneDraftContext = createContext<SceneDraftValue | null>(null);

/**
 * What the setting cards call. A card outside a provider is a programming
 * error, not a fallback: every card on this page is a pure form over the
 * provider's merged state and has nothing to render without it.
 */
export function useSceneDraft(): SceneDraftValue {
  const ctx = useContext(SceneDraftContext);
  if (!ctx) throw new Error("useSceneDraft must be used inside a SceneDraftProvider");
  return ctx;
}

export default function SceneDraftProvider({
  sceneId,
  surface = "globe",
  children,
}: {
  sceneId: string;
  surface?: SceneSurface;
  children: ReactNode;
}) {
  const isCrossword = surface === "crossword";
  const { socket } = useSocket();

  // The server documents, as last read (cold start + live SCENE_STATE).
  const [base, setBase] = useState<ControlState | null>(null);
  const [baseConfig, setBaseConfig] = useState<DirectorConfig | null>(null);
  const [baseCrossword, setBaseCrossword] = useState<CrosswordConfig | null>(null);
  // The staged deltas.
  const [pending, setPending] = useState<Partial<ControlState>>({});
  const [pendingDirector, setPendingDirector] = useState<Partial<DirectorConfig>>({});
  const [pendingCrossword, setPendingCrossword] = useState<Partial<CrosswordConfig>>({});
  const [conflictKeys, setConflictKeys] = useState<readonly string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The live handler needs today's staged keys without re-subscribing on every
  // keystroke, so it reads them off a ref rather than closing over the state.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  // Cold start — ONE read of each document for the whole page.
  useEffect(() => {
    let cancelled = false;
    setBase(null);
    setBaseConfig(null);
    setBaseCrossword(null);
    setPending({});
    setPendingDirector({});
    setPendingCrossword({});
    setConflictKeys([]);
    fetchSceneState(sceneId).then(({ state: s }) => {
      if (!cancelled) setBase(s);
    });
    if (isCrossword) {
      setBaseConfig(DEFAULT_DIRECTOR_CONFIG);
      fetchCrosswordConfig(sceneId).then((c) => {
        if (!cancelled) setBaseCrossword(c);
      });
    } else {
      fetchDirectorConfig(sceneId).then((c) => {
        if (!cancelled) setBaseConfig(c);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [sceneId, isCrossword]);

  const stage = useCallback((over: Partial<ControlState>) => {
    setPending((prev) => ({ ...prev, ...over }));
    setSaveError(null);
  }, []);

  const stageDirector = useCallback((over: Partial<DirectorConfig>) => {
    setPendingDirector((prev) => ({ ...prev, ...over }));
    setSaveError(null);
  }, []);

  const stageCrossword = useCallback((over: Partial<CrosswordConfig>) => {
    setPendingCrossword((prev) => ({ ...prev, ...over }));
    setSaveError(null);
  }, []);

  /** A live change from the desk: adopt it, unless it hits a staged field. */
  const applyLive = useCallback((over: Partial<ControlState>) => {
    const staged = Object.keys(pendingRef.current);
    const hit = Object.keys(over).filter((k) => staged.includes(k));
    if (hit.length > 0) setConflictKeys((prev) => [...new Set([...prev, ...hit])]);
    setBase((prev) => (prev ? mergeControlState(prev, over) : prev));
  }, []);

  const ready = base !== null && baseConfig !== null && (!isCrossword || baseCrossword !== null);

  const state = useMemo(
    () => (base ? mergeControlState(base, pending) : DEFAULT_CONTROL_STATE),
    [base, pending],
  );
  const config = useMemo(
    () => (baseConfig ? mergeConfig(baseConfig, pendingDirector) : DEFAULT_DIRECTOR_CONFIG),
    [baseConfig, pendingDirector],
  );

  // The cards clamp what they stage, and the server clamps again on Save, so a
  // plain overlay is enough here.
  const crossword = useMemo(
    () => ({ ...(baseCrossword ?? DEFAULT_CROSSWORD_CONFIG), ...pendingCrossword }),
    [baseCrossword, pendingCrossword],
  );

  const dirty =
    Object.keys(pending).length > 0 ||
    Object.keys(pendingDirector).length > 0 ||
    Object.keys(pendingCrossword).length > 0;

  const save = useCallback(() => {
    if (!dirty || saving) return;
    setSaving(true);
    setSaveError(null);
    const out = { ...pending };
    // spinEpoch means "camera motion restarts NOW" — restamp it at apply time,
    // not at the click that staged it minutes earlier.
    if ("spinEpoch" in out) out.spinEpoch = Date.now();
    const director = { ...pendingDirector };
    const game = { ...pendingCrossword };
    let savedGame: CrosswordConfig | null = null;

    void (async () => {
      const errors: string[] = [];
      if (Object.keys(out).length > 0) {
        // Push the delta over the socket so /watch cuts over now, and do the
        // durable write HERE rather than through the debounced live patcher —
        // that would persist the same delta a second time, and swallow the
        // failure this Save has to report.
        emitScenePatch(socket, sceneId, out, () => {});
        const res = await patchScene(sceneId, out);
        if (!res.ok) errors.push(res.error ?? "channel save failed");
      }
      if (Object.keys(director).length > 0) {
        try {
          await patchDirectorConfig(sceneId, director);
        } catch (err) {
          errors.push(err instanceof Error ? err.message : String(err));
        }
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
      // Saved — the deltas are now the server truth, so fold them into the base
      // and clear the draft without a refetch.
      setBase((prev) => (prev ? mergeControlState(prev, out) : prev));
      setBaseConfig((prev) => (prev ? mergeConfig(prev, director) : prev));
      // The route returns the clamped result, which is the truth to show.
      if (savedGame) setBaseCrossword(savedGame);
      setPending({});
      setPendingDirector({});
      setPendingCrossword({});
      setConflictKeys([]);
    })();
  }, [dirty, saving, pending, pendingDirector, pendingCrossword, socket, sceneId]);

  const discard = useCallback(() => {
    setPending({});
    setPendingDirector({});
    setPendingCrossword({});
    setConflictKeys([]);
    setSaveError(null);
  }, []);

  // Leaving with staged edits loses them — the browser's own prompt is the only
  // guard that catches a closed tab as well as a followed link.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Built plainly, not memoized: every field below is provider state, so a
  // memo's deps would cover everything that can change and it could never hit.
  const value: SceneDraftValue = {
    sceneId,
    surface,
    ready,
    state,
    config,
    stage,
    stageDirector,
    crossword,
    stageCrossword,
    pending,
    pendingDirector,
    pendingCrossword,
    dirty,
    conflictKeys,
    saving,
    saveError,
    save,
    discard,
  };

  return (
    <SceneDraftContext.Provider value={value}>
      <SceneLiveFollow sceneId={sceneId} onLive={applyLive} />
      {children}
    </SceneDraftContext.Provider>
  );
}

/**
 * Subscribes to this channel's live SCENE_STATE and hands each delta up. Its own
 * component so the subscription stays out of the provider body, which is about
 * data. `useSocket` defaults to a null socket, so a test (or any page without a
 * SocketProvider) simply gets no live follow rather than an error.
 */
function SceneLiveFollow({
  sceneId,
  onLive,
}: {
  sceneId: string;
  onLive: (over: Partial<ControlState>) => void;
}) {
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) return;
    const onScene = (payload: SceneStatePayload) => {
      if (!payload || payload.id !== sceneId || !payload.state) return;
      onLive(payload.state as Partial<ControlState>);
    };
    socket.on(SCENE_STATE, onScene);
    return () => {
      socket.off(SCENE_STATE, onScene);
    };
  }, [socket, sceneId, onLive]);

  return null;
}
