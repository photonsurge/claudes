"use client";
import React, { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { Box, IconButton, InputAdornment, Typography } from "@mui/material";
import TextField, { TextFieldProps } from "@mui/material/TextField";
import { useFormContext, Controller } from "react-hook-form";
import MicIcon from "@mui/icons-material/Mic";
import StopIcon from "@mui/icons-material/Stop";
import { fieldHolder } from "./general";
import { getFieldError } from "./getFieldError";
import { assertVoiceBrowser, recordSegmentsBySilence } from "./audio";

interface iTextFieldProps {
    label: string;
    id?: string;
    name: string;
    type?: "text" | "password";
    helperText: string;
    autoComplete?: boolean;
    ml?: boolean
}


const sendChunk = async (chunk: Blob, index: number) => {
    const ext = chunk.type.includes("mp4") ? "mp4" : "webm";
    const fd = new FormData();
    fd.append("audio", chunk, `chunk-${index}.${ext}`);

    const res = await fetch("/api/transcribe", { method: "POST", body: fd });
    if (!res.ok) throw new Error(await res.text());

    const data = await res.json();
    return data.text as string;
};

const joinWords = (a: string, b: string) => {
    const A = (a ?? "").trim();
    const B = (b ?? "").trim();
    if (!A) return B;
    if (!B) return A;
    return `${A} ${B}`;
};

// Preserve newlines + spaces in overlay
const OverlayText = ({
    committed,
    interim,
}: {
    committed: string;
    interim: string;
}) => {
    return (
        <Typography
            component="div"
            sx={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                // match MUI input default text rendering
                font: "inherit",
                lineHeight: "inherit",
                letterSpacing: "inherit",
            }}
        >
            <span>{committed}</span>
            {interim ? (
                <>
                    {committed ? <span>{" "}</span> : null}
                    <span style={{ opacity: 0.75, fontStyle: "italic" }}>{interim}</span>
                </>
            ) : null}
        </Typography>
    );
};

