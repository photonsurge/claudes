#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="http://localhost:3000/api/form-chat"
MESSAGE="${1:-Hello, this is a test message}"

echo "START---------------------------------------------------"
echo "$MESSAGE"
echo
PAYLOAD=$(jq -n \
  --arg msg "$MESSAGE" \
  '{
    message: $msg,
    auditTypeId: "AE_FIRE_SAFETY",
    currentStep: 1,
    visibleQuestionIds: ["Q1_1","Q1_2","Q1_3","Q1_4"],
    currentAnswers: {
      Q1_1: "",
      Q1_2: "",
      Q1_3: "",
      Q1_4: "",
      Q3_1: "",
      Q3_2: ""
    },
    questions: [
      {
        id: "Q1_1",
        title: "1.1 High level responsibility for fire",
        description: "Preamble: The Chief Executive will be responsible for compliance with fire legislation.",
        type: "textarea"
      },
      {
        id: "Q1_2",
        title: "1.2 Fire safety management",
        description: "Preamble: The Fire Safety Manager acts as the focal point for fire safety.",
        type: "textarea"
      },
      {
        id: "Q1_3",
        title: "1.3 Fire safety advise",
        description: "Preamble: The Fire Safety Advisor provides competent fire safety advice.",
        type: "textarea"
      },
      {
        id: "Q1_4",
        title: "1.4 Fire systems designers, installers, and maintainers",
        description: "Preamble: All fire systems personnel must demonstrate suitable competence.",
        type: "textarea"
      }
    ]
  }'
)

echo
echo "===== REQUEST PAYLOAD ====="
echo "$PAYLOAD" | jq .
echo "==========================="


RESPONSE=$(curl -sS \
  -w "\n\nHTTP_STATUS:%{http_code}\n" \
  -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD"
)

echo "===== RESPONSE ====="
echo "$RESPONSE"
echo "===================="
