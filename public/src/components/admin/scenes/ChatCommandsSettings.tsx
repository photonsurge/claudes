"use client";

/**
 * Chat commands — what this channel's audience may change from live chat.
 * Three switches, each a gate on the next, and everything below a switch that
 * is off is greyed out with the reason, so nothing looks armed that cannot
 * fire: Monitor chat → Viewer commands → (Viewers may steer the director, on
 * the director section). Stages the COMPLETE `chat` object.
 */
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { AUDIO_MODES, type ChatSettings } from "@photonsurge/shared/control";
import type { ChatCommandSettings } from "@photonsurge/shared/chat-policy";
import SettingsCard from "./SettingsCard";
import ChatPaletteList from "./ChatPaletteList";
import ChatDirectorPolicy from "./ChatDirectorPolicy";
import Gated from "./Gated";
import TuningField from "./TuningField";
import { useSceneDraft } from "./SceneDraft";

const row = { display: "flex", flexWrap: "wrap", gap: 1.5, mb: 1.5, alignItems: "center" } as const;

export default function ChatCommandsSettings() {
  const { state, stage } = useSceneDraft();
  const chat = state.chat;
  const c = chat.commands;
  const setChat = (over: Partial<ChatSettings>) => stage({ chat: { ...chat, ...over } });
  const set = (over: Partial<ChatCommandSettings>) => setChat({ commands: { ...c, ...over } });
  const setMusic = (over: Partial<ChatCommandSettings["music"]>) => set({ music: { ...c.music, ...over } });

  const sw = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <FormControlLabel control={<Switch checked={checked} onChange={(e) => onChange(e.target.checked)} />} label={label} />
  );
  const hold = (slot: { holdS: number; maxHoldS: number }, onChange: (v: { holdS: number; maxHoldS: number }) => void, defaults = { holdS: 300, maxHoldS: 900 }) => (
    <>
      <TuningField label="Default hold" unit="s" value={slot.holdS} defaultValue={defaults.holdS} min={10} max={slot.maxHoldS} onChange={(v) => onChange({ ...slot, holdS: v })} />
      <TuningField label="Longest hold" unit="s" value={slot.maxHoldS} defaultValue={defaults.maxHoldS} min={10} max={7200} onChange={(v) => onChange({ maxHoldS: v, holdS: Math.min(slot.holdS, v) })} />
    </>
  );

  return (
    <SettingsCard
      id="chat"
      blurb="What this channel's audience may change from live chat. Test it with the chat simulator on the Control page — no live stream needed."
    >
      {sw("Monitor chat", chat.enabled, (v) => setChat({ enabled: v }))}
      <Gated off={!chat.enabled} reason="Chat isn't monitored on this channel, so nothing below can fire.">
        {sw("Promote messages to the ticker", chat.promoteToTicker, (v) => setChat({ promoteToTicker: v }))}
        <Box>{sw("Viewer commands", c.enabled, (v) => set({ enabled: v }))}</Box>

        <Gated off={!c.enabled} reason="Viewer commands are off: viewers can only ask :modes, :mode and :help.">
          <Box sx={row}>
            <TextField
              select
              size="small"
              label="Who may use them"
              value={c.allowFrom}
              onChange={(e) => set({ allowFrom: e.target.value as ChatCommandSettings["allowFrom"] })}
              sx={{ width: 200 }}
            >
              <MenuItem value="all">Everyone</MenuItem>
              <MenuItem value="mods">Moderators</MenuItem>
              <MenuItem value="owner">The channel owner</MenuItem>
            </TextField>
            <TuningField label="Per-viewer cooldown" unit="s" value={c.perUserCooldownS} defaultValue={60} min={0} max={3600} onChange={(v) => set({ perUserCooldownS: v })} />
            <TuningField label="Most waiting" value={c.maxQueued} defaultValue={10} min={0} max={100} integer onChange={(v) => set({ maxQueued: v })} />
          </Box>
          <Box sx={row}>
            {sw("Show the VIEWER PICK chip on air", c.onAirChip, (v) => set({ onAirChip: v }))}
            {sw("Confirm in chat", c.replyInChat, (v) => set({ replyInChat: v }))}
          </Box>
          {c.replyInChat ? (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              Each reply costs 50 units of the channel&apos;s 10,000 a day YouTube quota.
            </Alert>
          ) : null}

          <Typography variant="subtitle2" sx={{ mt: 1 }}>Music</Typography>
          {sw("Viewers may pick the music", c.music.enabled, (v) => setMusic({ enabled: v }))}
          <Gated off={!c.music.enabled} reason="Music requests are off.">
            <Box sx={row} role="group" aria-label="Music modes viewers may pick">
              {AUDIO_MODES.filter((m) => m !== "auto").map((m) => {
                const all = c.music.allowed.length === 0;
                const on = all || c.music.allowed.includes(m);
                return (
                  <FormControlLabel
                    key={m}
                    label={m}
                    control={
                      <Checkbox
                        size="small"
                        checked={on}
                        onChange={(e) => {
                          const current = all ? AUDIO_MODES.filter((x) => x !== "auto") : c.music.allowed;
                          const next = e.target.checked ? [...new Set([...current, m])] : current.filter((x) => x !== m);
                          if (!next.length) return; // keep at least one
                          setMusic({ allowed: next.length === AUDIO_MODES.length - 1 ? [] : next });
                        }}
                      />
                    }
                  />
                );
              })}
            </Box>
            <Box sx={row}>{hold(c.music, (v) => setMusic(v))}</Box>
            <Box sx={row}>
              {sw(":skip", c.music.allowSkip, (v) => setMusic({ allowSkip: v }))}
              {sw(":shuffle", c.music.allowShuffle, (v) => setMusic({ allowShuffle: v }))}
              <TuningField label="Skip / shuffle cooldown" unit="s" value={c.music.skipCooldownS} defaultValue={30} min={0} max={3600} onChange={(v) => setMusic({ skipCooldownS: v })} />
            </Box>
          </Gated>

          <Typography variant="subtitle2" sx={{ mt: 1 }}>Palettes</Typography>
          {sw("Viewers may pick the palette", c.theme.enabled, (v) => set({ theme: { ...c.theme, enabled: v } }))}
          <Gated off={!c.theme.enabled} reason="Palette requests are off.">
            <ChatPaletteList palettes={c.theme.palettes} onChange={(palettes) => set({ theme: { ...c.theme, palettes } })} />
            <Box sx={row}>{hold(c.theme, (v) => set({ theme: { ...c.theme, ...v } }))}</Box>
          </Gated>

          <ChatDirectorPolicy policy={c} set={set} />
        </Gated>
      </Gated>
    </SettingsCard>
  );
}
