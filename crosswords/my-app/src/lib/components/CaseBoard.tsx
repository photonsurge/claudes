import React, { useMemo } from "react";
import { GameState, Id, Mystery } from "../mystery/types";
import { getNode } from "../mystery/getNode";



const isVisible = (m: Mystery, s: GameState, id: Id) =>
  s.unlocked.locations.has(id) ||
  s.unlocked.suspects.has(id) ||
  s.unlocked.clues.has(id) ||
  s.unlocked.events.has(id);

export const CaseBoard: React.FC<{
  mystery: Mystery;
  state: GameState;
  onCommand?: (text: string) => void;
}> = ({ mystery: m, state: s, onCommand }) => {
  const visibleIds = useMemo(() => {
    const all = [
      ...Object.keys(m.locations),
      ...Object.keys(m.suspects),
      ...Object.keys(m.clues),
      ...Object.keys(m.events),
    ] as Id[];
    return all.filter((id) => isVisible(m, s, id));
  }, [m, s]);

  const visibleLinks = useMemo(
    () => m.links.filter((l) => isVisible(m, s, l.from) && isVisible(m, s, l.to)),
    [m, s]
  );

  const handleClick = (id: Id) => {
    if (!onCommand) return;
    const node = getNode(m, id);
    if (!node) return;

    if (node.kind === "location") onCommand(`go ${node.name}`);
    else if (node.kind === "suspect") onCommand(`talk to ${node.name}`);
    else onCommand(`inspect ${node.name}`);
  };

  return (
    <div
      style={{
        width: "100%",
        height: "min(70vh, 520px)",
        minHeight: 300,
        borderRadius: 16,
        overflow: "hidden",
        border: "1px solid #ddd",
      }}
    >
      <svg viewBox="0 0 900 500" width="100%" height="100%">
        {visibleLinks.map((l, idx) => {
          const a = getNode(m, l.from)?.pos ?? { x: 40, y: 40 };
          const b = getNode(m, l.to)?.pos ?? { x: 40, y: 40 };
          return (
            <g key={idx}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={2} />
              {l.label ? (
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6} fontSize={12}>
                  {l.label}
                </text>
              ) : null}
            </g>
          );
        })}

        {visibleIds.map((id) => {
          const node = getNode(m, id);
          if (!node) return null;

          const p = node.pos ?? { x: 40, y: 40 };
          const label = node.name;

          const w = node.kind === "suspect" ? 200 : node.kind === "location" ? 180 : 170;
          const h = 56;
          const rx = 12;

          const isCurrentLocation = node.kind === "location" && s.locationId === node.id;

          return (
            <g
              key={id}
              transform={`translate(${p.x - w / 2}, ${p.y - h / 2})`}
              style={{ cursor: onCommand ? "pointer" : "default" }}
              onClick={() => handleClick(id)}
            >
              <rect x={0} y={0} width={w} height={h} rx={rx} strokeWidth={2} fill="white" />
              {isCurrentLocation ? (
                <rect x={4} y={4} width={w - 8} height={h - 8} rx={rx - 2} fill="none" strokeWidth={2} />
              ) : null}

              <text x={12} y={22} fontSize={12} opacity={0.7}>
                {node.kind.toUpperCase()}
              </text>
              <text x={12} y={42} fontSize={14}>
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
