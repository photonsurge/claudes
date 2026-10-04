"use client"
import { ChatWizard, FormPatch, QuestionDef } from "@/lib/components/ChattyWizard";
import { Container, Stack, Typography } from "@mui/material";

export const exampleQuestions: QuestionDef[] = [
    // {
    //     id: "Q1_1",
    //     step: 1,
    //     order: 1,
    //     section: "Roles and Responsibilities",
    //     title: "High-level responsibility for fire safety",
    //     description:
    //         "Does the organisation clearly define overall responsibility for fire safety at Board / senior management level?",
    //     type: "select",
    //     required: true,
    //     options: [
    //         { value: "compliant", label: "Compliant" },
    //         { value: "partial", label: "Partially compliant" },
    //         { value: "non", label: "Non-compliant" },
    //     ],
    // },
    {
        id: "Q1_1",
        step: 1,
        order: 1,
        section: "Roles and Responsibilities",
        title: "1.1 High level responsibility for fire",
        description:
            "Preamble: The Chief Executive will, on behalf of the Trust Board, be responsible for ensuring that current fire legislation is complied with, as well as compliance with the Department of Health’s Fire Code (HTM 05). The Chief Executive may discharge day to day operational responsibility for Fire Safety through the Director with fire safety responsibility (Board Level). These responsibilities include the following:",
        type: "textarea",
        required: true,
    },

    {
        id: "Q1_2",
        step: 1,
        order: 2,
        section: "Roles and Responsibilities",
        title: "1.2 Fire safety management",
        description:
            "Preamble: The Fire Safety Manager (FSM) acts as a focus for all fire safety matters. While the FSM may have a different line manager, accountability or fire safety matters should always be through the Board Level Director. The role of the fire safety manager may be combined with other operational roles such as health and safety, risk, local security and emergency planning. However, when nominating the FSM, it will be necessary to ensure there are clearly defined areas of responsibility, and an integrated approach to avoid conflict with any overlapping responsibilities. These responsibilities include the following:",
        type: "textarea",
        required: true,
    },
    {
        id: "Q1_3",
        step: 1,
        order: 3,
        section: "Fire risk assessment",
        title: "1.3 Fire safety advise",
        description:
            "Preamble: The Fire Safety Advisor (FSA) is accountable for matters of fire safety. This person, or persons, provide competent fire safety advice and is responsible for:",
        type: "textarea",
        required: false,
    },
    {
        id: "Q1_4",
        step: 1,
        order: 4,
        section: "Fire risk assessment",
        title: "1.4 Fire systems designers, installers, and maintainers",
        description:
            "Preamble: Persons or organisations (internal or external) appointed by the Trust to design, install, commission, and maintain active and passive fire systems, and firefighting equipment, must demonstrate sound knowledge and specific skills in the specialist service that is to be provided. For Persons, they should be registered with an appropriate fire industry accreditation scheme. Examples of such schemes include those provided by BAFE (British Approvals for Fire Equipment. the case of external Approvals for Fire Equipment) and LPCB (Loss Prevention Certification Board).",
        type: "textarea",
        required: false,
    },
    {
        id: "Q3_1",
        step: 3,
        order: 1,
        section: "Means of escape",
        title: "Means of escape adequate",
        description:
            "Are the means of escape adequate for the occupancy and use of the building?",
        type: "select",
        required: true,
        options: [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
            { value: "partial", label: "Partially" },
        ],
    },
    {
        id: "Q3_2",
        step: 3,
        order: 2,
        section: "Means of escape",
        title: "Means of escape deficiencies",
        description:
            "If applicable, describe any deficiencies identified with the means of escape.",
        type: "textarea",
        required: false,
    },
];
type LLMQuestion = {
    id: string;
    title: string;
    description?: string;
    type: "text" | "textarea" | "select" | "radio" | "boolean" | "number" | "date";
    options?: string[]; // enum values only
};

export const buildLLMQuestions = (
    questions: QuestionDef[],
    visibleQuestionIds?: string[]
): LLMQuestion[] => {
    const allowed = visibleQuestionIds
        ? new Set(visibleQuestionIds)
        : null;

    return questions
        .filter((q) => (allowed ? allowed.has(q.id) : true))
        .map((q) => ({
            id: q.id,
            title: q.title,
            description: q.description,
            type: q.type,
            options: q.options?.map((o) => o.value),
        }));
};

const onChatExtract = async (args: {
    message: string;
    auditTypeId: string;
    currentStep: number;
    visibleQuestionIds: string[];
    currentAnswers: Record<string, any>;
}) => {
    console.log("onChatExtract", args)
    const s = buildLLMQuestions(exampleQuestions, args.visibleQuestionIds)

    console.log("onChatExtract", s)
    const res = await fetch("/api/form-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            ...args,
            questions: s, // pass visible questions (best to start)
        }),
    });

    if (!res.ok) throw new Error((await res.json())?.error ?? "extract failed");
    return res.json();
};



const saveDraft = async (values: any) => {
    console.log("SAVE DRAFT", values);
    // POST /api/audits/:id/draft
};

const submitFinal = async (values: any) => {
    console.log("SUBMIT FINAL", values);
    // POST /api/audits/:id/submit
};


const AuditWizardPage = () => {
    return (
        <Container maxWidth="xl" sx={{ py: 2 }}>
            <Stack gap={1.5}>
                <Typography variant="h5">Wizard</Typography>
                <ChatWizard
                    auditTypeId="AE_FIRE_SAFETY"
                    questions={exampleQuestions}
                    onChatExtract={onChatExtract}
                    onSaveDraft={saveDraft}
                    onSubmitFinal={submitFinal}
                />
            </Stack>
        </Container>
    );
};

export default AuditWizardPage;
