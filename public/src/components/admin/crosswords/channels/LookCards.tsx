"use client";

/**
 * The Look group (plan §8.2): the channel's brand, with a small live preview
 * built from `crosswordThemeVars` (the same variables the output page sets),
 * and the generated music bed, which rides the channel record's `audio` field
 * exactly as on the weather settings page.
 */
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { AUDIO_MODES, type AudioMode, type ControlState } from "@photonsurge/shared/control";
import { BRAND_TITLE_MAX, crosswordThemeVars, type CrosswordTheme } from "@photonsurge/shared/crossword";
import { AUDIO_MODE_LABELS } from "../../scenes/AudioSettings";
import ChannelCard from "./ChannelCard";
import { useChannelDraft } from "./ChannelDraft";

/** A tiny board and spotlight card in the theme's own variables. */
export function ThemePreview({ theme }: { theme: CrosswordTheme }) {
  const cells = ["C", "A", "T", "", "O", "", "", "W", "L"];
  return (
    <Box
      data-testid="theme-preview"
      style={crosswordThemeVars(theme) as React.CSSProperties}
      sx={{
        bgcolor: "var(--cw-background)",
        color: "var(--cw-ink)",
        fontFamily: "var(--cw-font-text)",
        borderRadius: 1,
        p: 1.5,
        display: "flex",
        gap: 1.5,
        alignItems: "center",
        width: 320,
        maxWidth: "100%",
      }}
    >
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 28px)", gap: "2px" }}>
        {cells.map((c, i) => (
          <Box
            key={i}
            sx={{
              width: 28,
              height: 28,
              display: "grid",
              placeItems: "center",
              fontFamily: "var(--cw-font-display)",
              fontWeight: 700,
              fontSize: 14,
              bgcolor: c ? (i % 2 ? "var(--cw-cell-solved)" : "var(--cw-cell)") : "var(--cw-block)",
            }}
          >
            {c}
          </Box>
        ))}
      </Box>
      <Box sx={{ bgcolor: "var(--cw-panel)", borderRadius: 1, p: 1, flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", mb: 0.5 }}>
          {theme.brand.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={theme.brand.logoUrl} alt="logo" style={{ height: 18, maxWidth: 40, objectFit: "contain" }} />
          )}
          <Typography
            component="span"
            noWrap
            sx={{ fontFamily: "var(--cw-font-display)", fontWeight: 700, fontSize: 13 }}
          >
            {theme.brand.title || "Crossword"}
          </Typography>
        </Stack>
        <Typography component="div" sx={{ color: "var(--cw-ink-muted)", fontSize: 11 }}>
          A pet that purrs
        </Typography>
        <Typography component="div" sx={{ color: "var(--cw-accent)", fontSize: 11, fontWeight: 700 }}>
          3 letters
        </Typography>
      </Box>
    </Box>
  );
}

export function BrandCard() {
  const { crossword, stageCrossword } = useChannelDraft();
  const theme = crossword.theme;
  // Staged whole: the config merge sanitizes the theme it receives.
  const apply = (brand: Partial<CrosswordTheme["brand"]>) =>
    stageCrossword({ theme: { ...theme, brand: { ...theme.brand, ...brand } } });

  return (
    <ChannelCard
      id="brand"
      blurb="The title and logo this channel puts on air. It goes out on its own YouTube channel, so it has its own brand."
    >
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap", alignItems: "flex-start", mb: 1.5 }}>
        <TextField
          size="small"
          label="Brand title"
          value={theme.brand.title}
          onChange={(e) => apply({ title: e.target.value })}
          slotProps={{ htmlInput: { maxLength: BRAND_TITLE_MAX } }}
          sx={{ minWidth: 220 }}
        />
        <TextField
          size="small"
          label="Logo"
          value={theme.brand.logoUrl}
          onChange={(e) => apply({ logoUrl: e.target.value })}
          placeholder="https://… or /images/logo.png"
          helperText="An image URL or a path on this site. Blank = no logo."
          sx={{ flex: 1, minWidth: 240 }}
        />
      </Stack>
      <ThemePreview theme={theme} />
    </ChannelCard>
  );
}

export function MusicCard() {
  const { state, stage } = useChannelDraft();
  const audio = state.audio;
  // Staged deltas spread-merge at the top level, so ship the whole audio object.
  const apply = (over: Partial<ControlState["audio"]>) => stage({ audio: { ...audio, ...over } });

  return (
    <ChannelCard
      id="music"
      note={
        <>
          Generative music on this channel&apos;s output, the same bed the weather channels use. Browsers
          need one click on the page before audio can start; OBS plays immediately.
        </>
      }
    >
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={audio.enabled}
            onChange={(e) => apply({ enabled: e.target.checked })}
            slotProps={{ input: { "aria-label": "Music" } }}
            sx={{ p: 0.5 }}
          />
        }
        label={<Typography variant="body2">Music</Typography>}
        sx={{ mb: 1 }}
      />
      <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", alignItems: "center" }}>
        <TextField
          select
          size="small"
          label="Mode"
          disabled={!audio.enabled}
          value={audio.mode}
          onChange={(e) => apply({ mode: e.target.value as AudioMode })}
          sx={{ minWidth: 210 }}
          slotProps={{ htmlInput: { "aria-label": "Audio mode" } }}
        >
          {AUDIO_MODES.map((m) => (
            <MenuItem key={m} value={m}>
              {AUDIO_MODE_LABELS[m]}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              disabled={!audio.enabled}
              checked={audio.muted}
              onChange={(e) => apply({ muted: e.target.checked })}
              slotProps={{ input: { "aria-label": "Mute" } }}
              sx={{ p: 0.5 }}
            />
          }
          label={<Typography variant="body2">Mute</Typography>}
        />
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", minWidth: 240 }}>
          <Typography variant="body2" color="text.secondary">
            Volume
          </Typography>
          <Slider
            size="small"
            disabled={!audio.enabled}
            min={0}
            max={1}
            step={0.05}
            value={audio.volume}
            onChange={(_e, v) => apply({ volume: v as number })}
            aria-label="Audio volume"
            sx={{ width: 140 }}
          />
          <Typography variant="body2" sx={{ width: 40, textAlign: "right" }}>
            {Math.round(audio.volume * 100)}%
          </Typography>
        </Stack>
      </Stack>
    </ChannelCard>
  );
}
