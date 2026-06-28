"use client";

/**
 * React context that owns the browser's Socket.IO connection. Mints a short-lived
 * JWT from /api/auth/socket-token, connects to the socket server as actor "user"
 * (joining the "public" room), and exposes `{ socket, connected }` via useSocket().
 * Mounted once in app/layout.tsx so /watch and /control share one connection for
 * `control:state` / `weather:run` events.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";

type SocketState = {
  socket: Socket | null;
  connected: boolean;
};

const SocketContext = createContext<SocketState>({ socket: null, connected: false });

export const useSocket = () => useContext(SocketContext);

/**
 * Connects the browser to the socket server. Fetches a short-lived JWT from
 * /api/auth/socket-token, then opens the connection as actorType "user".
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let active: Socket | null = null;

    (async () => {
      const res = await fetch("/api/auth/socket-token");
      const { token, socketUrl } = await res.json();
      if (cancelled || !token) return;

      active = io(socketUrl, {
        transports: ["websocket"],
        auth: { token, actorType: "user" },
        reconnection: true,
      });

      active.on("connect", () => setConnected(true));
      active.on("disconnect", () => setConnected(false));
      setSocket(active);
    })();

    return () => {
      cancelled = true;
      active?.disconnect();
      setSocket(null);
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, connected }}>{children}</SocketContext.Provider>
  );
}
