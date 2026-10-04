"use client"

import { useEffect, useState } from "react";
import { useSocket } from "../useSocket";
import { speakChunked } from "../tts/speakChunked";
import { iChatMessage } from "./ChatMessage";
const WatcherTest = () => {
    const { socket, connected } = useSocket();
    const [svg, setSvg] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (!socket) return;

        const onSvg = (msg: any) => {
            console.log("SVG", msg);
            setSvg(msg.svg);
        };

        const onMessage = (msg: iChatMessage) => {
            console.log("message", msg);

            // Optional: ignore empty
            if (!msg?.text?.trim()) return;

            speakChunked(msg.text).catch((e) => console.error("TTS failed", e));
        };

        // 🔑 Make this idempotent (safe even if effect runs twice)
        socket.off("svg", onSvg);
        socket.off("message", onMessage);

        socket.on("svg", onSvg);
        socket.on("message", onMessage);

        return () => {
            socket.off("svg", onSvg);
            socket.off("message", onMessage);
        };
    }, [socket]);

    useEffect(() => {
        if (!socket || !connected) return;

        socket.emit("getWatcher", {
            role: "watcher",
            name: "Watcher",
        });
    }, [socket, connected]);

    return (
        <div dangerouslySetInnerHTML={{ __html: svg ?? "" }} />
    );
};
export default WatcherTest
