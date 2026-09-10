import { instanceVars, plateFor, type Instance } from "../lib/instance";

/**
 * "You are on the test box." A hairline of the instance's colour across the top
 * of the window plus a small label riding it.
 *
 * Used by the operator surfaces that aren't /admin (the launcher, /control,
 * /login) — /admin says the same thing through its own top bar instead, and
 * /watch says nothing at all, ever: it is the broadcast output.
 *
 * Fixed and `pointer-events: none` so it can never take a click off a control
 * underneath it. `align` keeps it out of whatever the page already puts in a
 * corner (the /control globe has its legend top-left and reports top-right, so
 * that page centres the label).
 */
export default function InstanceMark({
  instance,
  align = "right",
}: {
  instance: Instance | null;
  align?: "left" | "center" | "right";
}) {
  if (!instance) return null;

  const anchor =
    align === "left"
      ? { left: 14 }
      : align === "center"
        ? { left: "50%", transform: "translateX(-50%)" }
        : { right: 14 };

  return (
    <>
      <div
        aria-hidden
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: instance.color,
          zIndex: 3000,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "fixed",
          top: 3,
          ...anchor,
          zIndex: 3000,
          pointerEvents: "none",
          padding: "2px 9px 3px",
          borderRadius: "0 0 6px 6px",
          background: plateFor(instance.color),
          borderLeft: `1px solid ${instance.color}`,
          borderRight: `1px solid ${instance.color}`,
          borderBottom: `1px solid ${instance.color}`,
          color: instance.color,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 1,
          lineHeight: 1.3,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {instance.label}
      </div>
    </>
  );
}

/**
 * The mark plus the custom properties its surface paints from
 * (`--inst-page` / `--inst-panel`), for the layouts that wrap a page they don't
 * own the markup of.
 *
 * `display: contents` so the wrapper contributes NO box — /control's `<main>`
 * is a 100vh flex row and must stay a direct child of the layout as far as
 * layout is concerned. Custom properties still inherit from an element with no
 * box, which is the whole trick.
 */
export function InstanceSurface({
  instance,
  align,
  children,
}: {
  instance: Instance | null;
  align?: "left" | "center" | "right";
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "contents", ...instanceVars(instance) } as React.CSSProperties}>
      <InstanceMark instance={instance} align={align} />
      {children}
    </div>
  );
}
