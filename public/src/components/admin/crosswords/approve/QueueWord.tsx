"use client";

/**
 * One word of the approval queue (§7.4), shown whole: the word, its
 * frequency, the bank's model flags as warnings, the definitions it is clued
 * from, any stored suggestion (marked as one; accepting never approves), and
 * its candidate clues numbered 1–9 for the keyboard. Presentational: the page
 * owns the decisions and the selection.
 */
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { BankQueueClue, BankQueueWord } from "@photonsurge/shared/crossword-bank";
import { font } from "../../../../theme/tokens";
import { ApprovalChip, FamilyChip, decidedLabel, zipfLabel } from "../words/chips";

const PROBLEM_TEXT: Record<NonNullable<BankQueueClue["problem"]>, string> = {
  short: "too short to air",
  long: "too long to air",
  leak: "gives the answer away",
  blocked: "on the blocklist",
};

export interface QueueWordProps {
  word: BankQueueWord;
  /** Index into `word.clues` of the selected clue, or null. */
  selected: number | null;
  /** Id and draft of the clue being edited, or null. */
  editing: { id: string; draft: string } | null;
  busy: boolean;
  onSelect: (index: number | null) => void;
  onWordApproval: (status: "approved" | "rejected") => void;
  onWordFamily: (value: boolean | null) => void;
  onClueApproval: (id: string, status: "approved" | "rejected") => void;
  onClueFamily: (id: string, value: boolean | null) => void;
  onEditStart: (id: string) => void;
  onEditChange: (draft: string) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  /** Focus left the edit box without Enter or Esc: the edit is dropped. */
  onEditBlur: () => void;
  onAcceptSuggestion: () => void;
}

function Key({ k }: { k: string }) {
  return (
    <Box
      component="kbd"
      sx={{ fontFamily: font.mono, fontSize: 11, px: 0.5, border: 1, borderColor: "divider", borderRadius: 0.5, ml: 0.5, color: "text.secondary" }}
    >
      {k}
    </Box>
  );
}

function ClueItem({ clue, index, props }: { clue: BankQueueClue; index: number; props: QueueWordProps }) {
  const { selected, editing, busy } = props;
  const isSel = selected === index;
  const isEditing = editing?.id === clue.id;
  const differs = clue.cleaned !== clue.text;
  return (
    <Box
      component="li"
      aria-current={isSel ? "true" : undefined}
      sx={{
        listStyle: "none",
        display: "flex",
        gap: 1.5,
        p: 1,
        mb: 0.75,
        border: 1,
        borderRadius: 1,
        borderColor: isSel ? "primary.main" : "divider",
        bgcolor: isSel ? "action.selected" : "transparent",
      }}
    >
      <ButtonBase
        aria-label={`Select clue ${index + 1}`}
        aria-pressed={isSel}
        disabled={isEditing}
        onClick={() => props.onSelect(index)}
        sx={{ alignSelf: "flex-start", width: 28, justifyContent: "flex-start", borderRadius: 0.5 }}
      >
        <Typography sx={{ fontFamily: font.mono, fontWeight: 700 }}>{index + 1}</Typography>
      </ButtonBase>
      <Box sx={{ flex: 1, minWidth: 0 }} onClick={() => props.onSelect(index)}>
        {isEditing ? (
          <TextField
            size="small"
            fullWidth
            autoFocus
            value={editing.draft}
            onChange={(e) => props.onEditChange(e.target.value)}
            onBlur={props.onEditBlur}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                props.onEditSave();
              } else if (e.key === "Escape") {
                e.preventDefault();
                props.onEditCancel();
              }
            }}
            helperText="Enter saves, Esc cancels. An edited clue is pending until approved."
            slotProps={{ htmlInput: { "aria-label": `Edit clue ${index + 1}` } }}
          />
        ) : (
          <>
            <Typography variant="body1">{clue.cleaned || clue.text}</Typography>
            {differs && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                stored: {clue.text}
              </Typography>
            )}
          </>
        )}
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mt: 0.5, alignItems: "center" }}>
          <ApprovalChip approval={clue.approval} />
          <FamilyChip value={clue.familyFriendly} />
          {clue.familyFriendlyBy && (
            <Typography variant="caption" color="text.secondary">
              tag {decidedLabel(clue.familyFriendlyBy, clue.familyFriendlyAt)}
            </Typography>
          )}
          {clue.problem && <Chip size="small" color="error" variant="outlined" label={PROBLEM_TEXT[clue.problem]} />}
          <Typography variant="caption" color="text.secondary">
            {decidedLabel(clue.approval.by, clue.approval.at)}
          </Typography>
        </Stack>
        {isSel && !isEditing && (
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mt: 1 }}>
            <Button size="small" color="success" disabled={busy || !!clue.problem} onClick={() => props.onClueApproval(clue.id, "approved")}>
              Approve clue<Key k="Y" />
            </Button>
            <Button size="small" disabled={busy} onClick={() => props.onEditStart(clue.id)}>
              Edit<Key k="E" />
            </Button>
            <Button size="small" color="error" disabled={busy} onClick={() => props.onClueApproval(clue.id, "rejected")}>
              Reject clue<Key k="X" />
            </Button>
            <Button size="small" disabled={busy} aria-pressed={clue.familyFriendly === true} onClick={() => props.onClueFamily(clue.id, clue.familyFriendly === true ? null : true)}>
              Family friendly<Key k="T" />
            </Button>
          </Stack>
        )}
      </Box>
    </Box>
  );
}

