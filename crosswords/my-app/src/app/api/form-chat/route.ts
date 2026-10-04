import OpenAI from "openai";

//const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const client = new OpenAI({ baseURL: "http://localhost:9090/v1",});
const EXTRACTION_MODEL = "meta-llama/Llama-3.2-3B-Instruct";

// match your QuestionDef
type QuestionDef = {
    id: string;
    title: string;
    description?: string;
    type: "text" | "textarea" | "select" | "radio" | "boolean" | "number" | "date";
    required?: boolean;
    options?: { value: string; label: string }[];
};

type Body = {
    message: string;
    auditTypeId: string;
    currentStep: number;
    visibleQuestionIds: string[];
    questions: QuestionDef[];            // send the questions for this audit type (or just visible step)
    currentAnswers: Record<string, any>; // current RHF answers map
};

type FormPatch = {
    original?: string;
    updates: Array<{ questionId: string; value: any; confidence?: number; reason?: string }>;
    followUps?: string[];
};

const normalizeLoose = (s: string) =>
    s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

const isLikelyQuestionEcho = (value: string, q: QuestionDef) => {
    const v = normalizeLoose(value);
    if (!v) return false;

    const title = normalizeLoose(q.title ?? "");
    const descRaw = q.description ?? "";
    const desc = normalizeLoose(descRaw);
    const descNoPreamble = normalizeLoose(descRaw.replace(/^preamble:\s*/i, ""));

    // Only flag obvious prompt-copy behavior; avoid catching short, legitimate answers.
    if (v.length < 40) return false;

    // Direct echo or near-direct echo of question content.
    if (title && (v === title || v.includes(title))) return true;
    if (desc && (v === desc || v.includes(desc) || desc.includes(v))) return true;
    if (
        descNoPreamble &&
        (v === descNoPreamble || v.includes(descNoPreamble) || descNoPreamble.includes(v))
    ) {
        return true;
    }

    return false;
};

const normalizeUserMessage = (text: string) => {
    return String(text ?? "")
        .replace(/\r\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
};

const isLikelyOffTopicMessage = (text: string) => {
    const m = normalizeLoose(text);
    if (!m) return true;
    const patterns = [
        /^hi$/,
        /^hello$/,
        /^hey$/,
        /^how are you$/,
        /^hows it going$/,
        /^what s up$/,
        /^who are you$/,
        /^thanks$/,
        /^thank you$/,
        /^good morning$/,
        /^good afternoon$/,
        /^good evening$/,
    ];
    return patterns.some((p) => p.test(m));
};

const isGenericChatText = (text: string) => {
    const m = normalizeLoose(text);
    if (!m) return true;
    const patterns = [
        /^i am (good|fine|ok|okay)$/,
        /^i m (good|fine|ok|okay)$/,
        /^doing (good|fine|ok|okay)$/,
        /^nice to meet you$/,
        /^how can i help$/,
        /^what can i help with$/,
    ];
    return patterns.some((p) => p.test(m));
};

const isLowSignalText = (text: string) => {
    const m = normalizeLoose(text);
    const low = new Set([
        "ok",
        "okay",
        "yes",
        "no",
        "fine",
        "good",
        "not sure",
        "unknown",
        "n a",
        "na",
    ]);
    return low.has(m);
};

const compressDescription = (description?: string) => {
    if (!description) return "";
    const cleaned = description.replace(/^preamble:\s*/i, "").trim();
    return cleaned.length > 220 ? `${cleaned.slice(0, 220)}...` : cleaned;
};

const sanitizeAnswer = (q: QuestionDef, value: any) => {
    if (typeof value !== "string") return value;
    const v = normalizeLoose(value);
    const t = normalizeLoose(q.title ?? "");
    const d = normalizeLoose(q.description ?? "");
    if (!v) return "";
    // Treat accidental prompt echoes as "not answered" for model context.
    if ((t && v === t) || (d && v === d)) return "";
    return value;
};

const STOP_WORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
    "i", "if", "in", "is", "it", "of", "on", "or", "that", "the", "their", "this",
    "to", "was", "we", "were", "with",
]);

const tokenize = (s: string) =>
    normalizeLoose(s)
        .split(" ")
        .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

const overlap = (a: string[], b: string[]) => {
    if (!a.length || !b.length) return 0;
    const bSet = new Set(b);
    let count = 0;
    for (const t of a) {
        if (bSet.has(t)) count += 1;
    }
    return count;
};

