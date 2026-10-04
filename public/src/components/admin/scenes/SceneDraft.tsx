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
 * /api/scenes/:id, `stageDirector` → PATCH /api/director/:scene/config. Both
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
 * A short FORMAT's editor (/admin/shorts/formats/:id, docs/short-video-plan.md
 * §5.5) passes `formatId`: the draft then owns a THIRD document, the format's
 * short settings (`ShortFormat`, PUT /api/shorts/formats/:id). It loads with the
 * other two, stages through `stageFormat` (whole top-level fields, like the
 * other buckets) and is written by the SAME Save — still one Save for the page.
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
} from "@photonsurge/shared/control";
import { DEFAULT_DIRECTOR_CONFIG, type DirectorConfig } from "@photonsurge/shared/director";
import type { ShortFormat } from "@photonsurge/shared/short-format";
import { emitScenePatch, fetchSceneState, patchScene } from "../../../lib/scenes";
import { getShortFormat, saveShortFormat, type ShortFormatPatch } from "../../../lib/short-formats";
import { fetchDirectorConfig, mergeConfig, patchDirectorConfig } from "../../../lib/director";
import { useSocket } from "../../../lib/socket-provider";

export type SceneDraftValue = {
  sceneId: string;
  /** Both documents have loaded. Cards render only once this is true. */
  ready: boolean;
  /** Server ControlState with the staged delta merged on top — what cards render. */
  state: ControlState;
  /** Server DirectorConfig with its staged delta merged on top. */
  config: DirectorConfig;
  /** Stage a ControlState delta. No sceneId: the provider knows which channel. */
  stage: (patch: Partial<ControlState>) => void;
  /** Stage a DirectorConfig delta for the same Save. */
  stageDirector: (patch: Partial<DirectorConfig>) => void;
  /** A format editor's third document — the short settings with their staged
   *  delta merged on top. Null on a channel page (no `formatId`). */
  format: ShortFormat | null;
  /** Stage a short-settings delta for the same Save (format editor only). */
  stageFormat: (patch: ShortFormatPatch) => void;
  /** The staged deltas themselves — the Save bar names what they touch. */
  pending: Partial<ControlState>;
  pendingDirector: Partial<DirectorConfig>;
  pendingFormat: ShortFormatPatch;
  dirty: boolean;
  /** Staged fields the operator's desk has ALSO changed since they were staged. */
  conflictKeys: readonly string[];
  saving: boolean;
  saveError: string | null;
  /** A document that couldn't be read (a format editor's short settings) — the
   *  page says so instead of waiting on `ready` forever. */
  loadError?: string | null;
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
  formatId,
  children,
}: {
  sceneId: string;
  /** A short format's editor: also load and save this format's short settings. */
  formatId?: string;
  children: ReactNode;
}) {
  const { socket } = useSocket();

  // The server documents, as last read (cold start + live SCENE_STATE).
  const [base, setBase] = useState<ControlState | null>(null);
  const [baseConfig, setBaseConfig] = useState<DirectorConfig | null>(null);
  // The staged deltas.
  const [pending, setPending] = useState<Partial<ControlState>>({});
  const [pendingDirector, setPendingDirector] = useState<Partial<DirectorConfig>>({});
  const [baseFormat, setBaseFormat] = useState<ShortFormat | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [pendingFormat, setPendingFormat] = useState<ShortFormatPatch>({});
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
    setPending({});
    setPendingDirector({});
    setBaseFormat(null);
    setFormatError(null);
    setPendingFormat({});
    setConflictKeys([]);
    if (formatId) {
      getShortFormat(formatId).then((res) => {
        if (cancelled) return;
        if (res.ok) setBaseFormat(res.data);
        else setFormatError(res.error);
      });
    }
    fetchSceneState(sceneId).then(({ state: s }) => {
      if (!cancelled) setBase(s);
    });
    fetchDirectorConfig(sceneId).then((c) => {
      if (!cancelled) setBaseConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, [sceneId, formatId]);

  const stage = useCallback((over: Partial<ControlState>) => {
    setPending((prev) => ({ ...prev, ...over }));
    setSaveError(null);
  }, []);

  const stageDirector = useCallback((over: Partial<DirectorConfig>) => {
    setPendingDirector((prev) => ({ ...prev, ...over }));
    setSaveError(null);
  }, []);

  const stageFormat = useCallback((over: ShortFormatPatch) => {
    setPendingFormat((prev) => ({ ...prev, ...over }));
    setSaveError(null);
  }, []);

  /** A live change from the desk: adopt it, unless it hits a staged field. */
  const applyLive = useCallback((over: Partial<ControlState>) => {
    const staged = Object.keys(pendingRef.current);
    const hit = Object.keys(over).filter((k) => staged.includes(k));
    if (hit.length > 0) setConflictKeys((prev) => [...new Set([...prev, ...hit])]);
    setBase((prev) => (prev ? mergeControlState(prev, over) : prev));
  }, []);

  const ready = base !== null && baseConfig !== null && (!formatId || baseFormat !== null);

  const state = useMemo(
    () => (base ? mergeControlState(base, pending) : DEFAULT_CONTROL_STATE),
    [base, pending],
  );
  const config = useMemo(
    () => (baseConfig ? mergeConfig(baseConfig, pendingDirector) : DEFAULT_DIRECTOR_CONFIG),
    [baseConfig, pendingDirector],
  );

  const format = useMemo(
    () => (baseFormat ? ({ ...baseFormat, ...pendingFormat } as ShortFormat) : null),
    [baseFormat, pendingFormat],
  );

  const dirty =
    Object.keys(pending).length > 0 ||
    Object.keys(pendingDirector).length > 0 ||
    Object.keys(pendingFormat).length > 0;

  const save = useCallback(() => {
    if (!dirty || saving) return;
    // Checked before anything is written, so the one Save stays all or nothing.
    const staged = (pendingFormat as { template?: { scope?: { type?: string; places?: unknown[] } } }).template?.scope;
    if (staged?.type === "places" && !staged.places?.length) {
      setSaveError("Several places: add at least one place before saving.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const out = { ...pending };
    // spinEpoch means "camera motion restarts NOW" — restamp it at apply time,
    // not at the click that staged it minutes earlier.
    if ("spinEpoch" in out) out.spinEpoch = Date.now();
    const director = { ...pendingDirector };
    const shortSettings = { ...pendingFormat };

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
      let savedFormat: ShortFormat | null = null;
      if (formatId && Object.keys(shortSettings).length > 0) {
        try {
          savedFormat = await saveShortFormat(formatId, shortSettings);
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
      // The server's copy, sanitised (clamped numbers, trimmed text) — the truth.
      if (savedFormat) setBaseFormat(savedFormat);
      setPending({});
      setPendingDirector({});
      setPendingFormat({});
      setConflictKeys([]);
    })();
  }, [dirty, saving, pending, pendingDirector, pendingFormat, formatId, socket, sceneId]);

  const discard = useCallback(() => {
    setPending({});
    setPendingDirector({});
    setPendingFormat({});
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
    ready,
    state,
    config,
    stage,
    stageDirector,
    format,
    stageFormat,
    pending,
    pendingDirector,
    pendingFormat,
    dirty,
    conflictKeys,
    saving,
    saveError,
    loadError: formatError,
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
