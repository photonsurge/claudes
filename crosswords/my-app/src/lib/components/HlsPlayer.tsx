"use client";

import React, { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

type HlsPlayerProps = {
    src: string;              // e.g. https://preview.yourdomain.com/live/stream/index.m3u8
    autoPlay?: boolean;
    muted?: boolean;
    controls?: boolean;
    className?: string;
};

const HlsPlayer: React.FC<HlsPlayerProps> = ({
    src,
    autoPlay = true,
    muted = true,
    controls = true,
    className,
}) => {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const hlsRef = useRef<Hls | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        setError(null);

        // Safari (and some browsers) can play HLS natively
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = src;
            const onError = () => setError("Video element failed to load HLS.");
            video.addEventListener("error", onError);

            if (autoPlay) {
                // autoplay generally requires muted=true
                video.play().catch(() => { });
            }

            return () => {
                video.removeEventListener("error", onError);
                video.src = "";
            };
        }

        // Everyone else: use hls.js
        if (!Hls.isSupported()) {
            setError("HLS is not supported in this browser.");
            return;
        }

        const hls = new Hls({
            lowLatencyMode: true,

            liveSyncDurationCount: 1,        // stay close to live edge
            liveMaxLatencyDurationCount: 3,  // if we drift too far, pull back
            maxBufferLength: 3,
            maxMaxBufferLength: 6,
            backBufferLength: 30,
            // If you ever need custom headers/auth, we can add xhrSetup here
        });

        hlsRef.current = hls;

        hls.attachMedia(video);
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
            hls.loadSource(src);
        });

        hls.on(Hls.Events.ERROR, (_evt, data) => {
            // non-fatal errors can recover; fatal ones we surface
            if (data?.fatal) {
                setError(`HLS fatal error: ${data.type}`);
                try {
                    hls.destroy();
                } catch { }
                hlsRef.current = null;
            }
        });

        if (autoPlay) {
            video.play().catch(() => { });
        }

        return () => {
            try {
                hls.destroy();
            } catch { }
            hlsRef.current = null;
            video.src = "";
        };
    }, [src, autoPlay]);

    return (
        <div className={className}>
            <video
                ref={videoRef}
                controls={controls}
                autoPlay={autoPlay}
                muted={muted}
                playsInline
                style={{ width: "100%", height: "auto" }}
            />
            {error && (
                <div style={{ marginTop: 8, fontSize: 14 }}>
                    <strong>Stream error:</strong> {error}
                </div>
            )}
        </div>
    );
};

export default HlsPlayer;
