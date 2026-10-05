"use client";

/**
 * /admin/crosswords/words/:id — one bank word in full (§8.3): status, length,
 * categories, senses with their definitions, the raw Wiktionary definitions, every clue with its difficulty,
 * source and status, the validation verdict with what each source said, and
 * the raw attempts and validation JSON (collapsed). Also where a word and its
 * clues are decided on (§7.4, §8.3): approve or reject, the family-friendly
 * tick, edit a clue, and who decided and when. The bank's model-made flags
 * show as warnings and decide nothing; a stored suggestion is shown as one and
 * can be saved as a new candidate clue, which still needs approving.
 */
import { useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { BankClue, BankWordDetail } from "@photonsurge/shared/crossword-bank";
import { toQueueClue } from "../approve/queueState";
import AdminPageShell from "../../AdminPageShell";
import { font } from "../../../../theme/tokens";
import { SUGGEST_POLL_MAX, SUGGEST_POLL_MS, getBankWord, patchBankClue, patchBankWord, postSuggest, type CluePatch, type Outcome, type WordPatch } from "./api";
import { ApprovalChip, ClueStatusChip, DecisionChip, FamilyChip, FlagChips, decidedLabel, fmtTime, zipfLabel } from "./chips";

const PROBLEM_TEXT = { short: "too short to air", long: "too long to air", leak: "gives the answer away", blocked: "on the blocklist" } as const;

/** The decisions the view can ask for; the page wires them to the routes. */
export interface WordActions {
  busy?: boolean;
  onWord: (patch: WordPatch) => void;
  /** `wordId` lets the route check a clue before approving it. */
  onClue: (id: string, patch: CluePatch, wordId?: string) => void;
  /** Queue a suggestion for this word; `suggesting` shows while it is queued or running. */
  onSuggest?: () => void;
  suggesting?: boolean;
}
const NO_ACTIONS: WordActions = { busy: true, onWord: () => undefined, onClue: () => undefined };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Paper sx={{ p: 1.75 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Paper>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 120 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        {label}
      </Typography>
      <Box sx={{ typography: "body2" }}>{children}</Box>
    </Box>
  );
}

function Json({ value }: { value: unknown }) {
  return (
    <Box component="pre" sx={{ m: 0, fontFamily: font.mono, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {value === undefined ? "—" : JSON.stringify(value, null, 2)}
    </Box>
  );
}

/** A collapsed raw-JSON block. */
function RawJson({ title, value }: { title: string; value: unknown }) {
  return (
    <Box component="details" sx={{ "& summary": { cursor: "pointer", typography: "body2", fontWeight: 600, mb: 1 } }}>
      <summary>{title}</summary>
      <Json value={value} />
    </Box>
  );
}

/** The per-source verdicts as a table when they are a plain object, raw JSON otherwise. */
function Sources({ value }: { value: unknown }) {
  if (value == null) return <Typography variant="body2" color="text.secondary">No per-source verdicts stored.</Typography>;
  if (typeof value !== "object" || Array.isArray(value)) return <Json value={value} />;
  return (
    <Table size="small">
      <TableBody>
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <TableRow key={k}>
            <TableCell sx={{ fontWeight: 600, width: 160 }}>{k}</TableCell>
            <TableCell>
              {v !== null && typeof v === "object" ? <Json value={v} /> : String(v)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Approve / reject and the family-friendly tick for the word, with the model flags as warnings. */
function WordDecision({ word, actions }: { word: BankWordDetail; actions: WordActions }) {
  const { busy, onWord } = actions;
  return (
    <Section title="Approval">
      {word.warnings.length > 0 && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          The bank&apos;s model flagged this word: {word.warnings.join(", ")}. That is a warning only, so the family-friendly
          suggestion is &quot;not family friendly&quot;; you decide.
          {word.familyFriendly !== false && (
            <Button size="small" color="warning" disabled={busy} onClick={() => onWord({ familyFriendly: false })} sx={{ ml: 1 }}>
              Mark not family friendly
            </Button>
          )}
        </Alert>
      )}
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 2, alignItems: "center" }}>
        <Box>
          <ApprovalChip approval={word.approval} />
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {decidedLabel(word.approval.by, word.approval.at)}
          </Typography>
        </Box>
        <Button size="small" variant="contained" color="success" disabled={busy || word.approval.status === "approved"} onClick={() => onWord({ approval: "approved" })}>
          Approve word
        </Button>
        <Button size="small" variant="outlined" color="error" disabled={busy || word.approval.status === "rejected"} onClick={() => onWord({ approval: "rejected" })}>
          Reject word
        </Button>
        <Button size="small" disabled={busy || word.approval.status === "pending"} onClick={() => onWord({ approval: "pending" })}>
          Back to pending
        </Button>
        <Box sx={{ ml: { sm: 2 } }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={word.familyFriendly === true}
                disabled={busy}
                onChange={(e) => onWord({ familyFriendly: e.target.checked ? true : null })}
              />
            }
            label="Family friendly"
          />
          <FamilyChip value={word.familyFriendly} />
          <Button size="small" disabled={busy || word.familyFriendly === false} onClick={() => onWord({ familyFriendly: false })}>
            Not family friendly
          </Button>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {decidedLabel(word.familyFriendlyBy, word.familyFriendlyAt)}
          </Typography>
        </Box>
      </Stack>
    </Section>
  );
}

/** A stored model suggestion, marked as one. Accepting saves it as a new pending clue, never an approval. */
function SuggestionBox({ word, actions }: { word: BankWordDetail; actions: WordActions }) {
  const s = word.suggestion;
  const have = !!s?.clue && word.clues.some((c) => c.text.trim().toLowerCase() === s.clue.trim().toLowerCase());
  return (
    <Section title="Suggestion">
      {s ? (
        <Alert severity="info" icon={false}>
          <Typography variant="caption" sx={{ display: "block", fontWeight: 600 }}>
            SUGGESTION, not approved{s.model ? ` · ${s.model}` : ""}
          </Typography>
          {s.clue ? (
            <>
              <Typography variant="body1" sx={{ my: 0.5 }}>
                &ldquo;{s.clue}&rdquo;
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Suggests {s.familyFriendly ? "family friendly" : "not family friendly"}
                {s.reason ? ` — ${s.reason}` : ""}
              </Typography>
              <Button size="small" sx={{ mt: 1 }} disabled={actions.busy || have} onClick={() => actions.onWord({ acceptSuggestion: true })}>
                {have ? "Already a candidate clue" : "Add as a candidate clue"}
              </Button>
            </>
          ) : (
            <Typography variant="body2">
            No usable clue — {s.familyFriendly ? "family friendly: yes" : "family friendly: no"}
            {s.reason ? `, because ${s.reason}` : ""}
          </Typography>
          )}
        </Alert>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No suggestion stored.
        </Typography>
      )}
      <Button size="small" sx={{ mt: 1 }} disabled={actions.busy || actions.suggesting || !actions.onSuggest} onClick={actions.onSuggest}>
        {actions.suggesting ? "Queued, waiting for the suggestion…" : "Suggest"}
      </Button>
    </Section>
  );
}

/** One clue row: text (editable), status, family-friendly tick, who decided, and the decisions. */
function ClueRow({ clue, norm, wordId, actions }: { clue: BankClue; norm: string; wordId: string; actions: WordActions }) {
  const checked = toQueueClue(clue, norm);
  const { busy, onClue } = actions;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(clue.text);
  useEffect(() => setDraft(clue.text), [clue.text]);
  const save = () => {
    const t = draft.trim();
    if (t && t !== clue.text) onClue(clue.id, { text: t });
    setEditing(false);
  };
  return (
    <TableRow>
      <TableCell sx={{ minWidth: 240 }}>
        {editing ? (
          <TextField
            size="small"
            fullWidth
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            slotProps={{ htmlInput: { "aria-label": "Clue text" } }}
          />
        ) : (
          clue.text
        )}
        {checked.problem && (
          <Typography variant="caption" color="error" sx={{ display: "block" }}>
            Can&apos;t be approved: {PROBLEM_TEXT[checked.problem]}. Edit it first.
          </Typography>
        )}
        {clue.original && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            was: {clue.original}
          </Typography>
        )}
      </TableCell>
      <TableCell align="right">{clue.difficulty ?? "—"}</TableCell>
      <TableCell>{clue.source ?? "—"}</TableCell>
      <TableCell sx={{ fontFamily: font.mono, fontSize: 12 }}>{clue.model ?? "—"}</TableCell>
      <TableCell>
        <ApprovalChip approval={clue.approval} />
        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
          {decidedLabel(clue.approval.by, clue.approval.at)}
        </Typography>
      </TableCell>
      <TableCell>
        <Checkbox
          size="small"
          checked={clue.familyFriendly === true}
          disabled={busy}
          onChange={(e) => onClue(clue.id, { familyFriendly: e.target.checked ? true : null })}
          slotProps={{ input: { "aria-label": `Family friendly: ${clue.text}` } }}
        />
        <span title={decidedLabel(clue.familyFriendlyBy, clue.familyFriendlyAt) || undefined}>
          <FamilyChip value={clue.familyFriendly} />
        </span>
        <Button size="small" disabled={busy || clue.familyFriendly === false} onClick={() => onClue(clue.id, { familyFriendly: false })}>
          Not
        </Button>
      </TableCell>
      <TableCell sx={{ whiteSpace: "nowrap" }}>
        {editing ? (
          <>
            <Button size="small" disabled={busy} onClick={save}>
              Save
            </Button>
            <Button size="small" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="small" color="success" disabled={busy || clue.approval.status === "approved" || !!checked.problem} title={checked.cleaned !== clue.text ? `Approval stores: ${checked.cleaned}` : undefined}
              onClick={() => onClue(clue.id, { approval: "approved" }, wordId)}>
              Approve
            </Button>
            <Button size="small" disabled={busy} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button size="small" color="error" disabled={busy || clue.approval.status === "rejected"} onClick={() => onClue(clue.id, { approval: "rejected" })}>
              Reject
            </Button>
          </>
        )}
      </TableCell>
    </TableRow>
  );
}

export function WordDetailView({ word, actions = NO_ACTIONS }: { word: BankWordDetail; actions?: WordActions }) {
  return (
    <Stack spacing={1.75}>
      <WordDecision word={word} actions={actions} />
      <SuggestionBox word={word} actions={actions} />

      <Section title="Word">
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 3 }}>
          <Fact label="Length">{word.length}</Fact>
          <Fact label="Clue status">
            <ClueStatusChip status={word.clueStatus} />
          </Fact>
          <Fact label="Decision">
            <DecisionChip decision={word.decision} by={word.decisionBy} />
          </Fact>
          <Fact label="Frequency">{zipfLabel(word.zipf)}</Fact>
          <Fact label="Part of speech">{word.pos.join(", ") || "—"}</Fact>
          <Fact label="Flags">
            <FlagChips flags={word.flags} />
          </Fact>
          <Fact label="Model">{word.model ?? "—"}</Fact>
          <Fact label="Updated">{fmtTime(word.updatedAt)}</Fact>
        </Stack>
        {word.reason && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            Reason: {word.reason}
          </Typography>
        )}
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mt: 1.5 }} aria-label="Categories">
          {word.categories.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No categories.
            </Typography>
          ) : (
            word.categories.map((c) => <Chip key={c} size="small" label={c} variant="outlined" />)
          )}
        </Stack>
      </Section>

      <Section title={`Senses (${word.senses.length})`}>
        {word.senses.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No senses stored.
          </Typography>
        ) : (
          <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
            {word.senses.map((s, i) => (
              <Box component="li" key={i} sx={{ mb: 1 }}>
                {s.pos && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                    {s.pos}
                  </Typography>
                )}
                {s.definitions.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    —
                  </Typography>
                ) : (
                  s.definitions.map((d, j) => (
                    <Typography key={j} variant="body2">
                      {d}
                    </Typography>
                  ))
                )}
              </Box>
            ))}
          </Box>
        )}
      </Section>

      <Section title={`Wiktionary definitions (${word.definitions.length})`}>
        {word.definitions.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            None stored.
          </Typography>
        ) : (
          <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
            {word.definitions.map((d, i) => (
              <Typography component="li" key={i} variant="body2" sx={{ mb: 0.5 }}>
                {d}
              </Typography>
            ))}
          </Box>
        )}
      </Section>

      <Section title={`Clues (${word.clues.length})`}>
        {word.clues.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No clues written.
          </Typography>
        ) : (
          <Table size="small" aria-label="Clues">
            <TableHead>
              <TableRow>
                <TableCell>Clue</TableCell>
                <TableCell align="right">Difficulty</TableCell>
                <TableCell>Source</TableCell>
                <TableCell>Model</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Family friendly</TableCell>
                <TableCell>Decide</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {word.clues.map((c) => (
                <ClueRow key={c.id} clue={c} norm={word.word.toUpperCase().replace(/[^A-Z]/g, "")} wordId={word.id} actions={actions} />
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Validation">
        <Stack direction="row" sx={{ gap: 3, mb: 1.5 }}>
          <Fact label="Verdict">
            <DecisionChip decision={word.decision} by={word.decisionBy} />
          </Fact>
          <Fact label="Frequency">{zipfLabel(word.zipf)}</Fact>
        </Stack>
        <Sources value={word.validationSources} />
      </Section>

      <Section title="Raw">
        <Stack spacing={1}>
          <RawJson title="Clue attempts" value={word.raw.attempts} />
          <RawJson title="Validation" value={word.raw.validation} />
        </Stack>
      </Section>
    </Stack>
  );
}

export default function WordDetail({ id }: { id: string }) {
  const [word, setWord] = useState<BankWordDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const watching = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    getBankWord(id).then((res) => {
      if (!live) return;
      if (res.ok) setWord(res.data);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [id]);

  /** Run a decision, then show the word as the server now has it. */
  const decide = async (run: () => Promise<Outcome<unknown>>) => {
    setBusy(true);
    setActionError(null);
    const res = await run();
    if (!res.ok) setActionError(res.error);
    else {
      const fresh = await getBankWord(id).then((r) => (r.ok ? r.data : null));
      if (fresh) setWord(fresh);
    }
    setBusy(false);
  };
  /** Queue the job, then refetch until the stored suggestion changes (or give up quietly). */
  const suggest = async () => {
    if (watching.current) return;
    watching.current = true;
    setSuggesting(true);
    setActionError(null);
    const before = word?.suggestion?.at;
    const res = await postSuggest([id]);
    if (!res.ok) setActionError(res.error);
    else {
      let arrived = false;
      for (let i = 0; i < SUGGEST_POLL_MAX && !arrived; i++) {
        await new Promise((r) => setTimeout(r, SUGGEST_POLL_MS));
        if (!mounted.current) return;
        const fresh = await getBankWord(id).then((r) => (r.ok ? r.data : null));
        if (!mounted.current) return;
        if (fresh) setWord(fresh);
        arrived = !!fresh?.suggestion && fresh.suggestion.at !== before;
      }
      if (!arrived) setActionError("The suggestion has not arrived yet. The job may still be running or may have failed; reload to check, or try again.");
    }
    watching.current = false;
    setSuggesting(false);
  };
  const actions: WordActions = {
    busy,
    onSuggest: suggest,
    suggesting,
    onWord: (patch) => decide(() => patchBankWord(id, patch)),
    onClue: (clueId, patch, wordId) => decide(() => patchBankClue(clueId, patch, wordId)),
  };

  return (
    <AdminPageShell
      title={word?.word ?? "Word"}
      maxWidth={1200}
      crumbs={[
        { href: "/admin/crosswords", label: "Crosswords" },
        { href: "/admin/crosswords/words", label: "Words" },
        { label: word?.word ?? id },
      ]}
    >
      {error ? (
        <Alert severity="error">Couldn&apos;t load this word: {error}</Alert>
      ) : !word ? (
        <Typography color="text.secondary">Loading…</Typography>
      ) : (
        <>
          {actionError && (
            <Alert severity="error" sx={{ mb: 1.5 }}>
              Couldn&apos;t save that: {actionError}
            </Alert>
          )}
          <WordDetailView word={word} actions={actions} />
        </>
      )}
    </AdminPageShell>
  );
}
