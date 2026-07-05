/**
 * A minimal SeedLink (multi-station mode) TCP client. SeedLink has no npm
 * client that works from plain Node `net` (the maintained JS libraries target
 * browser WebSocket/ringserver bridges), so this hand-rolls just the ASCII
 * handshake + binary packet framing this app needs: `STATION`/`SELECT` per
 * channel, `END` to start streaming, then a stream of `SL<6-hex-seq>` headers
 * each immediately followed by one fixed-length miniSEED record. Framing and
 * record length (512 bytes) were validated against real bytes captured live
 * from IRIS's `rtserve.iris.washington.edu:18000`.
 */
import { EventEmitter } from "events";
import { Socket } from "net";
import { log } from "@photonsurge/shared/utill/logger";

const TAG = "seedlink";
const RECORD_LEN = 512;
const PACKET_LEN = 8 + RECORD_LEN;
const RECONNECT_MIN_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
/** No response to a handshake line within this window — treat the link as dead. */
const HANDSHAKE_TIMEOUT_MS = 15_000;

export interface SeedLinkChannel {
  net: string;
  sta: string;
  loc: string;
  cha: string;
}

const chanKey = (c: SeedLinkChannel) => `${c.net}.${c.sta}.${c.loc}.${c.cha}`;

/**
 * Emits `record` (Buffer, one miniSEED record) as they stream in, `error`,
 * and `status` (a short string, for logging). Reconnects with backoff and
 * automatically re-runs the handshake for whatever channel set was last set
 * via `setChannels` — callers don't need to handle reconnection themselves.
 */
export class SeedLinkClient extends EventEmitter {
  private readonly host: string;
  private readonly port: number;
  private socket: Socket | null = null;
  private channels: SeedLinkChannel[] = [];
  private stopped = false;
  private reconnectMs = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: { host: string; port: number }) {
    super();
    this.host = opts.host;
    this.port = opts.port;
  }

  /** Set the desired channel set. Reconnects (re-handshaking) iff it actually changed. */
  setChannels(channels: SeedLinkChannel[]): void {
    const nextKeys = channels.map(chanKey).sort().join(",");
    const currKeys = this.channels.map(chanKey).sort().join(",");
    this.channels = channels;
    if (nextKeys === currKeys) return;
    if (!channels.length) {
      this.teardown();
      return;
    }
    this.stopped = false;
    this.reconnectMs = RECONNECT_MIN_MS;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.teardown();
  }

  private teardown(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
    this.socket?.destroy();
    this.socket = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.channels.length) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectMs);
    this.reconnectMs = Math.min(this.reconnectMs * 2, RECONNECT_MAX_MS);
  }

  private connect(): void {
    if (this.stopped || !this.channels.length) return;
    this.teardown();

    const socket = new Socket();
    this.socket = socket;
    let ascii = "";
    let handshakeDone = false;
    let binaryBuf = Buffer.alloc(0);
    let stationIdx = 0;
    let awaiting: "station" | "select" = "station";

    const clearHandshakeTimer = () => {
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    };
    const armHandshakeTimer = () => {
      clearHandshakeTimer();
      this.handshakeTimer = setTimeout(() => {
        this.emit("status", `handshake timed out awaiting ${awaiting}`);
        socket.destroy();
      }, HANDSHAKE_TIMEOUT_MS);
    };

    // `END` is not acknowledged — per the SeedLink protocol the server starts
    // streaming binary data immediately once all STATION/SELECT pairs are in,
    // so we flip to binary mode the instant we send it rather than waiting
    // for a response line that will never come.
    const sendNextHandshakeLine = () => {
      if (stationIdx >= this.channels.length) {
        socket.write("END\r");
        handshakeDone = true;
        clearHandshakeTimer();
        this.reconnectMs = RECONNECT_MIN_MS;
        this.emit("status", `streaming ${this.channels.length} channel(s)`);
        return;
      }
      const c = this.channels[stationIdx];
      awaiting = "station";
      socket.write(`STATION ${c.sta} ${c.net}\r`);
    };

    armHandshakeTimer();
    socket.connect(this.port, this.host, () => {
      this.emit("status", `connected ${this.host}:${this.port}`);
      sendNextHandshakeLine();
    });

    const drainBinary = () => {
      while (binaryBuf.length >= PACKET_LEN) {
        const record = binaryBuf.subarray(8, PACKET_LEN);
        binaryBuf = binaryBuf.subarray(PACKET_LEN);
        this.emit("record", Buffer.from(record));
      }
    };

    socket.on("data", (chunk: Buffer) => {
      if (handshakeDone) {
        binaryBuf = Buffer.concat([binaryBuf, chunk]);
        drainBinary();
        return;
      }

      ascii += chunk.toString("latin1");
      let idx: number;
      // eslint-disable-next-line no-cond-assign
      while (!handshakeDone && (idx = ascii.indexOf("\r\n")) !== -1) {
        const line = ascii.slice(0, idx);
        ascii = ascii.slice(idx + 2);
        if (line.startsWith("ERROR")) {
          this.emit("status", `handshake error: ${line}`);
          socket.destroy();
          return;
        }
        if (line.startsWith("OK")) {
          armHandshakeTimer();
          if (awaiting === "station") {
            const c = this.channels[stationIdx];
            awaiting = "select";
            // Combined "LLCCC.T" selector — location+channel+type — so a
            // station with several co-located sensors (e.g. ANMO's "00"/"10")
            // streams only the one location code we actually asked for.
            socket.write(`SELECT ${(c.loc || "??").padEnd(2, "?")}${c.cha}.D\r`);
          } else if (awaiting === "select") {
            stationIdx++;
            sendNextHandshakeLine(); // may flip handshakeDone -> true (sends END)
          }
        }
      }
      // The handshake may have just completed mid-chunk (the last SELECT's
      // "OK\r\n" triggered END): whatever's left in `ascii` is actually the
      // start of the binary stream, not a stray handshake line.
      if (handshakeDone && ascii.length) {
        binaryBuf = Buffer.concat([binaryBuf, Buffer.from(ascii, "latin1")]);
        ascii = "";
        drainBinary();
      }
    });

    socket.on("error", (err: Error) => {
      this.emit("status", `socket error: ${err.message}`);
    });

    socket.on("close", () => {
      clearHandshakeTimer();
      if (this.socket === socket) this.socket = null;
      this.scheduleReconnect();
    });
  }
}
