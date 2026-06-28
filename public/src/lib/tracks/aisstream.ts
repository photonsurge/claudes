import type { Ship } from "./types";

/**
 * AIS via aisstream.io — a websocket stream, not a REST endpoint, so we open a
 * short-lived connection, subscribe to a bounding box, collect PositionReports
 * for a few seconds, dedupe by MMSI and return a snapshot. Requires a free
 * AISSTREAM_API_KEY. Node 20+ provides a global WebSocket.
 */
interface AisMessage {
  MessageType?: string;
  MetaData?: { MMSI?: number | string; ShipName?: string; latitude?: number; longitude?: number };
  Message?: { PositionReport?: { Latitude?: number; Longitude?: number; Sog?: number; Cog?: number; TrueHeading?: number } };
}

/** Map one aisstream PositionReport message to a Ship, or null. Pure. */
export function parsePositionReport(raw: unknown): Ship | null {
  const msg = raw as AisMessage;
  const meta = msg?.MetaData;
  const pr = msg?.Message?.PositionReport;
  if (!meta || !pr) return null;

  const lat = typeof meta.latitude === "number" ? meta.latitude : pr.Latitude;
  const lng = typeof meta.longitude === "number" ? meta.longitude : pr.Longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (meta.MMSI == null) return null;

  const name = typeof meta.ShipName === "string" ? meta.ShipName.trim() : "";
  return {
    mmsi: String(meta.MMSI),
    name: name || undefined,
    lat,
    lng,
    sogKn: typeof pr.Sog === "number" ? pr.Sog : undefined,
    cogDeg: typeof pr.Cog === "number" ? pr.Cog : undefined,
    headingDeg: typeof pr.TrueHeading === "number" && pr.TrueHeading !== 511 ? pr.TrueHeading : undefined,
  };
}

/** Collect a snapshot of vessels in `bbox` [w,s,e,n] over `ms` milliseconds. */
export function collectShips(
  apiKey: string,
  bbox: [number, number, number, number],
  ms = 4000,
): Promise<Ship[]> {
  const [w, s, e, n] = bbox;
  return new Promise((resolve) => {
    const ships = new Map<string, Ship>();
    let ws: WebSocket;
    try {
      ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    } catch {
      return resolve([]);
    }

    const finish = () => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve([...ships.values()]);
    };
    const timer = setTimeout(finish, ms);

    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          APIKey: apiKey,
          // aisstream wants [[SW],[NE]] as [lat, lon].
          BoundingBoxes: [[[s, w], [n, e]]],
          FilterMessageTypes: ["PositionReport"],
        }),
      );
    ws.onmessage = (ev: MessageEvent) => {
      let data: unknown;
      try {
        data = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      const ship = parsePositionReport(data);
      if (ship) ships.set(ship.mmsi, ship);
    };
    ws.onerror = finish;
  });
}
