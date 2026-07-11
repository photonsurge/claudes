"use client";

/**
 * The admin surface's first reusable overlay dialog — a centred panel over a
 * blurred backdrop, closable by Escape, backdrop click, or the × button. Lifted
 * from the one-off "debug" modal that lived inline in the alerts list so every
 * edit popover shares the same chrome + a11y (`role="dialog" aria-modal`).
 */
import { useEffect } from "react";
import type { ReactNode } from "react";

export default function EditModal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 1040,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Lock body scroll while the modal is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        // Backdrop click closes; clicks inside the panel don't bubble here.
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "5vh 16px",
        background: "rgba(4,7,13,0.62)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        overflowY: "auto",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: width,
          background: "#0c111c",
          border: "1px solid #1b2030",
          borderRadius: 12,
          boxShadow: "0 24px 70px rgba(0,0,0,0.6)",
          color: "#e6edf7",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "14px 18px",
            borderBottom: "1px solid #1b2030",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.2 }}>{title}</div>
            {subtitle ? <div style={{ fontSize: 12.5, color: "#8b95a7", marginTop: 3 }}>{subtitle}</div> : null}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              flexShrink: 0,
              background: "none",
              border: "1px solid #2a3344",
              color: "#cdd4e0",
              borderRadius: 6,
              width: 30,
              height: 30,
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </header>

        <div style={{ padding: 18 }}>{children}</div>

        {footer ? (
          <footer
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 10,
              padding: "12px 18px",
              borderTop: "1px solid #1b2030",
            }}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
