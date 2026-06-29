"use client";

/**
 * <DebugButton> — a dev-only "🐛 Debug" affordance that pops a modal showing any
 * value as syntax-highlighted JSON, with copy + fullscreen. Hidden unless the
 * debug UI is enabled (see useDebugUI / Ctrl+Shift+D) or `alwaysShow` is passed.
 * Ported from ../../hydra and rewritten for this app's plain-React/inline-style
 * stack (no MUI).
 */
import React, { useCallback, useState } from "react";
import { useDebugUI } from "./debug-ui";

type DebugButtonProps = {
  title?: string;
  data: unknown;
  alwaysShow?: boolean;
  tooltip?: string;
  iconOnly?: boolean;
  style?: React.CSSProperties;
};

const colorizeJson = (json: string): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  // Tokenize JSON string into colored spans
  const regex =
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[{}[\],])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(json)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<span key={key++}>{json.slice(lastIndex, match.index)}</span>);
    }
    const token = match[0];
    let color: string;
    if (/^"/.test(token)) {
      color = token.endsWith(":") ? "#9cdcfe" : "#ce9178"; // key vs string value
    } else if (/true|false/.test(token)) {
      color = "#569cd6";
    } else if (token === "null") {
      color = "#808080";
    } else if (/^-?\d/.test(token)) {
      color = "#b5cea8";
    } else {
      color = "#d4d4d4"; // punctuation
    }
    nodes.push(
      <span key={key++} style={{ color }}>
        {token}
      </span>
    );
    lastIndex = match.index + token.length;
  }
  if (lastIndex < json.length) {
    nodes.push(<span key={key++}>{json.slice(lastIndex)}</span>);
  }
  return nodes;
};

const iconBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: 1,
  padding: 4,
  borderRadius: 4,
  color: "#9cdcfe",
};

export const DebugButton: React.FC<DebugButtonProps> = ({
  title,
  data,
  alwaysShow = false,
  tooltip,
  iconOnly = false,
  style,
}) => {
  const [open, setOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { showDebugUI } = useDebugUI();
  const showDebug = alwaysShow || showDebugUI;

  const jsonStr = JSON.stringify(data, null, 2);

  const handleOpen = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setOpen(true);
  };
  const handleClose = () => {
    setOpen(false);
    setFullscreen(false);
  };

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(jsonStr).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [jsonStr]);

  if (!showDebug) return null;

  const label = title || "Debug";
  const tooltipLabel = tooltip || `View ${label.toLowerCase()} data`;

  const trigger = iconOnly ? (
    <button
      type="button"
      title={tooltipLabel}
      onClick={handleOpen}
      style={{ ...iconBtnStyle, ...style }}
    >
      🐛
    </button>
  ) : (
    <button
      type="button"
      title={tooltipLabel}
      onClick={handleOpen}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: "transparent",
        border: "1px solid #569cd6",
        color: "#9cdcfe",
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 13,
        cursor: "pointer",
        ...style,
      }}
    >
      🐛 {label}
    </button>
  );

  const modalBoxStyle: React.CSSProperties = fullscreen
    ? {
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        background: "#1e1e1e",
        display: "flex",
        flexDirection: "column",
      }
    : {
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(95vw, 900px)",
        height: "85vh",
        background: "#1e1e1e",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
      };

  return (
    <>
      {trigger}
      {open && (
        <div
          onClick={handleClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 99999,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={modalBoxStyle}>
            {/* Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 16px",
                borderBottom: "1px solid #333",
                gap: 8,
                flexShrink: 0,
              }}
            >
              <span style={{ color: "#569cd6", fontSize: 16 }}>🐛</span>
              <span
                style={{
                  color: "#d4d4d4",
                  fontFamily: "monospace",
                  fontWeight: 600,
                  flex: 1,
                }}
              >
                {label} Data
              </span>
              <button
                type="button"
                title={copied ? "Copied!" : "Copy JSON"}
                onClick={handleCopy}
                style={{ ...iconBtnStyle, color: copied ? "#4caf50" : "#9cdcfe" }}
              >
                {copied ? "✓" : "⧉"}
              </button>
              <button
                type="button"
                title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                onClick={() => setFullscreen((f) => !f)}
                style={iconBtnStyle}
              >
                {fullscreen ? "⤡" : "⤢"}
              </button>
              <button
                type="button"
                title="Close"
                onClick={handleClose}
                style={iconBtnStyle}
              >
                ✕
              </button>
            </div>
            {/* JSON body */}
            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              <pre
                style={{
                  margin: 0,
                  fontSize: 13,
                  lineHeight: 1.6,
                  fontFamily:
                    "'Fira Code', 'Cascadia Code', 'Consolas', monospace",
                  background: "transparent",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {colorizeJson(jsonStr)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
