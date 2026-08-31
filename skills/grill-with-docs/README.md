---
name: grill-with-docs
kind: skill
description: "Resolve load-bearing decisions through a stateful interview"
uses: ["../domain-modeling"]
details: []
inputs: ["idea", "repository context"]
outputs: ["confirmed scope", "updated glossary", "justified ADRs"]
capabilities: ["stateful discovery", "plan interview"]
disable-model-invocation: true
---

# Grill with docs

Use the plan-interview rules, then maintain domain records only when this
stateful branch was explicitly selected. Ask one decision at a time. After the
user accepts an answer, update the glossary or context record. Create an ADR
only for a decision that is hard to reverse, surprising, and based on a real
tradeoff. Do not write project documents during an ordinary Grill Me session.
