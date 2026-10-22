---
name: plan-interview
kind: skill
description: "Ask the smallest set of questions that de-risks the plan before work starts"
uses: []
details: []
inputs: ["task"]
outputs: ["confirmed scope and constraints"]
capabilities: ["plan interview"]
---

# Plan interview

Look up repository facts before asking the user. Then resolve only decisions
whose answers change the work:

1. Start with the highest-leverage unresolved decision.
2. Ask one question at a time.
3. Give two to four meaningful choices when the host supports them.
4. Put the recommended choice first and state its material tradeoff.
5. Use a concrete counterexample when an answer still permits conflicting
   implementations.
6. Record the user's answer, explicit exclusions, and remaining contradictions
   next to the plan.
7. Summarize the shared understanding and stop before implementation until the
   user confirms it.

Stop interviewing as soon as the smallest safe plan is clear. A normal plan
interview does not write glossary or ADR files; use the explicit stateful
discovery branch when the user wants those records updated.
