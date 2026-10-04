/**
 * Client side of the crossword channel's watch page (`/crossword/:id`).
 *
 * The worker owns the game and emits only its public projection
 * (CrosswordPublicState, no unsolved answers in it). This page cold-starts that
 * projection from `/api/crossword/:id/state`, then follows CROSSWORD_STATE over
 * the socket. CROSSWORD_BEAT (`{ sceneId, seq, serverNow }` every 5 s) does two
 * jobs: it keeps the clock offset fresh, and a `seq` that differs from the one
 * on screen means a state was missed (socket blip) so the route is asked again.
 *
 * Countdowns are drawn from `spotlight.endsAt` / `phaseEndsAt`, which are
 * server times, so every one goes through the offset: local now + offset is
 * the server's now, whatever the encoder box's clock says.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CROSSWORD_BEAT,
  CROSSWORD_STATE,
  type CrosswordBeat,
  type CrosswordPublicState,
  type CrosswordTheme,
  DEFAULT_CROSSWORD_THEME,
  sanitizeCrosswordTheme,
} from "@photonsurge/shared/crossword";
import { sceneSurface, outputPath, type SceneSurface } from "@photonsurge/shared/control";
import { useSocket } from "./socket-provider";
import { useLoadAndResync } from "./use-resync";
import { listScenes } from "./scenes";

// ---------------------------------------------------------------- clock

/** Server clock minus local clock, from a `serverNow` received at `receivedAt`. */
export const clockOffset = (serverNow: number, receivedAt: number = Date.now()) => serverNow - receivedAt;

/** Ms left until the server time `endsAt`, never negative. */
export function remainingMs(endsAt: number, offset: number, now: number = Date.now()): number {
  return Math.max(0, endsAt - (now + offset));
}

/** "0:24" / "1:05" for a countdown, rounded up so it reads 0:01 until it is over. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The socket server relays a worker event as its whole envelope
 * (`{ type, data, createdAt }`), so the payload is under `data`. A bare
 * payload is accepted too.
 */
export function unwrapWorkerEvent<T extends { sceneId: string }>(msg: unknown): T | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as { sceneId?: unknown; data?: unknown };
  if (typeof m.sceneId === "string") return msg as T;
  const d = m.data as { sceneId?: unknown } | undefined;
  return d && typeof d === "object" && typeof d.sceneId === "string" ? (d as T) : null;
}

/** True when a beat says the state on screen is not the latest (a missed CROSSWORD_STATE). */
export const beatNeedsResync = (shownSeq: number | null, beat: Pick<CrosswordBeat, "seq">) =>
  shownSeq !== null && beat.seq !== shownSeq;

// ---------------------------------------------------------------- fetch

export type CrosswordFetch =
  | { kind: "ok"; state: CrosswordPublicState; theme: CrosswordTheme; receivedAt: number }
  | { kind: "tokenError" }
  | { kind: "notCrossword" }
  | { kind: "failed" };

