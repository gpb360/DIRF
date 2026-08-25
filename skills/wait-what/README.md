---
name: wait-what
kind: skill
description: "Wait when the user says an explanation did not land; re-explain it in plain English with the missing context and project vocabulary"
disable-model-invocation: true
uses: []
details: []
inputs: ["the current conversation", "project context"]
outputs: ["a clearer explanation"]
capabilities: ["plain-language repair"]
---

# Wait, what?

Re-pitch the current point in plain English. Back up far enough to include the
missing premise, and use the project's `CONTEXT.md` terms when available.

Keep it shorter and clearer, not blunt. If the user invokes this again, restore
context instead of compressing the explanation further.
