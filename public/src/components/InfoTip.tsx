"use client";

/** Small "?" badge with a native title tooltip — hover context for a section
 *  header without cluttering the layout with inline prose. */
export default function InfoTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 14,
        height: 14,
        borderRadius: "50%",
        border: "1px solid currentColor",
        opacity: 0.55,
        fontSize: 10,
        fontWeight: 700,
        marginLeft: 5,
        cursor: "help",
        flexShrink: 0,
      }}
    >
      ?
    </span>
  );
}
