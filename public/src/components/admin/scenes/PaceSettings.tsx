"use client";

/**
 * Per-channel READING PACE — the one speed control for everything that scrolls
 * on /watch: the bottom crawl, the WORLD REPORT row marquee and the deck cards'
 * auto-scrolling bodies. It is a reading speed (characters a second), not a
 * px/s or a loop length: each surface derives its own motion from its OWN
 * content, so a wordy alert scrolls slower than a terse quake line at the same
 * setting. STAGED as a DELTA patch (readPaceCps) — the page's Save bar applies
 * it live.
 */
import Box from "@mui/material/Box";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import {
  clampReadCps,
  crawlSeconds,
  readWpm,
  AVERAGE_READING_WPM,
  DEFAULT_READ_CPS,
  READ_CPS_MAX,
  READ_CPS_MIN,
} from "@photonsurge/shared/reading-pace";
import SettingsCard from "./SettingsCard";
import { useSceneDraft } from "./SceneDraft";

/** A worked example, so the number means something: a typical 1 200-character
 *  crawl feed (roughly twenty headlines) at this pace. */
const SAMPLE_CRAWL_CHARS = 1200;

export default function PaceSettings() {
  const { state, stage } = useSceneDraft();
  const cps = clampReadCps(state.readPaceCps);

  return (
    <SettingsCard
      id="pace"
      blurb={
        <>
          How fast everything on this channel scrolls — the bottom crawl, the world report feed and
          the deck cards&apos; bodies. It is set as a reading speed, and each surface works out its own
          motion from how much text it is actually showing, so a long alert scrolls more slowly than a
          short one at the same setting. Average silent reading is about {AVERAGE_READING_WPM} words a
          minute; on-air text is read once, in motion, so the default sits below that.
        </>
      }
    >
      <Box sx={{ maxWidth: 420 }}>
        <Slider
          size="small"
          aria-label="Reading pace"
          value={cps}
          min={READ_CPS_MIN}
          max={READ_CPS_MAX}
          step={1}
          marks={[
            { value: READ_CPS_MIN, label: "slow" },
            { value: DEFAULT_READ_CPS, label: "default" },
            { value: READ_CPS_MAX, label: "fast" },
          ]}
          valueLabelDisplay="auto"
          valueLabelFormat={(v) => `${v} cps`}
          onChange={(_, v) => stage({ readPaceCps: v as number })}
          sx={{ mx: 1 }}
        />
        <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
          <Typography variant="body2">
            <strong>{cps}</strong> characters/sec · <strong>{readWpm(cps)}</strong> words/min
          </Typography>
          <Typography variant="body2" color="text.secondary">
            a full crawl of ~{SAMPLE_CRAWL_CHARS} characters comes round every{" "}
            {Math.round(crawlSeconds(SAMPLE_CRAWL_CHARS, cps))}s
          </Typography>
        </Stack>
      </Box>
    </SettingsCard>
  );
}