const selectBestTextQuestionId = (
    message: string,
    visibleQuestions: QuestionDef[],
    currentAnswers: Record<string, any>
) => {
    const msgTokens = tokenize(message);
    if (!msgTokens.length) return null;

    const candidates = visibleQuestions.filter((q) => q.type === "text" || q.type === "textarea");
    if (!candidates.length) return null;

    const scored = candidates
        .map((q) => {
            const titleHits = overlap(msgTokens, tokenize(q.title ?? ""));
            const descHits = overlap(msgTokens, tokenize(q.description ?? ""));
            const semanticScore = titleHits * 3 + descHits;
            const v = currentAnswers[q.id];
            const emptyBoost = v == null || (typeof v === "string" && v.trim() === "") ? 1 : 0;
            return { id: q.id, semanticScore, score: semanticScore + emptyBoost };
        })
        .sort((a, b) => b.score - a.score);

    return (scored[0]?.semanticScore ?? 0) > 0 ? scored[0].id : null;
};

const buildClarifyingFollowUp = (visibleQuestions: Array<{ title: string }>) => {
    const titles = visibleQuestions
        .map((q) => String(q.title ?? "").trim())
        .filter(Boolean)
        .slice(0, 3);

    if (!titles.length) {
        return "What should I record for the current form question?";
    }

    return `What should I record for: ${titles.join(" / ")}?`;
};

const buildLLMQuestions = (questions: QuestionDef[], visibleIds: string[]) => {
    const allowed = new Set(visibleIds);
    return questions
        .filter((q) => allowed.has(q.id))
        .map((q) => ({
            id: q.id,
            title: q.title,
            description: compressDescription(q.description),
            type: q.type,
            // only pass option VALUES (the only things we can store)
            options: q.options?.map((o) => o.value) ?? [],
        }));
};
const buildPatchSchema = (allowedIds: string[]) => ({
    name: "form_patch",
    schema: {
        type: "object",
        additionalProperties: false,
        properties: {
            updates: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        questionId: { type: "string", enum: allowedIds as string[] },
                        value: {
                            anyOf: [
                                { type: "string" },
                                { type: "number" },
                                { type: "boolean" },
                                { type: "null" },
                                { type: "array", items: { type: "string" } },
                            ],
                        },
                    },
                    required: ["questionId", "value"], // ✅ now consistent
                },

            },
            followUps: { type: "array", items: { type: "string" } },
        },
        required: ["updates", "followUps"],
    },
} as const);

const coerceValueToType = (q: QuestionDef, v: any) => {
    if (v == null) return v;

    if (q.type === "boolean") {
        if (typeof v === "boolean") return v;
        if (typeof v === "string") {
            const s = v.trim().toLowerCase();
            if (["yes", "true", "y", "1"].includes(s)) return true;
            if (["no", "false", "n", "0"].includes(s)) return false;
        }
        return v; // leave as-is if uncertain
    }

    if (q.type === "number") {
        if (typeof v === "number") return v;
        const n = Number(v);
        return Number.isFinite(n) ? n : v;
    }

    if (q.type === "date") {
        // expect YYYY-MM-DD for <input type="date">
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
        return v;
    }

    // select/radio: enforce allowed values if options exist
    if ((q.type === "select" || q.type === "radio") && q.options?.length) {
        const s = String(v);
        const allowed = new Set(q.options.map((o) => o.value));
        return allowed.has(s) ? s : v;
    }

    // text/textarea default
    return typeof v === "string" ? v : String(v);
};

