"use client";

export default function WebRTCPlayer() {
  return (
    <div
      style={{
        width: "100%",
        aspectRatio: "16 / 9",
        background: "#000",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <iframe
        src="https://mercury.photonsurge.uk/live/stream/"
        allow="autoplay; fullscreen; picture-in-picture"
        style={{
          width: "100%",
          height: "100%",
          border: 0,
        }}
      />
    </div>
  );
}
