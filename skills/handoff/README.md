---
name: handoff
kind: skill
description: "Compact active work into a redacted continuation document"
uses: []
details: []
inputs: ["current session", "next-session focus"]
outputs: ["handoff document"]
capabilities: ["session handoff"]
---

# Handoff

Reference existing specs, tickets, decisions, and diffs instead of duplicating them. Include current status, verification, blockers, and suggested next skills; redact secrets and personal data.

Carry forward the open-question ledger: every question still open is marked answered, partially answered, or unresolved, with the evidence behind each answer and what the unresolved ones still need. Say plainly which required questions remain open — a successor session must not inherit the belief that unfinished work is complete.
