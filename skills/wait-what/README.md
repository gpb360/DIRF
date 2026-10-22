---
name: wait-what
kind: skill
description: "Explain the current point again in plain English, restoring the context the user needs"
disable-model-invocation: true
uses: []
details: []
inputs: ["the current conversation", "project context"]
outputs: ["a clearer explanation"]
capabilities: ["plain-language repair"]
---

# Explain again

Explain the current point in plain English. Back up far enough to include the
missing premise, and use the project's `CONTEXT.md` terms when available.

Keep it shorter and clearer, not blunt. If the user invokes this again, restore
context instead of compressing the explanation further.
