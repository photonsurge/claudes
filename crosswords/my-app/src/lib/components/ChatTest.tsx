"use client"

import { Box, Grid, Paper, Stack, Typography } from "@mui/material"
import PSSimpleFormProvider from "../hook-form/SimpleFormProvider";
import PSTextFieldAudio from "../hook-form/TextFieldAudio";
import PSSubmit from "../hook-form/Submit";
import { useSocket } from "../useSocket";
import { useEffect, useState } from "react";
import { SvgFromString } from "./SvgFromString";
import ChatMessage, { iChatMessage } from "./ChatMessage";
import { ChatContainer } from "./ChatContainer";


const splitSentences = (t: string) =>
    t.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/g).filter(Boolean);

const fetchAudioBlob = async (sentence: string) => {
    const fd = new FormData();
    fd.append("text", sentence);
    fd.append("language", "en");
    const res = await fetch("/api/tts", { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());
    return await res.blob();
};

export const speakChunked = async (text: string) => {
    const sentences = splitSentences(text);

    for (const s of sentences) {
        const blob = await fetchAudioBlob(s);
        const url = URL.createObjectURL(blob);

        await new Promise<void>((resolve, reject) => {
            const audio = new Audio(url);
            audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
            audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error("audio failed")); };
            audio.play().catch(reject);
        });
    }
};



const ChatTest = () => {
    const { socket, connected } = useSocket();
    const [messages, setMessages] = useState<iChatMessage[]>([]);

    
    const [svg, setSvg] = useState()

    useEffect(() => {
        socket.on("message", (msg: iChatMessage) => {
            console.log("message", msg)
          //  if (msg.from === 'server' || msg.from === 'puzzle-master') {
                speakChunked(msg.text)
           // }
            setMessages(prev => [...prev, msg]);
        });
        socket.on("svg", (msg: any) => {
            console.log("SVG", msg)
            setSvg(msg.svg);
        });



        return () => {
            socket.off("message");
            socket.off("svg");
        };
    }, [socket]);

    const sendMessage = (d: any) => {
        socket.emit("message", d);
    };


    const joinGame = (d: any) => {

        console.log("emit:joinGame", socket)
        socket.emit("joinGame", { name: d.name })

    }
    const blank = { text: "" };
    return <Box>
        <Typography variant="h4" sx={{ mb: 1 }}>Crossword Chat</Typography>

        {/* <Button fullWidth onClick={join}>joinGame</Button> */}
        <Box sx={{ width: "100%" }}>

            {svg ? <Stack gap={1.5}>
                <Grid container spacing={1.5}>
                    <Grid size={{ xs: 12, md: 5 }}>
                        <Paper variant="outlined" sx={{ p: 1 }}>
                          <SvgFromString svg={svg} />
                        </Paper>
                    </Grid>

                    <Grid size={{ xs: 12, md: 7 }}>
                        <ChatContainer>
                            {messages.map((d, index) => {
                                return <ChatMessage key={index} text={d.text} from={d.from} ts={d.ts} />
                            })}
                        </ChatContainer>
                    </Grid>

                </Grid>


                <PSSimpleFormProvider clearOnSubmit values={blank} onSubmit={sendMessage}>
                    <PSTextFieldAudio name="text" label="" helperText="" />
                    <PSSubmit title="Send" />
                </PSSimpleFormProvider>

            </Stack> : <Box >


                <PSSimpleFormProvider values={{ text: '' }} onSubmit={joinGame}>
                    <PSTextFieldAudio name="name" label="Name" helperText="" />
                    <PSSubmit title="Join Game" />
                </PSSimpleFormProvider>
            </Box>}
        </Box>

    </Box>
}


export default ChatTest;
