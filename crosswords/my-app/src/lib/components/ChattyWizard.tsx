
"use client"
import * as React from "react";
import {
  Box,
  Button,
  Divider,
  Paper,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
  MenuItem,
  Chip,
  List,
  ListItem,
  ListItemText,
} from "@mui/material";
import { alpha, Theme } from "@mui/material/styles";
import { FormProvider, useForm, Controller } from "react-hook-form";

export type QuestionDef = {
  id: string;
  step: number;
  order: number;
  section?: string;
  title: string;
  description?: string;
  type: "text" | "textarea" | "select" | "radio" | "boolean" | "number" | "date";
  required?: boolean;
  options?: { value: string; label: string }[];
};

export type WizardFormValues = {
  auditTypeId: string;
  answers: Record<string, any>;
};

export type FormPatch = {
  updates: Array<{ questionId: string; value: any; confidence?: number; reason?: string }>;
  followUps?: string[];
};

const groupSteps = (questions: QuestionDef[]) => {
  const steps = Array.from(new Set(questions.map((q) => q.step))).sort((a, b) => a - b);
  return steps;
};

const questionsForStep = (questions: QuestionDef[], step: number) =>
  questions
    .filter((q) => q.step === step)
    .sort((a, b) => a.order - b.order);

export const ChatWizard = (props: {
  auditTypeId: string;
  questions: QuestionDef[];
  onChatExtract: (args: {
    message: string;
    auditTypeId: string;
    // Helpful context to give the model:
    currentStep: number;
    visibleQuestionIds: string[];
    // Current answers so it can "edit" instead of duplicate:
    currentAnswers: Record<string, any>;
  }) => Promise<FormPatch>;
  onSaveDraft?: (values: WizardFormValues) => Promise<void> | void;
  onSubmitFinal?: (values: WizardFormValues) => Promise<void> | void;
}) => {
  const steps = React.useMemo(() => groupSteps(props.questions), [props.questions]);

  const methods = useForm<WizardFormValues>({
    defaultValues: {
      auditTypeId: props.auditTypeId,
      answers: seedAnswers(props.questions),
    },
    mode: "onBlur",
  });

  const [activeIdx, setActiveIdx] = React.useState(0);
  const activeStep = steps[activeIdx] ?? 0;

  const visibleQs = React.useMemo(
    () => questionsForStep(props.questions, activeStep),
    [props.questions, activeStep]
  );

  // Chat state
  const [chatInput, setChatInput] = React.useState("");
  const [chatLog, setChatLog] = React.useState<Array<{ role: "user" | "assistant"; text: string }>>(
    []
  );

  // Patch staging
  const [pendingPatch, setPendingPatch] = React.useState<FormPatch | null>(null);
  const [busy, setBusy] = React.useState(false);

  const onNext = async () => {
    // validate required fields on this step
    const ok = await validateStepRequired(methods.getValues("answers"), visibleQs, methods.setError);
    if (!ok) return;
    setActiveIdx((i) => Math.min(i + 1, steps.length - 1));
  };

  const onBack = () => setActiveIdx((i) => Math.max(i - 1, 0));

  const onApplyPatch = () => {
    if (!pendingPatch) return;
    const answers = methods.getValues("answers");
    const next = { ...answers };

    for (const u of pendingPatch.updates) {
      next[u.questionId] = u.value;
    }

    methods.setValue("answers", next, { shouldDirty: true, shouldTouch: true });
    setPendingPatch(null);
  };

  const onSendChat = async () => {
    const msg = chatInput.trim();
    if (!msg) return;

    setChatInput("");
    setChatLog((l) => [...l, { role: "user", text: msg }]);

    try {
      setBusy(true);

      const patch = await props.onChatExtract({
        message: msg,
        auditTypeId: props.auditTypeId,
        currentStep: activeStep,
        visibleQuestionIds: visibleQs.map((q) => q.id),
        currentAnswers: methods.getValues("answers"),
      });

      setPendingPatch(patch);

      const followUps = (patch.followUps ?? []).slice(0, 3);
      setChatLog((l) => [
        ...l,
        {
          role: "assistant",
          text:
            patch.updates.length
              ? `I can fill ${patch.updates.length} field(s) from that. Review and apply the changes on the right.`
              : `I didn’t confidently map that to fields yet.`,
        },
        ...(followUps.length
          ? [{ role: "assistant" as const, text: `Quick follow-ups: ${followUps.join(" • ")}` }]
          : []),
      ]);
    } catch (e: any) {
      setChatLog((l) => [
        ...l,
        { role: "assistant", text: `Sorry — chat extraction failed: ${e?.message ?? "unknown"}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const onSaveDraft = async () => {
    setBusy(true);
    try {
      await props.onSaveDraft?.(methods.getValues());
    } finally {
      setBusy(false);
    }
  };

  const onSubmitFinal = methods.handleSubmit(async (values) => {
    setBusy(true);
    try {
      await props.onSubmitFinal?.(values);
    } finally {
      setBusy(false);
    }
  });

  return (
    <FormProvider {...methods}>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.65fr 1fr" }, gap: 2 }}>
        {/* LEFT: Wizard */}
        <Paper sx={{ p: 2.5, borderRadius: 3, backdropFilter: "blur(10px)" }}>
          <Stepper activeStep={activeIdx} sx={{ mb: 2 }}>
            {steps.map((s) => (
              <Step key={s}>
                <StepLabel>{`Step ${s}`}</StepLabel>
              </Step>
            ))}
          </Stepper>

          <Box sx={{ display: "grid", gap: 2 }}>
            {visibleQs.map((q) => (
              <QuestionField key={q.id} q={q} />
            ))}
          </Box>

          <Box sx={{ display: "flex", justifyContent: "space-between", mt: 2, gap: 1 }}>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button variant="outlined" onClick={onBack} disabled={activeIdx === 0 || busy}>
                Back
              </Button>
              <Button variant="text" onClick={onSaveDraft} disabled={busy}>
                Save draft
              </Button>
            </Box>

            <Box sx={{ display: "flex", gap: 1 }}>
              {activeIdx < steps.length - 1 ? (
                <Button variant="contained" onClick={onNext} disabled={busy}>
                  Next
                </Button>
              ) : (
                <Button variant="contained" onClick={onSubmitFinal} disabled={busy}>
                  Submit
                </Button>
              )}
            </Box>
          </Box>
        </Paper>

        {/* RIGHT: Chat + Patch */}
        <Paper sx={{ p: 2.5, borderRadius: 3, display: "grid", gap: 2, backdropFilter: "blur(10px)" }}>
          <Typography variant="h6" sx={{ letterSpacing: 0.2 }}>
            Thread Assistant
          </Typography>

          <Box
            sx={(theme: Theme) => ({
              maxHeight: 320,
              overflow: "auto",
              border: `1px solid ${alpha(theme.palette.text.primary, 0.16)}`,
              p: 1.2,
              borderRadius: 2.5,
              bgcolor: alpha(theme.palette.background.default, 0.55),
              display: "grid",
              gap: 1,
            })}
          >
            {chatLog.length === 0 ? (
              <Typography variant="body2" sx={{ opacity: 0.74 }}>
                Try: “We found 3 fire doors not closing properly, recommend replacing closers within 14 days.”
              </Typography>
            ) : (
              <List dense disablePadding sx={{ display: "grid", gap: 1 }}>
                {chatLog.map((m, i) => (
                  <ListItem
                    key={i}
                    sx={(theme: Theme) => ({
                      p: 1,
                      borderRadius: 2,
                      border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
                      bgcolor:
                        m.role === "user"
                          ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.22 : 0.1)
                          : alpha(theme.palette.background.paper, 0.88),
                      justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                    })}
                  >
                    <ListItemText
                      primary={
                        <Typography
                          variant="body2"
                          sx={{ fontWeight: 700, opacity: 0.8, textAlign: m.role === "user" ? "right" : "left" }}
                        >
                          {m.role === "user" ? "You" : "Bot"}
                        </Typography>
                      }
                      secondary={
                        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", textAlign: m.role === "user" ? "right" : "left" }}>
                          {m.text}
                        </Typography>
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </Box>

          <Box sx={{ display: "flex", gap: 1 }}>
            <TextField
              value={chatInput}
              onChange={(e:any) => setChatInput(e.target.value)}
              placeholder="Type what you observed…"
              fullWidth
              size="small"
              onKeyDown={(e:any) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSendChat();
                }
              }}
              multiline
              minRows={2}
              sx={(theme: Theme) => ({
                "& .MuiOutlinedInput-root": {
                  borderRadius: 2,
                  bgcolor: alpha(theme.palette.background.paper, 0.7),
                },
              })}
            />
            <Button variant="contained" onClick={onSendChat} disabled={busy}>
              Send
            </Button>
          </Box>

          <Divider />

          <Typography variant="subtitle1">Proposed changes</Typography>

          {!pendingPatch ? (
            <Typography variant="body2" sx={{ opacity: 0.7 }}>
              Nothing pending. Chat will propose updates here.
            </Typography>
          ) : (
            <>
              <Box sx={{ display: "grid", gap: 1 }}>
                {pendingPatch.updates.slice(0, 8).map((u, i) => (
                  <Box
                    key={i}
                    sx={(theme: Theme) => ({
                      border: `1px solid ${alpha(theme.palette.text.primary, 0.16)}`,
                      borderRadius: 2,
                      p: 1,
                      display: "grid",
                      gap: 0.5,
                      bgcolor: alpha(theme.palette.background.default, 0.5),
                    })}
                  >
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                      {u.questionId}
                      {u.confidence != null ? (
                        <Chip size="small" sx={{ ml: 1 }} label={`${Math.round(u.confidence * 100)}%`} />
                      ) : null}
                    </Typography>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                      {String(u.value)}
                    </Typography>
                    {u.reason ? (
                      <Typography variant="caption" sx={{ opacity: 0.7 }}>
                        {u.reason}
                      </Typography>
                    ) : null}
                  </Box>
                ))}
              </Box>

              <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
                <Button variant="outlined" onClick={() => setPendingPatch(null)} disabled={busy}>
                  Discard
                </Button>
                <Button variant="contained" onClick={onApplyPatch} disabled={busy || pendingPatch.updates.length === 0}>
                  Apply to form
                </Button>
              </Box>
            </>
          )}
        </Paper>
      </Box>
    </FormProvider>
  );
};

// --- seed answers so every question has a key
const seedAnswers = (questions: QuestionDef[]) => {
  const out: Record<string, any> = {};
  for (const q of questions) out[q.id] = out[q.id] ?? "";
  return out;
};

const validateStepRequired = async (
  answers: Record<string, any>,
  visibleQs: QuestionDef[],
  setError: (name: any, error: any) => void
) => {
  let ok = true;
  for (const q of visibleQs) {
    if (!q.required) continue;
    const v = answers[q.id];
    const empty =
      v == null ||
      v === "" ||
      (typeof v === "string" && v.trim() === "") ||
      (Array.isArray(v) && v.length === 0);
    if (empty) {
      ok = false;
      setError(`answers.${q.id}` as any, { type: "required", message: "Required" });
    }
  }
  return ok;
};

const QuestionField = ({ q }: { q: QuestionDef }) => {
  const { control } = useFormContextTyped();

  const name = `answers.${q.id}` as const;

  const common = {
    label: q.title,
    helperText: q.description,
    fullWidth: true,
  };

  if (q.type === "select") {
    return (
      <Controller
        name={name}
        control={control}
        rules={{ required: q.required ? "Required" : false }}
        render={({ field, fieldState }) => (
          <TextField
            {...field}
            {...common}
            select
            error={!!fieldState.error}
            helperText={fieldState.error?.message ?? q.description}
          >
            {(q.options ?? []).map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
        )}
      />
    );
  }

  if (q.type === "boolean") {
    return (
      <Controller
        name={name}
        control={control}
        rules={{ required: q.required ? "Required" : false }}
        render={({ field, fieldState }) => (
          <TextField
            {...field}
            {...common}
            select
            error={!!fieldState.error}
            helperText={fieldState.error?.message ?? q.description}
          >
            <MenuItem value={"true"}>Yes</MenuItem>
            <MenuItem value={"false"}>No</MenuItem>
          </TextField>
        )}
      />
    );
  }

  return (
    <Controller
      name={name}
      control={control}
      rules={{ required: q.required ? "Required" : false }}
      render={({ field, fieldState }) => (
        <TextField
          {...field}
          {...common}
          type={q.type === "number" ? "number" : q.type === "date" ? "date" : "text"}
          InputLabelProps={q.type === "date" ? { shrink: true } : undefined}
          multiline={q.type === "textarea"}
          minRows={q.type === "textarea" ? 4 : undefined}
          error={!!fieldState.error}
          helperText={fieldState.error?.message ?? q.description}
        />
      )}
    />
  );
};

import { useFormContext } from "react-hook-form";
const useFormContextTyped = () => useFormContext<WizardFormValues>();