export async function POST(req: Request) {
    try {
        const body = (await req.json()) as Body;
        const cleanedMessage = normalizeUserMessage(body.message);

        console.log(body)
        // start safe: only allow updates to *visible* questions on this step
        const visibleQuestions = buildLLMQuestions(body.questions, body.visibleQuestionIds);
        const allowedIds = visibleQuestions.map((q) => q.id);
        const sanitizedCurrentAnswers = Object.fromEntries(
            allowedIds.map((id) => {
                const q = body.questions.find((x) => x.id === id);
                const raw = body.currentAnswers?.[id];
                return [id, q ? sanitizeAnswer(q, raw) : raw];
            })
        );

        if (isLikelyOffTopicMessage(cleanedMessage)) {
            return Response.json({
                updates: [],
                followUps: [buildClarifyingFollowUp(visibleQuestions)],
            } as FormPatch);
        }

        const schema = buildPatchSchema(allowedIds);

        const payload = {
            auditTypeId: body.auditTypeId,
            currentStep: body.currentStep,
            questions: visibleQuestions,
            currentAnswers: sanitizedCurrentAnswers,
            userMessage: cleanedMessage,
            rules: [
                "Only update questionIds from questions[].id.",
                "If unsure, do not guess — add a followUp question instead.",
                "For boolean use true/false.",
                "For date use YYYY-MM-DD.",
                "For select/radio use one of options[].",
                "For text/textarea, use the user's words from userMessage. Never copy question title/description/preamble into answer values.",
                "If userMessage is a short note, map it to the single best matching visible question by title meaning.",
            ],
        };


        const resp = await client.responses.create({
            model: EXTRACTION_MODEL,
            input: JSON.stringify(payload),
            text: {
                format: {
                    name: schema.name,
                    type: "json_schema",
                    strict: true,
                    schema: schema.schema, // ✅ NOT json_schema
                },
            },
            temperature: 0.0, // important for obedience,
        });
        console.log(resp)
        // Safer parse: output_text is the SDK convenience for text responses
        const patch = JSON.parse(resp.output_text) as FormPatch;

        // Hard safety: filter to allowed IDs & coerce values based on QuestionDef
        const qMap = new Map(body.questions.map((q) => [q.id, q]));
        patch.updates = (patch.updates ?? [])
            .filter((u) => allowedIds.includes(u.questionId))
            .map((u) => {
                const q = qMap.get(u.questionId);
                if (!q) return u;

                let nextValue = coerceValueToType(q, u.value);

                // Guard against prompt-echo: small models may copy long preambles/descriptions.
                if (
                    typeof nextValue === "string" &&
                    (q.type === "text" || q.type === "textarea") &&
                    isLikelyQuestionEcho(nextValue, q)
                ) {
                    const spoken = String(cleanedMessage ?? "").trim();
                    if (spoken) nextValue = spoken;
                }

                if (typeof nextValue === "string" && (q.type === "text" || q.type === "textarea")) {
                    nextValue = normalizeUserMessage(nextValue);
                }

                return { ...u, value: nextValue };
            })
            .filter((u) => {
                const q = qMap.get(u.questionId);
                if (!q) return false;
                if (u.value == null) return false;

                if (typeof u.value === "string" && (q.type === "text" || q.type === "textarea")) {
                    const text = u.value.trim();
                    if (!text) return false;
                    if (isLikelyQuestionEcho(text, q)) return false;
                    if (isGenericChatText(text)) return false;
                    if (isLowSignalText(text)) return false;
                }

                return true;
            });

        // Collapse bad multi-map outputs where the same text is repeated across many text fields.
        if (patch.updates.length > 1) {
            const textUpdates = patch.updates.filter((u) => {
                const q = qMap.get(u.questionId);
                return (
                    q &&
                    (q.type === "text" || q.type === "textarea") &&
                    typeof u.value === "string"
                );
            });

            const sameValueEverywhere =
                textUpdates.length === patch.updates.length &&
                new Set(textUpdates.map((u) => normalizeLoose(String(u.value)))).size === 1;

            if (sameValueEverywhere) {
                const value = String(textUpdates[0].value);
                const visibleFullDefs = body.questions.filter((qq) => allowedIds.includes(qq.id));
                const bestId = selectBestTextQuestionId(
                    value,
                    visibleFullDefs,
                    sanitizedCurrentAnswers
                );
                const base = textUpdates.find((u) => u.questionId === bestId) ?? textUpdates[0];

                patch.updates = [
                    {
                        ...base,
                        questionId: bestId ?? base.questionId,
                        value,
                        reason: "collapsed_duplicate_multi_map",
                    },
                ];
            }
        }

        // If model used the raw message but selected the wrong text question, remap generically.
        if (patch.updates.length === 1) {
            const u = patch.updates[0];
            const q = qMap.get(u.questionId);
            if (
                q &&
                typeof u.value === "string" &&
                (q.type === "text" || q.type === "textarea") &&
                normalizeLoose(u.value) === normalizeLoose(cleanedMessage)
            ) {
                const visibleFullDefs = body.questions.filter((qq) => allowedIds.includes(qq.id));
                const bestId = selectBestTextQuestionId(
                    cleanedMessage,
                    visibleFullDefs,
                    sanitizedCurrentAnswers
                );
                if (bestId) {
                    u.questionId = bestId;
                } else {
                    patch.updates = [];
                }
            }
        }

        if (patch.updates.length === 0) {
            patch.followUps = [
                ...(patch.followUps ?? []),
                buildClarifyingFollowUp(visibleQuestions),
            ];
        }
        

        patch.original = body.message
        return Response.json(patch);
    } catch (err: any) {
        return Response.json(
            { error: err?.message ?? "Patch extraction failed" },
            { status: 500 }
        );
    }
}