export default function QueueWord(props: QueueWordProps) {
  const { word, busy } = props;
  const s = word.suggestion;
  const haveSuggestion = !!s?.clue && word.clues.some((c) => c.text.trim().toLowerCase() === s.clue.trim().toLowerCase());
  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1.5, alignItems: "baseline" }}>
        <Typography variant="h1" component="h2" sx={{ fontFamily: font.mono, letterSpacing: 2 }}>
          {word.norm}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {word.length} letters · {zipfLabel(word.zipf)} · {word.pos.join(", ") || "no part of speech"}
        </Typography>
      </Stack>

      {word.warnings.length > 0 && (
        <Alert severity="warning" sx={{ mt: 1.5 }}>
          The bank&apos;s model flagged this word: {word.warnings.join(", ")}. A warning only; suggested tag: not family friendly.
        </Alert>
      )}

      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1, mt: 1.5, alignItems: "center" }}>
        <ApprovalChip approval={word.approval} />
        <FamilyChip value={word.familyFriendly} />
        <Typography variant="caption" color="text.secondary">
          {decidedLabel(word.approval.by, word.approval.at)}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="contained" color="success" disabled={busy} onClick={() => props.onWordApproval("approved")}>
          Approve word<Key k="A" />
        </Button>
        <Button size="small" variant="outlined" color="error" disabled={busy} onClick={() => props.onWordApproval("rejected")}>
          Reject word<Key k="R" />
        </Button>
        <Button size="small" variant="outlined" disabled={busy} aria-pressed={word.familyFriendly === true} onClick={() => props.onWordFamily(word.familyFriendly === true ? null : true)}>
          Family friendly<Key k="F" />
        </Button>
        <Button size="small" variant="outlined" disabled={busy} aria-pressed={word.familyFriendly === false} onClick={() => props.onWordFamily(word.familyFriendly === false ? null : false)}>
          Not family friendly<Key k="⇧F" />
        </Button>
      </Stack>

      <Typography variant="overline" color="text.secondary" sx={{ display: "block", mt: 2 }}>
        Definitions
      </Typography>
      {word.definitions.length === 0 && word.senses.every((x) => x.definitions.length === 0) ? (
        <Typography variant="body2" color="text.secondary">
          None stored.
        </Typography>
      ) : (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {(word.definitions.length ? word.definitions : word.senses.flatMap((x) => x.definitions)).slice(0, 8).map((d, i) => (
            <Typography component="li" key={i} variant="body2">
              {d}
            </Typography>
          ))}
        </Box>
      )}

      {s && (
        <Alert severity="info" icon={false} sx={{ mt: 2 }}>
          <Typography variant="caption" sx={{ display: "block", fontWeight: 600 }}>
            SUGGESTION, not approved{s.model ? ` · ${s.model}` : ""}
          </Typography>
          {s.clue ? (
            <>
              <Typography variant="body1">&ldquo;{s.clue}&rdquo;</Typography>
              <Typography variant="body2" color="text.secondary">
                Suggests {s.familyFriendly ? "family friendly" : "not family friendly"}
                {s.reason ? ` — ${s.reason}` : ""}
              </Typography>
              <Button size="small" sx={{ mt: 0.5 }} disabled={busy || haveSuggestion} onClick={props.onAcceptSuggestion}>
                {haveSuggestion ? "Already a candidate clue" : "Add as a candidate clue"}
                {!haveSuggestion && <Key k="U" />}
              </Button>
            </>
          ) : (
            <Typography variant="body2">
            No usable clue — {s.familyFriendly ? "family friendly: yes" : "family friendly: no"}
            {s.reason ? `, because ${s.reason}` : ""}
          </Typography>
          )}
        </Alert>
      )}

      <Typography variant="overline" color="text.secondary" sx={{ display: "block", mt: 2 }}>
        Candidate clues ({word.clues.length}) — 1–9 or J / K to select
      </Typography>
      {word.clues.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No clues left. Add the suggestion, or reject the word.
        </Typography>
      ) : (
        <Box component="ol" aria-label="Candidate clues" sx={{ m: 0, p: 0 }}>
          {word.clues.map((c, i) => (
            <ClueItem key={c.id} clue={c} index={i} props={props} />
          ))}
        </Box>
      )}
    </Paper>
  );
}
