"use client";

/**
 * The Game group of a crossword channel's settings (plan §8.2): five cards over
 * the channel's CrosswordConfig. Like every other card they are pure forms over
 * the page draft — they read `crossword` and call `stageCrossword`, and nothing
 * reaches the game until the Save bar PATCHes /api/crossword/:scene/config. The
 * worker's runner re-reads the config each tick, so a Save lands live.
 *
 * Every number is bounded by CROSSWORD_CONFIG_LIMITS, the same table the
 * server's merge clamps to, so the field can never offer a value the save would
 * quietly change.
 */
import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import {
  CROSSWORD_CONFIG_LIMITS,
  DEFAULT_CROSSWORD_CONFIG,
  type CrosswordConfig,
} from "@photonsurge/shared/crossword";
import SettingsCard from "./SettingsCard";
import TuningField from "./TuningField";
import { useSceneDraft } from "./SceneDraft";

type NumKey = keyof typeof CROSSWORD_CONFIG_LIMITS;

const row = { display: "flex", flexWrap: "wrap", gap: 1.5, mb: 1, alignItems: "flex-start" } as const;

/** One bounded number from the config. */
function GameField({
  field,
  label,
  unit,
  integer = true,
  min,
}: {
  field: NumKey;
  label: string;
  unit?: string;
  integer?: boolean;
  /** A tighter floor than the table's (maxWords never below minWords). */
  min?: number;
}) {
  const { crossword, stageCrossword } = useSceneDraft();
  const [lo, hi] = CROSSWORD_CONFIG_LIMITS[field];
  return (
    <TuningField
      label={label}
      value={crossword[field]}
      defaultValue={DEFAULT_CROSSWORD_CONFIG[field]}
      min={Math.max(lo, min ?? lo)}
      max={hi}
      integer={integer}
      unit={unit}
      onChange={(v) => stageCrossword({ [field]: v } as Partial<CrosswordConfig>)}
    />
  );
}

/** A yes/no from the config. */
function GameSwitch({ field, label }: { field: "enabled" | "playOffAir" | "familyFriendlyOnly"; label: string }) {
  const { crossword, stageCrossword } = useSceneDraft();
  return (
    <FormControlLabel
      control={
        <Switch checked={crossword[field]} onChange={(e) => stageCrossword({ [field]: e.target.checked })} />
      }
      label={label}
    />
  );
}

/** Split a typed list on commas and new lines, trimmed and de-duplicated. */
export function parseList(text: string): string[] {
  return [...new Set(text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))];
}

/**
 * A list of words or themes, one per line (commas work too). Commits on blur
 * like TuningField, so a half-typed entry never reaches the draft.
 */
function GameList({
  field,
  label,
  helperText,
}: {
  field: "blocklist";
  label: string;
  helperText: string;
}) {
  const { crossword, stageCrossword } = useSceneDraft();
  const value = crossword[field];
  const [draft, setDraft] = useState(value.join("\n"));
  useEffect(() => setDraft(value.join("\n")), [value]);

  const commit = () => {
    const next = parseList(draft);
    setDraft(next.join("\n"));
    if (next.join("\n") !== value.join("\n")) stageCrossword({ [field]: next });
  };

  return (
    <TextField
      size="small"
      label={label}
      multiline
      minRows={3}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      helperText={helperText}
      sx={{ width: "100%", maxWidth: 420 }}
    />
  );
}

export function CrosswordOnSettings() {
  const { crossword } = useSceneDraft();
  return (
    <SettingsCard
      id="crossword-on"
      blurb="Whether the host runs this channel's game at all."
      note={
        <>
          With Play off air on, the game keeps going with no live run attached — for a local box or
          for trying puzzles out through the Desk&apos;s simulator. Leave it off on a channel that only
          plays when it streams.
        </>
      }
    >
      <Box sx={row}>
        <GameSwitch field="enabled" label="Host this channel" />
        <Box sx={{ opacity: crossword.enabled ? 1 : 0.5 }}>
          <GameSwitch field="playOffAir" label="Play off air" />
        </Box>
      </Box>
    </SettingsCard>
  );
}

export function CrosswordPacingSettings() {
  return (
    <SettingsCard
      id="crossword-pacing"
      blurb="How long each clue stays in the spotlight, when hint letters start to leak, and how long the beats between words and puzzles last."
    >
      <Box sx={row}>
        <GameField field="clueS" label="Clue time" unit="s" />
        <GameField field="hintStartFrac" label="Hints start at" integer={false} />
        <GameField field="hintMaxFrac" label="Hints stop at" integer={false} />
      </Box>
      <Box sx={row}>
        <GameField field="introS" label="Intro" unit="s" />
        <GameField field="finaleS" label="Finale" unit="s" />
        <GameField field="revealHoldS" label="Hold after a reveal" unit="s" />
        <GameField field="solveBeatS" label="Beat after a solve" unit="s" />
        <GameField field="ceilingMin" label="Puzzle ceiling" unit="min" />
      </Box>
    </SettingsCard>
  );
}

export function CrosswordDifficultySettings() {
  return (
    <SettingsCard
      id="crossword-difficulty"
      blurb="How common a word must be to be picked (a Zipf frequency: 3 is uncommon, 5 is everyday)."
    >
      <Box sx={row}>
        <GameField field="minZipf" label="Word frequency floor" integer={false} />
      </Box>
    </SettingsCard>
  );
}

export function CrosswordPuzzleSettings() {
  const { crossword } = useSceneDraft();
  return (
    <SettingsCard
      id="crossword-puzzles"
      blurb="How many approved puzzles to keep in stock, how big they are, and how long before a puzzle or a word comes round again."
    >
      <Box sx={row}>
        <GameField field="stockTarget" label="Stock target" unit="puzzles" />
        <GameSwitch field="familyFriendlyOnly" label="Family friendly only" />
      </Box>
      <Box sx={row}>
        <GameField field="minWords" label="Fewest words" />
        <GameField field="maxWords" label="Most words" min={crossword.minWords} />
        <GameField field="maxSize" label="Largest grid" unit="cells" />
      </Box>
      <Box sx={row}>
        <GameField field="noRepeatPuzzles" label="Puzzle not replayed within" unit="puzzles" />
        <GameField field="noRepeatWordsPuzzles" label="Word not reused within" unit="puzzles" />
      </Box>
    </SettingsCard>
  );
}

export function CrosswordChatSettings() {
  return (
    <SettingsCard
      id="crossword-chat"
      blurb="How chat answers count: the stream delay that decides a late answer, and how many guesses one viewer may send."
    >
      <Box sx={row}>
        <GameField field="streamDelayS" label="Stream delay" unit="s" />
        <GameField field="rateMax" label="Guesses allowed" />
        <GameField field="rateWindowS" label="…per" unit="s" />
      </Box>
      <GameList
        field="blocklist"
        label="Blocked words"
        helperText="One per line, on top of the built-in list. A viewer name that hits one is replaced on air, and a clue that uses one is never aired."
      />
    </SettingsCard>
  );
}