/** One read of the state route. 401 → tokenError, 404 → notCrossword (both final). */
export async function fetchCrosswordState(sceneId: string, token?: string): Promise<CrosswordFetch> {
  try {
    const qs = token ? `?token=${encodeURIComponent(token)}` : "";
    const res = await fetch(`/api/crossword/${encodeURIComponent(sceneId)}/state${qs}`, { cache: "no-store" });
    if (res.status === 401) return { kind: "tokenError" };
    if (res.status === 404) return { kind: "notCrossword" };
    if (!res.ok) return { kind: "failed" };
    // The route sends the channel's theme beside the projection; it is not part of the state.
    const { theme, ...state } = (await res.json()) as CrosswordPublicState & { theme?: unknown };
    return typeof state.seq === "number"
      ? { kind: "ok", state, theme: sanitizeCrosswordTheme(theme, DEFAULT_CROSSWORD_THEME), receivedAt: Date.now() }
      : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

/** `fetchCrosswordState` shaped for retryUntil: null on a transient failure. */
const loadCrosswordState = (sceneId: string, token?: string) =>
  fetchCrosswordState(sceneId, token).then((r) => (r.kind === "failed" ? null : r));

// ---------------------------------------------------------------- hook

export interface CrosswordView {
  state: CrosswordPublicState | null;
  /** The channel's look (config.theme), from the last read of the state route. */
  theme: CrosswordTheme;
  /** Server clock minus local clock (see remainingMs). */
  offset: number;
  ready: boolean;
  tokenError: boolean;
  /** The route says this scene is not a crossword channel. */
  notCrossword: boolean;
}

/**
 * A crossword scene's live public state: cold start (retried, re-run on every
 * socket reconnect), CROSSWORD_STATE for this scene, and a refetch when a beat's
 * `seq` differs from the one on screen.
 */
export function useCrosswordState(sceneId: string, token?: string): CrosswordView {
  const { socket } = useSocket();
  const [view, setView] = useState<CrosswordView>({
    state: null,
    theme: DEFAULT_CROSSWORD_THEME,
    offset: 0,
    ready: false,
    tokenError: false,
    notCrossword: false,
  });
  const seqRef = useRef<number | null>(null);
  const inflight = useRef(false);

  const apply = (r: Exclude<CrosswordFetch, { kind: "failed" }>) => {
    if (r.kind === "ok") {
      seqRef.current = r.state.seq;
      setView({
        state: r.state,
        theme: r.theme,
        offset: clockOffset(r.state.serverNow, r.receivedAt),
        ready: true,
        tokenError: false,
        notCrossword: false,
      });
    } else {
      seqRef.current = null;
      setView((v) => ({ ...v, ready: true, tokenError: r.kind === "tokenError", notCrossword: r.kind === "notCrossword" }));
    }
  };

  useEffect(() => {
    seqRef.current = null;
    setView({ state: null, theme: DEFAULT_CROSSWORD_THEME, offset: 0, ready: false, tokenError: false, notCrossword: false });
  }, [sceneId, token]);

  useLoadAndResync(socket, () => loadCrosswordState(sceneId, token), apply, [sceneId, token]);

  useEffect(() => {
    if (!socket) return;
    const onState = (msg: CrosswordPublicState | { data?: CrosswordPublicState }) => {
      const pub = unwrapWorkerEvent<CrosswordPublicState>(msg);
      if (!pub || pub.sceneId !== sceneId || seqRef.current === null) return;
      seqRef.current = pub.seq;
      const offset = clockOffset(pub.serverNow);
      setView((v) => ({ ...v, state: pub, offset }));
    };
    const onBeat = (msg: CrosswordBeat | { data?: CrosswordBeat }) => {
      const beat = unwrapWorkerEvent<CrosswordBeat>(msg);
      if (!beat || beat.sceneId !== sceneId || seqRef.current === null) return;
      const offset = clockOffset(beat.serverNow);
      setView((v) => (Math.abs(v.offset - offset) < 250 ? v : { ...v, offset }));
      if (!beatNeedsResync(seqRef.current, beat) || inflight.current) return;
      // Fail soft: the board on screen stays until a good read lands; the next
      // beat tries again if this one fails.
      inflight.current = true;
      fetchCrosswordState(sceneId, token)
        .then((r) => {
          if (r.kind !== "failed") apply(r);
        })
        .finally(() => {
          inflight.current = false;
        });
    };
    socket.on(CROSSWORD_STATE, onState);
    socket.on(CROSSWORD_BEAT, onBeat);
    return () => {
      socket.off(CROSSWORD_STATE, onState);
      socket.off(CROSSWORD_BEAT, onBeat);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, sceneId, token]);

  return view;
}

// ---------------------------------------------------------------- routing

/** Where a scene opened on the `here` watch route belongs instead, or null if it is home. */
export function surfaceRedirect(
  scene: { id: string; surface?: unknown } | undefined,
  here: SceneSurface,
  search: string,
): string | null {
  if (!scene || sceneSurface(scene) === here) return null;
  return `${outputPath(scene)}${search ? `?${search.replace(/^\?/, "")}` : ""}`;
}

/**
 * Send a scene opened on the wrong watch route (a crossword scene on
 * `/watch/:id`, or a globe one on `/crossword/:id`) to its own page,
 * keeping the query (token, `obs=1`). True while a redirect is under way, so
 * the caller can render nothing. One read of `/api/scenes`; if it fails the
 * page simply stays where it is.
 */
export function useSurfaceRedirect(sceneId: string, here: SceneSurface): boolean {
  const router = useRouter();
  const search = useSearchParams()?.toString() ?? "";
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listScenes().then((scenes) => {
      if (!live) return;
      setTarget(surfaceRedirect(scenes.find((s) => s.id === sceneId), here, search));
    });
    return () => {
      live = false;
    };
  }, [sceneId, here, search]);

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  return target !== null;
}