const PSTextFieldAudio = ({ label, name, type = "text", helperText, id, ml = false }: iTextFieldProps) => {
    if (!id) id = `inpt_${name}`;

    const {
        control,
        formState,
        formState: { errors },
    } = useFormContext();

    const sessionRef = useRef(0);        // 👈 increments to invalidate async work
    const autoCompleteAttr = type === "password" ? "new-password" : "off";

    const recorderCtlRef = useRef<{ start: () => void; stop: () => void } | null>(null);
    const isRecordingRef = useRef(false);
    const [isRecording, setIsRecording] = useState(false);

    // Interim transcript while recording (NOT committed until stop)
    const [interimText, setInterimText] = useState("");

    // Avoid overlapping fetches
    const seqRef = useRef(Promise.resolve());

    // RHF access from async land
    const onChangeRef = useRef<(val: any) => void>(() => { });
    const getValueRef = useRef<() => string>(() => "");

    // We need the textarea DOM node to sync scroll for overlay
    const inputElRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
    const overlayScrollRef = useRef<HTMLDivElement | null>(null);

    const syncScroll = useCallback(() => {
        const input = inputElRef.current as HTMLTextAreaElement | null;
        const overlay = overlayScrollRef.current;
        if (!input || !overlay) return;

        overlay.scrollTop = input.scrollTop;
        overlay.scrollLeft = input.scrollLeft;
    }, []);

    const commitInterimToField = useCallback(() => {
        const interim = (interimText ?? "").trim();
        if (!interim) return;

        const current = (getValueRef.current?.() ?? "").trim();
        const next = joinWords(current, interim);

        onChangeRef.current?.(next);
        setInterimText("");
    }, [interimText]);

    const stopRecording = useCallback(() => {
        if (!isRecordingRef.current) return;

        // invalidate in-flight chunks immediately
        sessionRef.current += 1;

        isRecordingRef.current = false;
        setIsRecording(false);

        try {
            recorderCtlRef.current?.stop();
        } finally {
            recorderCtlRef.current = null;
        }

        commitInterimToField();
        void seqRef.current.finally(() => commitInterimToField());
    }, [commitInterimToField]);



    const startRecording = useCallback(async () => {
        if (isRecordingRef.current) return;
        if (!assertVoiceBrowser()) return;

        setInterimText("");
        isRecordingRef.current = true;
        setIsRecording(true);

        const mySession = ++sessionRef.current; // 👈 unique session for this recording run

        const ctl = await recordSegmentsBySilence({
            threshold: 0.018,
            silenceMsToCut: 650,
            maxSegmentMs: 12000,
            onSegment: async (blob, i) => {
                try {
                    const t = await sendChunk(blob, i);

                    // 👇 ignore chunks from old sessions (e.g. after reset/submit)
                    if (sessionRef.current !== mySession) return;

                    const current = (getValueRef.current?.() ?? "").trim();
                    const next = joinWords(current, (t ?? "").trim());
                    onChangeRef.current?.(next);
                } catch {
                    // swallow per-chunk errors (optional)
                }
            },
        });

        // if user stopped/reset while we were awaiting setup
        if (sessionRef.current !== mySession) {
            try { ctl.stop(); } catch { }
            return;
        }

        recorderCtlRef.current = ctl;
        ctl.start();
    }, []);


    useEffect(() => {
        return () => {
            try {
                stopRecording();
            } catch { }
        };
    }, [stopRecording]);

    // keep overlay scroll synced (textarea scroll + resize)
    useEffect(() => {
        const input = inputElRef.current as HTMLTextAreaElement | null;
        if (!input) return;

        const onScroll = () => syncScroll();
        input.addEventListener("scroll", onScroll);
        return () => input.removeEventListener("scroll", onScroll);
    }, [syncScroll]);

    useEffect(() => {
        if (!formState.isSubmitSuccessful) return;

        // invalidate any in-flight transcription callbacks
        sessionRef.current += 1;

        // stop mic + clear overlay state
        try { stopRecording(); } catch { }
        setInterimText("");
    }, [formState.isSubmitSuccessful, stopRecording]);
    return (
        <Controller
            name={name}
            control={control}
            render={({ field }) => {
                onChangeRef.current = field.onChange;
                getValueRef.current = () => (field.value ?? "");

                const { message, hasError } = getFieldError(errors, name);
                const hText: string = message ?? helperText;

                const committed = (field.value ?? "") as string;
                const showOverlay = isRecording && !!interimText.trim();

                // What the actual input holds while recording:
                // committed + interim (so user can select/copy it)
                const displayValue = showOverlay ? joinWords(committed, interimText) : committed;

                const EndButton = () => (
                    <IconButton
                        onMouseDown={(e: any) => {
                            e.preventDefault();
                            void startRecording();
                        }}
                        onMouseUp={(e: any) => {
                            e.preventDefault();
                            stopRecording();
                        }}
                        onMouseLeave={(e: any) => {
                            e.preventDefault();
                            stopRecording();
                        }}
                        onTouchStart={(e: any) => {
                            e.preventDefault();
                            void startRecording();
                        }}
                        onTouchEnd={(e: any) => {
                            e.preventDefault();
                            stopRecording();
                        }}
                        title={isRecording ? "Recording…" : "Hold to talk"}
                    >
                        {isRecording ? <StopIcon /> : <MicIcon />}
                    </IconButton>
                );

                const textFieldProps: TextFieldProps = {
                    value: displayValue,
                    onChange: (event: React.ChangeEvent<HTMLInputElement>) => field.onChange(event.target.value),
                    type,
                    error: hasError,
                    label,
                    multiline: ml,
                    helperText: isRecording ? "Listening… release to commit." : hText,
                    autoComplete: autoCompleteAttr,
                    slotProps: {
                        input: {
                            autoComplete: autoCompleteAttr,
                            autoCapitalize: "off",
                            autoCorrect: "off",
                            spellCheck: false,
                            endAdornment: (
                                <InputAdornment position="end">
                                    <EndButton />
                                </InputAdornment>
                            ),
                            inputRef: (el: any) => {
                                // MUI gives us the input/textarea element here
                                inputElRef.current = el;
                                // initial sync
                                syncScroll();
                            },
                        },
                    } as any,
                    sx: {
                        // When overlay is active:
                        // - hide actual text, keep caret visible
                        // - overlay will show the styled text
                        ...(showOverlay
                            ? {
                                "& .MuiInputBase-input": {
                                    color: "transparent",
                                    caretColor: "text.primary",
                                },
                            }
                            : {}),
                    },
                };

                return (
                    <Box sx={{ ...fieldHolder, position: "relative" }}>
                        {/* Overlay (only when interim is present) */}
                        {showOverlay && (
                            <Box
                                ref={overlayScrollRef}
                                aria-hidden
                                sx={{
                                    position: "absolute",
                                    inset: 0,
                                    // match TextField padding/geometry:
                                    pointerEvents: "none",
                                    overflow: "hidden",
                                    zIndex: 1,
                                }}
                            >
                                {/* This inner box matches the input padding, so text lines up */}
                                <Box
                                    sx={{
                                        // These paddings match OutlinedInput default-ish;
                                        // if your theme differs, tweak these 2 lines.
                                        px: 1.75,
                                        py: 2,
                                        // ensure it uses the same typography as the input
                                        font: "inherit",
                                        lineHeight: "inherit",
                                    }}
                                >
                                    <OverlayText committed={committed} interim={interimText} />
                                </Box>
                            </Box>
                        )}

                        {/* Actual input (sits under overlay when active) */}
                        <TextField
                            id={id}
                            name={name}
                            fullWidth
                            {...textFieldProps}
                            // Ensure it sits above the overlay container’s background but below overlay text
                            sx={{
                                ...(textFieldProps.sx as any),
                                position: "relative",
                                zIndex: 2,
                            }}
                            onScroll={() => syncScroll()}
                        />
                    </Box>
                );
            }}
        />
    );
};

export default PSTextFieldAudio;
