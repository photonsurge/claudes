"use client";

/**
 * React context that owns the browser's Socket.IO connection. Mints a short-lived
 * JWT from /api/auth/socket-token, connects to the socket server as actor "user"
 * (joining the "public" room), and exposes `{ socket, connected }` via useSocket().
 * Mounted once in app/layout.tsx so /watch and /control share one connection for
 * `control:state` / `weather:run` events.
 *
 * Built to survive days unattended inside an OBS browser source:
 *  - the token mint is retried until it lands (a cold start into a deploy /
 *    outage window used to leave the page with no socket for its whole life);
 *  - the token is minted PER CONNECTION ATTEMPT: it lives 1h and the server
 *    rejects an expired one in the handshake, so a static auth object killed
 *    every reconnect after the first hour;
 *  - a denied handshake (or a server-side disconnect) stops socket.io's own
 *    reconnection, so the provider re-opens the socket itself after a backoff.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { backoffDelayMs, retryUntil } from "./retry";

type SocketState = {
  socket: Socket | null;
  connected: boolean;
};

const SocketContext = createContext<SocketState>({ socket: null, connected: false });

export const useSocket = () => useContext(SocketContext);

/**
 * Mint a socket JWT (plus the socket URL for this host). Null on any failure so
 * a retry loop goes again.
 */
export async function fetchSocketToken(): Promise<{ token: string; socketUrl: string } | null> {
  try {
    const res = await fetch("/api/auth/socket-token", { cache: "no-store" });
    if (!res.ok) return null;
    const { token, socketUrl } = await res.json();
    return token && socketUrl ? { token, socketUrl } : null;
  } catch {
    return null;
  }
}

/**
 * Connects the browser to the socket server. Fetches a short-lived JWT from
 * /api/auth/socket-token, then opens the connection as actorType "user".
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let active: Socket | null = null;
    let reopenTimer: ReturnType<typeof setTimeout> | undefined;
    let denied = 0;

    const stop = retryUntil(fetchSocketToken, ({ token, socketUrl }) => {
      let lastToken = token;
      const s = io(socketUrl, {
        transports: ["websocket"],
        // Fresh token per attempt; if the mint fails the previous one is sent
        // (a denied handshake is then re-tried below with another mint).
        auth: (cb) => {
          fetchSocketToken().then((t) => {
            if (t) lastToken = t.token;
            cb({ token: lastToken, actorType: "user" });
          });
        },
        reconnection: true,
      });
      active = s;

      // socket.io gives up (`s.active` false) when the server denied the
      // handshake or disconnected us on purpose; re-open ourselves, backing off.
      const reopenIfGivenUp = () => {
        if (s.active) return;
        clearTimeout(reopenTimer);
        reopenTimer = setTimeout(() => s.connect(), backoffDelayMs(denied++));
      };
      s.on("connect", () => {
        denied = 0;
        setConnected(true);
      });
      s.on("disconnect", () => {
        setConnected(false);
        reopenIfGivenUp();
      });
      s.on("connect_error", reopenIfGivenUp);
      setSocket(s);
    });

    return () => {
      stop();
      clearTimeout(reopenTimer);
      active?.disconnect();
      setSocket(null);
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, connected }}>{children}</SocketContext.Provider>
  );
}
