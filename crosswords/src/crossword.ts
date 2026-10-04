/* crossword.ts */

import { CrosswordResult, CrosswordState, Direction, GenerateOptions, GuessResult, iCrosswordWord, Placement, PlacementWithEntry, PlacementWithRef, PlayerCell, Puzzle, ScoreMap } from "./crossword-types";

const colToLetters = (col: number): string => {
  // 0 -> A, 25 -> Z, 26 -> AA, etc.
  let n = col + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export const addA1Refs = (placements: PlacementWithEntry[]): PlacementWithRef[] => {
  return placements.map(p => ({
    ...p,
    startRef: `${colToLetters(p.col)}${p.row + 1}`, // row+1 because humans start at 1
  }));
};
const cleanWordFromObject = (w: iCrosswordWord) =>
  w.word.toUpperCase().replace(/[^A-Z0-9]/g, "");


const cleanWord = (w: string) =>
  w.toUpperCase().replace(/[^A-Z0-9]/g, "");

const makeGrid = (n: number): (string | null)[][] =>
  Array.from({ length: n }, () => Array.from({ length: n }, () => null));

const cloneGrid = (g: (string | null)[][]) => g.map(row => row.slice());

const inBounds = (n: number, r: number, c: number) =>
  r >= 0 && c >= 0 && r < n && c < n;

const cellAt = (g: (string | null)[][], r: number, c: number) =>
  inBounds(g.length, r, c) ? g[r][c] : undefined;

/**
 * Basic crossword legality:
 * - letters must match if intersecting
 * - no overwriting different letters
 * - avoid touching side-by-side parallel words (simple adjacency rule)
 */
const canPlace = (
  grid: (string | null)[][],
  word: string,
  row: number,
  col: number,
  dir: Direction
): { ok: boolean; intersections: number } => {
  const n = grid.length;
  let intersections = 0;

  // Check preceding cell (to avoid extending an existing word)
  const preR = dir === "across" ? row : row - 1;
  const preC = dir === "across" ? col - 1 : col;
  const pre = cellAt(grid, preR, preC);
  if (pre !== undefined && pre !== null) return { ok: false, intersections: 0 };

  // Check trailing cell
  const endR = dir === "across" ? row : row + word.length;
  const endC = dir === "across" ? col + word.length : col;
  const post = cellAt(grid, endR, endC);
  if (post !== undefined && post !== null) return { ok: false, intersections: 0 };

  for (let i = 0; i < word.length; i++) {
    const r = dir === "across" ? row : row + i;
    const c = dir === "across" ? col + i : col;

    if (!inBounds(n, r, c)) return { ok: false, intersections: 0 };

    const existing = grid[r][c];
    if (existing !== null && existing !== word[i]) {
      return { ok: false, intersections: 0 };
    }
    if (existing === word[i]) intersections++;

    // Adjacency rule: for across, above/below should not have letters unless this cell is an intersection.
    // for down, left/right should not have letters unless intersection.
    if (dir === "across") {
      const up = cellAt(grid, r - 1, c);
      const down = cellAt(grid, r + 1, c);
      // If we are placing a fresh letter (not intersecting), avoid touching vertically.
      if (existing === null) {
        if ((up !== undefined && up !== null) || (down !== undefined && down !== null)) {
          return { ok: false, intersections: 0 };
        }
      }
    } else {
      const left = cellAt(grid, r, c - 1);
      const right = cellAt(grid, r, c + 1);
      if (existing === null) {
        if ((left !== undefined && left !== null) || (right !== undefined && right !== null)) {
          return { ok: false, intersections: 0 };
        }
      }
    }
  }

  // Require at least 1 intersection unless it's the first word
  return { ok: true, intersections };
};

const placeWord = (
  grid: (string | null)[][],
  word: string,
  row: number,
  col: number,
  dir: Direction
) => {
  for (let i = 0; i < word.length; i++) {
    const r = dir === "across" ? row : row + i;
    const c = dir === "across" ? col + i : col;
    grid[r][c] = word[i];
  }
};

const findAllCandidatePlacements = (
  grid: (string | null)[][],
  word: string,
  isFirst: boolean
): Array<{ row: number; col: number; dir: Direction; intersections: number }> => {
  const n = grid.length;
  const candidates: Array<{ row: number; col: number; dir: Direction; intersections: number }> = [];

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const cell = grid[r][c];
      if (cell === null && !isFirst) continue;

      // For each index i where word[i] matches this cell, try align across/down.
      for (let i = 0; i < word.length; i++) {
        if (!isFirst && cell !== word[i]) continue;

        // Across alignment: (r, c-i)
        const aRow = r;
        const aCol = c - i;
        if (aCol >= 0 && aCol + word.length <= n) {
          const chk = canPlace(grid, word, aRow, aCol, "across");
          if (chk.ok && (isFirst || chk.intersections >= 1)) {
            candidates.push({ row: aRow, col: aCol, dir: "across", intersections: chk.intersections });
          }
        }

        // Down alignment: (r-i, c)
        const dRow = r - i;
        const dCol = c;
        if (dRow >= 0 && dRow + word.length <= n) {
          const chk = canPlace(grid, word, dRow, dCol, "down");
          if (chk.ok && (isFirst || chk.intersections >= 1)) {
            candidates.push({ row: dRow, col: dCol, dir: "down", intersections: chk.intersections });
          }
        }
      }
    }
  }

  // If first word: allow centered placements even with zero intersections
  if (isFirst && candidates.length === 0) {
    const mid = Math.floor(n / 2);
    const startCol = Math.max(0, mid - Math.floor(word.length / 2));
    const row = mid;
    if (startCol + word.length <= n) {
      const chk = canPlace(grid, word, row, startCol, "across");
      if (chk.ok) candidates.push({ row, col: startCol, dir: "across", intersections: chk.intersections });
    }
  }

  // Sort best first: most intersections, then more central-ish
  candidates.sort((a, b) => {
    if (b.intersections !== a.intersections) return b.intersections - a.intersections;
    const da = Math.abs(a.row - n / 2) + Math.abs(a.col - n / 2);
    const db = Math.abs(b.row - n / 2) + Math.abs(b.col - n / 2);
    return da - db;
  });

  return candidates;
};

