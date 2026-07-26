---
name: domain-modeling
kind: skill
description: "Sharpen project terminology and record only durable domain decisions"
uses: []
details: []
inputs: ["conversation", "repository context"]
outputs: ["updated glossary or justified ADR"]
capabilities: ["domain modeling"]
---

# Domain modeling

Challenge vague or overloaded terms against the code and existing glossary. Keep `CONTEXT.md` implementation-free, and write an ADR only for a hard-to-reverse, surprising trade-off.
