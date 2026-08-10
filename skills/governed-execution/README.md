---
name: governed-execution
kind: skill
description: "Govern agent or workflow state changes with exact scope, risk, authority, evidence, and tamper-evident decision records"
uses: ["../../tools/governance-evaluator"]
details: ["METHOD.md", "CONTRACT.md", "RTK-INSPIRATION.md"]
inputs: ["requested action", "organization policy", "mandate and evidence"]
outputs: ["enforceable execution decision", "authorization request", "ledger evidence"]
capabilities: ["governed execution", "execution authorization", "evidence ledger"]
---

# Governed execution

Normalize the complete action before evaluating it. Every segment receives an independent rule match; `deny` outranks `require_approval`, which outranks `allow`.

Read [METHOD.md](METHOD.md) for the ordered method and [CONTRACT.md](CONTRACT.md) for adapter and JSON requirements. Read [RTK-INSPIRATION.md](RTK-INSPIRATION.md) only when provenance or RTK comparison matters.

Completion means the action was denied with concrete reasons, paused with an exact approval request, or executed after authorization consumption and recorded in a verified ledger.
