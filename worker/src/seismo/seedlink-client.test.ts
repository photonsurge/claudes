import { createServer, Server, Socket } from "net";
import { SeedLinkClient } from "./seedlink-client";

/** A fake SeedLink server: acks STATION/SELECT with "OK\r\n", then on "END\r"
 *  starts writing whatever packets the test queues, in whatever chunking the
 *  test asks for (to exercise the client's cross-chunk record framing). */
function startFakeServer(): Promise<{ server: Server; port: number; onEnd: (write: (conn: Socket) => void) => void }> {
  return new Promise((resolve) => {
    let onEndCb: ((conn: Socket) => void) | null = null;
    const server = createServer((conn) => {
      let buf = "";
      conn.on("data", (chunk) => {
        buf += chunk.toString("latin1");
        let idx: number;
        // eslint-disable-next-line no-cond-assign
        while ((idx = buf.indexOf("\r")) !== -1) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line.startsWith("STATION") || line.startsWith("SELECT")) {
            conn.write("OK\r\n");
          } else if (line.startsWith("END")) {
            onEndCb?.(conn);
          }
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ server, port, onEnd: (cb) => (onEndCb = cb) });
    });
  });
}

/** Build one fake SeedLink packet: 8-byte "SL"+seq header + a 512-byte "record". */
function fakePacket(fill: number): Buffer {
  const header = Buffer.from("SL000001", "latin1");
  const record = Buffer.alloc(512, fill);
  return Buffer.concat([header, record]);
}

describe("SeedLinkClient", () => {
  let ctx: Awaited<ReturnType<typeof startFakeServer>>;

  beforeEach(async () => {
    ctx = await startFakeServer();
  });

  afterEach(() => {
    ctx.server.close();
  });

  it("performs STATION/SELECT per channel then END, in order", async () => {
    const lines: string[] = [];
    const server2 = createServer((conn) => {
      let buf = "";
      conn.on("data", (chunk) => {
        buf += chunk.toString("latin1");
        let idx: number;
        // eslint-disable-next-line no-cond-assign
        while ((idx = buf.indexOf("\r")) !== -1) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          lines.push(line);
          if (line.startsWith("STATION") || line.startsWith("SELECT")) conn.write("OK\r\n");
        }
      });
    });
    await new Promise<void>((resolve) => server2.listen(0, "127.0.0.1", resolve));
    const port = (server2.address() as { port: number }).port;

    const client = new SeedLinkClient({ host: "127.0.0.1", port });
    const streaming = new Promise<void>((resolve) => client.on("status", (s: string) => s.startsWith("streaming") && resolve()));
    client.setChannels([
      { net: "IU", sta: "ANMO", loc: "00", cha: "BHZ" },
      { net: "II", sta: "AAK", loc: "", cha: "BHZ" },
    ]);
    await streaming;
    // The client emits "streaming" the instant it calls socket.write("END\r"),
    // which doesn't guarantee the bytes have reached the server yet — give
    // the loopback connection a tick to actually deliver them before asserting.
    await new Promise((r) => setTimeout(r, 20));
    client.stop();
    server2.close();

    expect(lines).toEqual([
      "STATION ANMO IU",
      "SELECT 00BHZ.D",
      "STATION AAK II",
      "SELECT ??BHZ.D",
      "END",
    ]);
  });

  it("emits one record per packet, even when a packet is split across many small chunks", async () => {
    const client = new SeedLinkClient({ host: "127.0.0.1", port: ctx.port });
    const records: Buffer[] = [];
    client.on("record", (rec: Buffer) => records.push(rec));

    const streamed = new Promise<void>((resolve) => {
      ctx.onEnd((conn) => {
        const packet = fakePacket(0xab);
        // Dribble the 520-byte packet out in small, oddly-sized chunks to
        // exercise the cross-chunk buffering, split right across a record
        // boundary by writing two back-to-back packets in one uneven stream.
        const two = Buffer.concat([packet, fakePacket(0xcd)]);
        let offset = 0;
        const step = () => {
          if (offset >= two.length) {
            resolve();
            return;
          }
          const n = Math.min(7, two.length - offset);
          conn.write(two.subarray(offset, offset + n));
          offset += n;
          setImmediate(step);
        };
        step();
      });
    });

    client.setChannels([{ net: "IU", sta: "ANMO", loc: "00", cha: "BHZ" }]);
    await streamed;
    await new Promise((r) => setTimeout(r, 50));
    client.stop();

    expect(records).toHaveLength(2);
    expect(records[0].every((b) => b === 0xab)).toBe(true);
    expect(records[1].every((b) => b === 0xcd)).toBe(true);
    expect(records[0]).toHaveLength(512);
  });

  it("setChannels to the same set is a no-op (no reconnect)", async () => {
    const client = new SeedLinkClient({ host: "127.0.0.1", port: ctx.port });
    const statuses: string[] = [];
    client.on("status", (s: string) => statuses.push(s));
    const channels = [{ net: "IU", sta: "ANMO", loc: "00", cha: "BHZ" }];

    const streaming = new Promise<void>((resolve) => client.on("status", (s: string) => s.startsWith("streaming") && resolve()));
    client.setChannels(channels);
    await streaming;
    const connectCountBefore = statuses.filter((s) => s.startsWith("connected")).length;
    client.setChannels([...channels]); // same content, new array identity
    await new Promise((r) => setTimeout(r, 20));
    const connectCountAfter = statuses.filter((s) => s.startsWith("connected")).length;

    client.stop();
    expect(connectCountAfter).toBe(connectCountBefore);
  });
});
