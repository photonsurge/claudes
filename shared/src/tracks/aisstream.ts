import type { Ship } from "./types";

/**
 * AIS via aisstream.io — a websocket stream, not REST. We open a short-lived
 * connection, subscribe to a bounding box, collect PositionReports for a few
 * seconds, dedupe by MMSI and return a snapshot. Requires AISSTREAM_API_KEY.
 * Node 20+ provides a global WebSocket; typed loosely here since shared has no
 * DOM lib.
 */
interface AisMessage {
  MessageType?: string;
  MetaData?: { MMSI?: number | string; ShipName?: string; latitude?: number; longitude?: number };
  Message?: { PositionReport?: { Latitude?: number; Longitude?: number; Sog?: number; Cog?: number; TrueHeading?: number } };
}

/**
 * Decode a websocket frame to text. Node's global WebSocket delivers binary as
 * ArrayBuffer (when binaryType is set) or Buffer; browsers may give a string.
 * Returns "" for anything we can't decode synchronously (e.g. a stray Blob).
 */
export function decodeFrame(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data as ArrayBufferView);
  return "";
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

type Bbox = [number, number, number, number];

/**
 * Collect a snapshot of vessels over `ms` milliseconds. `boxes` is one bbox
 * [w,s,e,n] or several (subscribed together on a single connection). aisstream
 * wants each box as [[SW],[NE]] in [lat,lon].
 */
export function collectShips(apiKey: string, boxes: Bbox | Bbox[], ms = 4000): Promise<Ship[]> {
  const list: Bbox[] = Array.isArray(boxes[0]) ? (boxes as Bbox[]) : [boxes as Bbox];
  const boundingBoxes = list.map(([w, s, e, n]) => [[s, w], [n, e]]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const WS: any = (globalThis as any).WebSocket;
  return new Promise((resolve) => {
    if (!WS) return resolve([]);
    const ships = new Map<string, Ship>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let ws: any;
    try {
      ws = new WS("wss://stream.aisstream.io/v0/stream");
    } catch {
      return resolve([]);
    }
    // Node's global WebSocket (undici) delivers frames as Blob by default;
    // ask for ArrayBuffer so we can decode synchronously in onmessage.
    try {
      ws.binaryType = "arraybuffer";
    } catch {
      /* browsers/other impls may differ */
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
          BoundingBoxes: boundingBoxes,
          FilterMessageTypes: ["PositionReport"],
        }),
      );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ws.onmessage = (ev: any) => {
      const text = decodeFrame(ev.data);
      if (!text) return;
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        return;
      }
      const ship = parsePositionReport(data);
      if (ship) ships.set(ship.mmsi, ship);
    };
    ws.onerror = finish;
  });
}
