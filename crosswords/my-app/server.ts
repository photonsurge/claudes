import http, { createServer } from "http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { io } from "socket.io-client";


type ParsedCommand =
    | { kind: "play"; cell: string; value: string; raw: string }
    | { kind: "clue"; cell: string; raw: string }
    | { kind: "restart"; raw: string }
    | { kind: "chat"; raw: string };


const CELL_RE = /\b([A-Z])\s*(\d{1,2})\b/i;

// phrases that mean "not a play", even though they contain a cell
const NON_PLAY_HINT_RE = /\b(clue|hint|help|what\s+is|what's|give\s+me|show)\b/i;
const RESTART_RE = /\b(restart|reset|new\s+game|start\s+over)\b/i;
export const parseGameMessage = (input: string): ParsedCommand => {
    const raw = input;
    const text = input.trim();
    const lower = text.toLowerCase();

    // ---- restart / reset (global command)
    if (RESTART_RE.test(lower)) {
        return { kind: "restart", raw };
    }

    // find a cell anywhere
    const m = text.match(CELL_RE);
    const cell = m ? `${m[1].toUpperCase()}${m[2]}` : undefined;

    // explicit clue intent
    if (cell && /\bclue\b/i.test(text)) {
        return { kind: "clue", cell, raw };
    }

    // explicit play intent
    if (cell && /^\s*play\b/i.test(text)) {
        const value = text
            .replace(/^\s*play\b/i, "")
            .replace(m![0], "")
            .trim();

        if (value) return { kind: "play", cell, value, raw };
        return { kind: "chat", raw };
    }

    // shortcut: "A2 word"
    if (cell && !NON_PLAY_HINT_RE.test(lower)) {
        const afterCell = text
            .slice((m!.index ?? 0) + m![0].length)
            .trim();

        if (afterCell) {
            const value = afterCell.replace(/^[\:\-]+/, "").trim();
            if (value) return { kind: "play", cell, value, raw };
        }
    }

    return { kind: "chat", raw };
};

type Player = {
    name: string;
};

const players = new Map<string, Player>();




const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev });
const handle = app.getRequestHandler();

let svg: string | undefined = undefined

app.prepare().then(() => {
    const server = createServer((req, res) => handle(req, res));

    const crosswordSocket = io("http://192.168.0.179:3001", { transports: ["websocket"] });


    crosswordSocket.on("connect", () => {
        console.log("connected", crosswordSocket.id);


    });

    crosswordSocket.on("connect_error", (e) => {
        console.error("connect_error", e.message);

    });

    crosswordSocket.on('startSvg', (d) => {
        console.log("Svg from Game", d.svg)
        svg = d.svg;
    })


    const play = (socketID: string, ref: string, word: string) => {
        const userName = players.get(socketID)?.name
        crosswordSocket.emit("guess", { userID: socketID, ref, word, userName });
    }
    const clue = (socketID: string, ref: string) => {
        const userName = players.get(socketID)?.name
        crosswordSocket.emit("clue", { userID: socketID, ref, userName });
    }
    const restart = (socketID: string) => {
        crosswordSocket.emit("restart", { socketID });
    }


    const clientServer = new SocketIOServer(server, {
        path: "/socket.io",
        cors: {
            origin: dev ? true : undefined, // lock this down in prod if needed
            credentials: true,
        },
    });
    crosswordSocket.on('svg', (d) => {
        console.log("Svg from Game", d.svg)
        svg = d.svg;
        clientServer.emit('svg', d)
    })
    crosswordSocket.on('message', (d) => {
        console.log("message from Game", d)
        clientServer.emit('message', d)
    })


    clientServer.on("connection", (socket) => {
        console.log("socket connected:", socket.id);
        // socket.onAny((event, ...args) => {
        //     console.log(`[${socket.id}] onAny ->`, event, args);
        // });


        //socket.emit("message", "hello from server");
        socket.on("joinGame", ({ name }: any) => {
            console.log("enterGame", name, svg)
            players.set(socket.id, { name });
            socket.emit("svg", { svg })
            socket.emit('message', { text: "Welcome to the game!", from: "server", ts: new Date(Date.now()) })
        });
        socket.on("getWatcher", ({ name }: any) => {
            console.log("enterGame", name, svg)
            socket.emit("svg", { svg })
        });
        socket.on("message", (msg: any) => {
            console.log("message", msg)
            const player = players.get(socket.id);
            if (!player) {
                console.log("not in game")
                return;
            }


            clientServer.emit("message", { ...msg, from: player.name, ts: new Date(Date.now()) }); //emit to all

            const cmd = parseGameMessage(msg.text);

            if (cmd.kind === "play") {
                console.log("play", cmd)
                play(socket.id, cmd.cell, cmd.value)
            }

            if (cmd.kind === "clue") {
                console.log("clue", cmd)
                clue(socket.id, cmd.cell)
            }

            // else ignore / treat as chat
            if (cmd.kind === "restart") {
                console.log("restart", cmd)
                restart(socket.id)
            }


            // broadcast
        });

        socket.on("disconnect", () => {
            console.log("socket disconnected:", socket.id);
            players.delete(socket.id);
        });
    });

    server.listen(port, () => {
        console.log(`> Ready on http://localhost:${port}`);
    });
});
