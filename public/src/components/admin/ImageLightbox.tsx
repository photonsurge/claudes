"use client";

import { useEffect } from "react";

export interface LightboxImage {
  src: string;
  alt: string;
  caption?: string;
}

export default function ImageLightbox({ image, onClose }: { image: LightboxImage; onClose: () => void }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        display: "grid",
        gridTemplateRows: "1fr auto",
        placeItems: "center",
        padding: 24,
        boxSizing: "border-box",
        background: "rgba(2, 4, 10, 0.96)",
        backdropFilter: "blur(8px)",
      }}
    >
      <button
        type="button"
        aria-label="Close image preview"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        style={{
          position: "fixed",
          top: 18,
          right: 20,
          zIndex: 1,
          width: 42,
          height: 42,
          border: "1px solid #475569",
          borderRadius: 999,
          color: "#f8fafc",
          background: "rgba(15, 23, 42, 0.85)",
          fontSize: 25,
          lineHeight: 1,
          cursor: "pointer",
        }}
      >
        ×
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.src}
        alt={image.alt}
        onClick={(event) => event.stopPropagation()}
        style={{ maxWidth: "100%", maxHeight: "calc(100vh - 90px)", objectFit: "contain", borderRadius: 8 }}
      />
      {image.caption && (
        <div onClick={(event) => event.stopPropagation()} style={{ color: "#cbd5e1", fontSize: 13, paddingTop: 12 }}>
          {image.caption}
        </div>
      )}
    </div>
  );
}
