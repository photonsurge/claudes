"use client";

/**
 * Cold start + re-sync for state the broadcast pages read from the API and
 * then follow over the socket. /watch runs unattended inside OBS browser
 * sources for days: the one-shot `fetch().then(setState)` it used to do left
 * a page that cold-started into a deploy / outage window (5xx, refused) on
 * DEFAULT_CONTROL_STATE — audio off, every look at its default — for the rest
 * of its life, because nothing ever asked again. And the socket relay does not
 * replay what a page missed while disconnected, so the same page drifted from
 * the operator's state after every blip.
 *
 * `load` is run through retryUntil on mount (and when `deps` change) until it
 * lands, and run again on every socket (re)connect: the persisted doc is the
 * only way back to the operator's live state after a gap. Cancels the in-flight
 * loop on unmount / dep change / a fresh connect, so a late result can't land
 * on a newer scene.
 */
import { useEffect, useRef, type DependencyList } from "react";
import { retryUntil } from "./retry";

type SocketLike = {
  on: (event: string, fn: () => void) => unknown;
  off: (event: string, fn: () => void) => unknown;
} | null;

export function useLoadAndResync<T>(
  socket: SocketLike,
  load: () => Promise<T | null | undefined>,
  onValue: (value: T) => void,
  deps: DependencyList,
): void {
  // Latest callbacks without re-running the effect (callers pass inline fns).
  const loadRef = useRef(load);
  const onValueRef = useRef(onValue);
  loadRef.current = load;
  onValueRef.current = onValue;

  // Cold start: retried until it lands.
  useEffect(() => {
    return retryUntil(
      () => loadRef.current(),
      (v) => onValueRef.current(v),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Re-sync on every (re)connect. Also fires on the first connect, which closes
  // the gap between the cold fetch and the socket coming up.
  useEffect(() => {
    if (!socket) return;
    let stop: (() => void) | null = null;
    const resync = () => {
      stop?.();
      stop = retryUntil(
        () => loadRef.current(),
        (v) => onValueRef.current(v),
      );
    };
    socket.on("connect", resync);
    return () => {
      stop?.();
      socket.off("connect", resync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, ...deps]);
}