const trimToBounds = (
  grid: (string | null)[][],
  pad: number
): { trimmed: (string | null)[][]; offsetRow: number; offsetCol: number } => {
  const n = grid.length;
  let minR = n, minC = n, maxR = -1, maxC = -1;

  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (grid[r][c] !== null) {
      minR = Math.min(minR, r);
      minC = Math.min(minC, c);
      maxR = Math.max(maxR, r);
      maxC = Math.max(maxC, c);
    }
  }

  if (maxR === -1) return { trimmed: [[null]], offsetRow: 0, offsetCol: 0 };

  minR = Math.max(0, minR - pad);
  minC = Math.max(0, minC - pad);
  maxR = Math.min(n - 1, maxR + pad);
  maxC = Math.min(n - 1, maxC + pad);

  const trimmed = [];
  for (let r = minR; r <= maxR; r++) {
    trimmed.push(grid[r].slice(minC, maxC + 1));
  }

  return { trimmed, offsetRow: minR, offsetCol: minC };
};


export const generateCrossword = (
  wordsRaw: iCrosswordWord[],
  options?: GenerateOptions
): CrosswordResult => {

  const wordMap = new Map<string, iCrosswordWord>();

  for (const w of wordsRaw) {
    const cleaned = cleanWordFromObject(w); // IMPORTANT: cleanWord must accept iCrosswordWord and return string
    if (cleaned.length < 2) continue;
    if (!wordMap.has(cleaned)) wordMap.set(cleaned, w);
  }

  const words = Array.from(wordMap.keys()).sort((a, b) => b.length - a.length);

  const maxSize = Math.min(options?.maxSize ?? 15, 26);
  const maxAttempts = options?.maxAttempts ?? 200;
  const pad = options?.pad ?? 1;


  if (words.length === 0) {
    const grid = [[null]];

    return { width: 1, height: 1, grid, placements: [] };
  }

  let best: { grid: (string | null)[][]; placements: Placement[] } | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const grid = makeGrid(maxSize);
    const placements: Placement[] = [];

    const ok = backtrackPlace(grid, placements, words, 0);
    if (ok) {
      best = { grid, placements };
      break;
    }

    // Keep best partial (most words placed)
    if (!best || placements.length > best.placements.length) {
      best = { grid: cloneGrid(grid), placements: placements.slice() };
    }
  }

  const { trimmed, offsetRow, offsetCol } = trimToBounds(best!.grid, pad);

  // Adjust placements to trimmed coordinates
  const adjustedPlacements = best!.placements.map(p => ({
    ...p,
    row: p.row - offsetRow,
    col: p.col - offsetCol,
  }));


  const placementsWithEntry: PlacementWithEntry[] = adjustedPlacements.map(p => {
    const entry = wordMap.get(p.word);
    if (!entry) {
      // should never happen unless cleanWord changed
      throw new Error(`Missing iCrosswordWord for placed word: ${p.word}`);
    }
    return { ...p, entry };
  });
  return {
    width: trimmed[0].length,
    height: trimmed.length,
    grid: trimmed,
    placements: placementsWithEntry,

  };
};
export const renderPlayerGridSVGModern = (
  grid: PlayerCell[][],
  opts?: {
    cellSize?: number;
    showAxis?: boolean;
    title?: string;
    subtitle?: string;
    score?: ScoreMap;
    highlightPlayer?: string; // optional: bold/marker
    overlay?: { title: string; message?: string };
  }
): string => {
  const cellSize = opts?.cellSize ?? 32;
  const showAxis = opts?.showAxis ?? true;

  const h = grid.length;
  const w = grid[0].length;

  const offset = showAxis ? cellSize : 0;
  const headerH = (opts?.title || opts?.subtitle) ? Math.round(cellSize * 1.4) : 0;

  const pad = Math.round(cellSize * 0.45);

  const boardW = offset + w * cellSize;
  const boardH = offset + h * cellSize;

  // ---- Scoreboard sizing (SMALLER + ALWAYS SHOWN)
  const scoreEntries = Object.entries(opts?.score ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  const sbW = Math.round(cellSize * 4.6);     // smaller than before
  const gap = Math.round(cellSize * 0.45);    // tighter gap
  const sbH = boardH;                          // match board height

  const svgW = pad * 2 + boardW + gap + sbW;
  const svgH = pad * 2 + headerH + boardH;

  const boardX = pad;
  const boardY = pad + headerH;

  const sbX = boardX + boardW + gap;
  const sbY = boardY;

  const colToLetters = (col: number): string => {
    let n = col + 1, s = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };

  const rects: string[] = [];
  const texts: string[] = [];

  // Title/subtitle
  if (opts?.title) {
    texts.push(`<text x="${pad}" y="${Math.round(pad * 0.95)}" class="title">${escapeXml(opts.title)}</text>`);
  }
  if (opts?.subtitle) {
    texts.push(
      `<text x="${pad}" y="${Math.round(pad * 0.95) + Math.round(cellSize * 0.65)}" class="subtitle">${escapeXml(opts.subtitle)}</text>`
    );
  }

  // Board background panel
  rects.push(
    `<rect x="${boardX}" y="${boardY}" width="${boardW}" height="${boardH}" rx="${Math.round(cellSize * 0.35)}" ry="${Math.round(cellSize * 0.35)}" class="panel" filter="url(#shadow)" />`
  );

  // Axis labels
  if (showAxis) {
    for (let c = 0; c < w; c++) {
      const x = boardX + offset + c * cellSize;
      texts.push(
        `<text x="${x + cellSize / 2}" y="${boardY + Math.round(offset * 0.7)}" text-anchor="middle" class="axis">${colToLetters(c)}</text>`
      );
    }
    for (let r = 0; r < h; r++) {
      const y = boardY + offset + r * cellSize;
      texts.push(
        `<text x="${boardX + Math.round(offset * 0.5)}" y="${y + Math.round(cellSize * 0.7)}" text-anchor="middle" class="axis">${r + 1}</text>`
      );
    }
  }

  // Cells
  const rrx = Math.round(cellSize * 0.22);
  const inset = Math.max(2, Math.round(cellSize * 0.08));

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const cell = grid[r][c];
      const isBlack = cell === null;
      const isFilled = !isBlack && typeof cell === "string" && cell.length === 1;

      const x = boardX + offset + c * cellSize;
      const y = boardY + offset + r * cellSize;

      if (isBlack) {
        rects.push(`<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="${rrx}" ry="${rrx}" class="cell cell-black" />`);
      } else {
        rects.push(`<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="${rrx}" ry="${rrx}" class="cell cell-open" />`);

        if (isFilled) {
          rects.push(
            `<rect x="${x + inset}" y="${y + inset}" width="${cellSize - inset * 2}" height="${cellSize - inset * 2}" rx="${Math.max(2, rrx - inset)}" ry="${Math.max(2, rrx - inset)}" class="cell cell-filled" />`
          );
          texts.push(
            `<text x="${x + cellSize / 2}" y="${y + cellSize * 0.72}" text-anchor="middle" class="letter">${escapeXml(cell!)}</text>`
          );
        } else {
          texts.push(
            `<text x="${x + cellSize / 2}" y="${y + cellSize * 0.73}" text-anchor="middle" class="emptyDot">·</text>`
          );
        }
      }
    }
  }

  // ---- Scoreboard panel (ALWAYS)
  rects.push(
    `<rect x="${sbX}" y="${sbY}" width="${sbW}" height="${sbH}" rx="${Math.round(cellSize * 0.35)}" ry="${Math.round(cellSize * 0.35)}" class="panel" filter="url(#shadow)" />`
  );

  const sbPad = Math.max(6, Math.round(cellSize * 0.32));
  const titleY = sbY + Math.round(cellSize * 0.9);
  texts.push(`<text x="${sbX + sbPad}" y="${titleY}" class="sbTitle">Score</text>`);

  const rowStartY = titleY + Math.round(cellSize * 0.7);
  const rowH = Math.round(cellSize * 0.62);

  // If empty score, show placeholder
  if (scoreEntries.length === 0) {
    texts.push(
      `<text x="${sbX + sbPad}" y="${rowStartY + Math.round(cellSize * 0.2)}" class="sbEmpty">No scores yet</text>`
    );
  } else {
    scoreEntries.forEach(([name, score], i) => {
      const y = rowStartY + i * rowH;
      if (y > sbY + sbH - rowH) return; // don't overflow

      const isMe = opts?.highlightPlayer && name === opts.highlightPlayer;

      rects.push(
        `<rect x="${sbX + Math.round(sbPad * 0.6)}" y="${y - Math.round(rowH * 0.55)}" width="${sbW - Math.round(sbPad * 1.2)}" height="${Math.round(rowH * 0.95)}" rx="${Math.round(rowH * 0.35)}" ry="${Math.round(rowH * 0.35)}" class="${isMe ? "sbRow sbRowMe" : "sbRow"}" />`
      );

      // Name (truncate a bit)
      const maxChars = 12;
      const displayName = name.length > maxChars ? name.slice(0, maxChars - 1) + "…" : name;

      texts.push(
        `<text x="${sbX + sbPad}" y="${y}" class="${isMe ? "sbName sbNameMe" : "sbName"}">${escapeXml(displayName)}</text>`
      );
      texts.push(
        `<text x="${sbX + sbW - sbPad}" y="${y}" text-anchor="end" class="${isMe ? "sbScore sbScoreMe" : "sbScore"}">${score}</text>`
      );
    });
  }

  // Overlay (finished modal)
  const overlay = opts?.overlay;
  const overlaySvg = overlay
    ? `
  <rect x="0" y="0" width="${svgW}" height="${svgH}" fill="rgba(15,23,42,0.55)"/>
  <g filter="url(#shadow)">
    <rect x="${Math.round(svgW * 0.14)}" y="${Math.round(svgH * 0.30)}"
          width="${Math.round(svgW * 0.72)}" height="${Math.round(svgH * 0.30)}"
          rx="${Math.round(cellSize * 0.6)}" ry="${Math.round(cellSize * 0.6)}"
          fill="rgba(255,255,255,0.94)" stroke="rgba(255,255,255,0.35)"/>
  </g>
  <text x="${Math.round(svgW / 2)}" y="${Math.round(svgH * 0.43)}"
        text-anchor="middle" class="overlayTitle">${escapeXml(overlay.title)}</text>
  ${overlay.message ? `
  <text x="${Math.round(svgW / 2)}" y="${Math.round(svgH * 0.51)}"
        text-anchor="middle" class="overlayMsg">${escapeXml(overlay.message)}</text>
  ` : ""}
  <text x="${Math.round(svgW / 2)}" y="${Math.round(svgH * 0.58)}"
        text-anchor="middle" class="overlayHint">Game complete</text>
`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${Math.max(2, Math.round(cellSize * 0.08))}" stdDeviation="${Math.max(2, Math.round(cellSize * 0.12))}" flood-opacity="0.18"/>
    </filter>
    <filter id="letterGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="0" stdDeviation="${Math.max(1, Math.round(cellSize * 0.10))}" flood-color="white" flood-opacity="0.9"/>
    </filter>
  </defs>

  <style>
    .title { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: ${Math.round(cellSize * 0.62)}px; font-weight: 800; fill: #0f172a; }
    .subtitle { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: ${Math.round(cellSize * 0.40)}px; font-weight: 600; fill: rgba(15, 23, 42, 0.60); }

    .panel { fill: rgba(255,255,255,0.50); stroke: rgba(15,23,42,0.12); stroke-width: 1; }

    .axis { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: ${Math.round(cellSize * 0.34)}px; font-weight: 700; fill: rgba(15, 23, 42, 0.62); }

    .cell { stroke-width: 1; }
    .cell-open { fill: rgba(248,250,252,0.95); stroke: rgba(15,23,42,0.14); }
    .cell-filled { fill: rgba(255,255,255,0.98); stroke: rgba(15,23,42,0.20); }
    .cell-black { fill: rgba(15,23,42,0.90); stroke: rgba(255,255,255,0.10); }

    .letter { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: ${Math.round(cellSize * 0.60)}px; font-weight: 900; fill: rgba(15, 23, 42, 0.92); filter: url(#letterGlow); }
    .emptyDot { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: ${Math.round(cellSize * 0.40)}px; font-weight: 800; fill: rgba(15, 23, 42, 0.18); }

    .sbTitle { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: ${Math.round(cellSize * 0.40)}px; font-weight: 900; fill: rgba(15, 23, 42, 0.82); }
    .sbEmpty { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: ${Math.round(cellSize * 0.32)}px; font-weight: 700; fill: rgba(15, 23, 42, 0.45); }

    .sbRow { fill: rgba(15,23,42,0.04); }
    .sbRowMe { fill: rgba(37,99,235,0.10); }

    .sbName { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: ${Math.round(cellSize * 0.34)}px; font-weight: 750; fill: rgba(15, 23, 42, 0.78); }
    .sbScore { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: ${Math.round(cellSize * 0.36)}px; font-weight: 950; fill: rgba(15, 23, 42, 0.88); }

    .sbNameMe { fill: rgba(37,99,235,0.95); }
    .sbScoreMe { fill: rgba(37,99,235,0.95); }

    .overlayTitle { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: ${Math.round(cellSize * 1.15)}px; font-weight: 1000; fill: rgba(15, 23, 42, 0.92); }
    .overlayMsg { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: ${Math.round(cellSize * 0.55)}px; font-weight: 900; fill: rgba(15, 23, 42, 0.70); }
    .overlayHint { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-size: ${Math.round(cellSize * 0.35)}px; font-weight: 800; fill: rgba(15, 23, 42, 0.45); }
  </style>

  ${rects.join("\n  ")}
  ${texts.join("\n  ")}
  ${overlaySvg}
</svg>`;
};


const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");




const backtrackPlace = (
  grid: (string | null)[][],
  placements: Placement[],
  words: string[],
  idx: number
): boolean => {
  if (idx >= words.length) return true;

  const word = words[idx];
  const isFirst = placements.length === 0;

  const candidates = findAllCandidatePlacements(grid, word, isFirst);

  // Try a limited number of top candidates to keep it fast
  const limit = Math.min(candidates.length, 50);

  for (let i = 0; i < limit; i++) {
    const cand = candidates[i];
    const snapshot = cloneGrid(grid);

    placeWord(grid, word, cand.row, cand.col, cand.dir);
    placements.push({ word, row: cand.row, col: cand.col, dir: cand.dir });

    if (backtrackPlace(grid, placements, words, idx + 1)) return true;

    // rollback
    for (let r = 0; r < grid.length; r++) grid[r] = snapshot[r];
    placements.pop();
  }

  // If we can't place this word, skip it (allows partial puzzles)
  // Return true only if we can complete remaining words with skipping.
  return backtrackPlace(grid, placements, words, idx + 1);
};

export const renderCrosswordSVGWithAxes = (
  grid: (string | null)[][],
  opts?: { cellSize?: number; showLetters?: boolean }
): string => {
  const cellSize = opts?.cellSize ?? 32;
  const showLetters = opts?.showLetters ?? false;

  const h = grid.length;
  const w = grid[0].length;

  // extra header row/col
  const offset = cellSize;

  const svgW = (w + 1) * cellSize;
  const svgH = (h + 1) * cellSize;

  const rects: string[] = [];
  const texts: string[] = [];

  // no full-background fill: keep SVG transparent

  // column labels
  for (let c = 0; c < w; c++) {
    const x = offset + c * cellSize;
    texts.push(
      `<text x="${x + cellSize / 2}" y="${offset * 0.72}" text-anchor="middle" font-family="Arial" font-size="${Math.floor(cellSize * 0.4)}">${colToLetters(c)}</text>`
    );
  }

  // row labels
  for (let r = 0; r < h; r++) {
    const y = offset + r * cellSize;
    texts.push(
      `<text x="${offset * 0.45}" y="${y + cellSize * 0.68}" text-anchor="middle" font-family="Arial" font-size="${Math.floor(cellSize * 0.4)}">${r + 1}</text>`
    );
  }

  // cells
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const x = offset + c * cellSize;
      const y = offset + r * cellSize;
      const filled = grid[r][c] !== null;

      rects.push(
        `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${filled ? "white" : "black"}" stroke="black" />`
      );

      if (filled && showLetters) {
        const letter = grid[r][c]!;
        texts.push(
          `<text x="${x + cellSize / 2}" y="${y + cellSize * 0.68}" text-anchor="middle" font-family="Arial" font-size="${Math.floor(cellSize * 0.55)}">${letter}</text>`
        );
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
  ${rects.join("\n  ")}
  ${texts.join("\n  ")}
</svg>`;
};

export const lettersToCol = (letters: string): number => {
  // "A"->0, "Z"->25, "AA"->26
  let n = 0;
  const u = letters.toUpperCase();
  for (let i = 0; i < u.length; i++) {
    const ch = u.charCodeAt(i);
    if (ch < 65 || ch > 90) throw new Error(`Invalid column letters: ${letters}`);
    n = n * 26 + (ch - 65 + 1);
  }
  return n - 1;
};

export const parseA1 = (ref: string): { row: number; col: number } => {
  const m = ref.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!m) throw new Error(`Invalid ref: ${ref} (expected like A1, C7, AA12)`);
  const col = lettersToCol(m[1]);
  const row = parseInt(m[2], 10) - 1;
  if (row < 0) throw new Error(`Invalid row in ref: ${ref}`);
  return { row, col };
};


export const tryLockWordAtRef = (
  state: CrosswordState,
  wordRaw: string,
  ref: string,
  dir: Direction,
  canPlace: (grid: (string | null)[][], word: string, row: number, col: number, dir: Direction) => { ok: boolean; intersections: number },
  placeWord: (grid: (string | null)[][], word: string, row: number, col: number, dir: Direction) => void
): { ok: true; state: CrosswordState } | { ok: false; reason: string } => {
  const word = cleanWord(wordRaw);
  if (word.length < 2) return { ok: false, reason: "Word too short" };

  const { row, col } = parseA1(ref);

  // Don’t allow duplicate locked word
  if (state.locked.some(l => l.word === word)) {
    return { ok: false, reason: `Word already locked: ${word}` };
  }

  const chk = canPlace(state.grid, word, row, col, dir);
  if (!chk.ok) return { ok: false, reason: `Cannot place ${word} at ${ref} ${dir}` };

  placeWord(state.grid, word, row, col, dir);

  state.locked.push({ word, row, col, dir, locked: true });

  return { ok: true, state };
};

export const fillRemaining = (
  state: CrosswordState,
  allWordsRaw: string[],
  canPlace: (grid: (string | null)[][], word: string, row: number, col: number, dir: Direction) => { ok: boolean; intersections: number },
  placeWord: (grid: (string | null)[][], word: string, row: number, col: number, dir: Direction) => void,
  findCandidates: (grid: (string | null)[][], word: string, isFirst: boolean) => Array<{ row: number; col: number; dir: Direction; intersections: number }>,
  opts?: { maxPerWord?: number }
): { grid: (string | null)[][]; placements: Placement[] } => {
  const maxPerWord = opts?.maxPerWord ?? 80;

  const lockedSet = new Set(state.locked.map(l => l.word));
  const words = allWordsRaw
    .map(cleanWord)
    .filter(w => w.length >= 2)
    .filter((w, i, arr) => arr.indexOf(w) === i)
    .filter(w => !lockedSet.has(w))
    .sort((a, b) => b.length - a.length);

  const placements: Placement[] = state.locked.map(l => ({
    word: l.word,
    row: l.row,
    col: l.col,
    dir: l.dir,
  }));

  const grid = state.grid;

  const backtrack = (idx: number): boolean => {
    if (idx >= words.length) return true;

    const word = words[idx];
    const candidates = findCandidates(grid, word, placements.length === 0);

    // limit candidates to keep it responsive
    const limit = Math.min(candidates.length, maxPerWord);

    for (let i = 0; i < limit; i++) {
      const cand = candidates[i];
      const snapshot = cloneGrid(grid);

      const chk = canPlace(grid, word, cand.row, cand.col, cand.dir);
      if (!chk.ok) continue;

      placeWord(grid, word, cand.row, cand.col, cand.dir);
      placements.push({ word, row: cand.row, col: cand.col, dir: cand.dir });

      if (backtrack(idx + 1)) return true;

      // rollback
      for (let r = 0; r < grid.length; r++) grid[r] = snapshot[r];
      placements.pop();
    }

    return false; // strict: don’t skip if you want “finish”
  };

  backtrack(0);

  return { grid, placements };
};


export const slotKey = (ref: string, dir: Direction) => `${ref.toUpperCase()}-${dir}`;



export const isStartCell = (grid: (string | null)[][], row: number, col: number, dir: Direction) => {
  if (grid[row][col] === null) return false;
  if (dir === "across") return col === 0 || grid[row][col - 1] === null;
  return row === 0 || grid[row - 1][col] === null;
};



export const getCandidateDirs = (grid: (string | null)[][], row: number, col: number): Direction[] => {
  if (grid[row][col] === null) return [];

  const dirs: Direction[] = [];

  const startsAcross =
    (col === 0 || grid[row][col - 1] === null) &&
    (col + 1 < grid[0].length && grid[row][col + 1] !== null);

  const startsDown =
    (row === 0 || grid[row - 1][col] === null) &&
    (row + 1 < grid.length && grid[row + 1][col] !== null);

  if (startsAcross) dirs.push("across");
  if (startsDown) dirs.push("down");

  return dirs;
};


export const isStartCellAny = (grid: (string | null)[][], row: number, col: number) => {
  if (grid[row][col] === null) return false;

  const startsAcross =
    (col === 0 || grid[row][col - 1] === null) &&
    (col + 1 < grid[0].length && grid[row][col + 1] !== null);

  const startsDown =
    (row === 0 || grid[row - 1][col] === null) &&
    (row + 1 < grid.length && grid[row + 1][col] !== null);

  return startsAcross || startsDown;
};
export const isGameCompleteByGrid = (puzzle: Puzzle) => {
  let total = 0;
  let filled = 0;

  for (let r = 0; r < puzzle.solutionGrid.length; r++) {
    for (let c = 0; c < puzzle.solutionGrid[0].length; c++) {
      if (puzzle.solutionGrid[r][c] !== null) {
        total++;
        if (typeof puzzle.playerGrid[r][c] === "string" && puzzle.playerGrid[r][c]!.length === 1) {
          filled++;
        }
      }
    }
  }

  console.log(filled, total)
  return filled === total;
};


export const readSlot = (grid: (string | null)[][], row: number, col: number, dir: Direction) => {
  const letters: string[] = [];
  let r = row, c = col;

  while (r >= 0 && c >= 0 && r < grid.length && c < grid[0].length) {
    const cell = grid[r][c];
    if (cell === null) break;
    letters.push(cell);
    if (dir === "across") c++;
    else r++;
  }
  return letters.join("");
};

export const applyGuess = (
  puzzle: Puzzle,
  ref: string,
  guessRaw: string
): GuessResult => {
  const guess = guessRaw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const { row, col } = parseA1(ref);

  if (row < 0 || col < 0 || row >= puzzle.height || col >= puzzle.width) {
    return { ok: false, reason: "Out of bounds" };
  }
  if (puzzle.solutionGrid[row][col] === null) {
    return { ok: false, reason: "Ref is a black cell" };
  }

  // Must be start of either across or down
  if (!isStartCellAny(puzzle.solutionGrid, row, col)) {
    return { ok: false, reason: "Ref is not a word start" };
  }

  const dirs = getCandidateDirs(puzzle.solutionGrid, row, col);
  if (dirs.length === 0) return { ok: false, reason: "No word starts here" };

  // Evaluate candidates
  const candidates = dirs
    .map((dir) => ({ dir, correct: readSlot(puzzle.solutionGrid, row, col, dir) }))
    .filter((x) => x.correct.length > 0);

  // First: try exact match on value
  const exact = candidates.find((c) => c.correct === guess);
  if (!exact) {
    // Second: if guess length matches exactly one candidate length, you can optionally treat wrong as "incorrect"
    const lengthMatches = candidates.filter((c) => c.correct.length === guess.length);

    if (lengthMatches.length === 1) {
      return { ok: false, reason: "Incorrect", correctLength: lengthMatches[0].correct.length };
    }

    // Otherwise: ambiguous or wrong length
    return {
      ok: false,
      reason: lengthMatches.length === 0 ? "Wrong length" : "Ambiguous (could be across or down)",
      candidates: candidates.map((c) => ({ dir: c.dir, length: c.correct.length })),
    };
  }

  // ✅ Fill into player grid using the matched direction
  const filled: Array<{ row: number; col: number; letter: string }> = [];
  for (let i = 0; i < exact.correct.length; i++) {
    const r = exact.dir === "across" ? row : row + i;
    const c = exact.dir === "across" ? col + i : col;
    puzzle.playerGrid[r][c] = exact.correct[i];
    filled.push({ row: r, col: c, letter: exact.correct[i] });
  }

  return { ok: true, dir: exact.dir, filled };
};


export const getWinner = (score: ScoreMap) => {
  const entries = Object.entries(score);
  if (entries.length === 0) return "";

  entries.sort((a, b) => b[1] - a[1]);
  const top = entries[0][1];
  const winners = entries.filter(([, s]) => s === top).map(([n]) => n);

  return winners.length === 1 ? winners[0] : winners.join(" & ");
};
