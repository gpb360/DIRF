---
name: model-advice
kind: skill
description: "Recommend a capable lower-cost model from a host-provided catalog without invoking it"
uses: []
details: []
inputs: ["host model catalog", "workflow capability requirements"]
outputs: ["portable preflight model suggestions"]
capabilities: ["model selection advice"]
---

# Model advice

Use only the model catalog supplied by the host. Match each declared preflight workflow requirement
to an exact declared capability, or to a catalog wildcard. Choose the lowest
host-reported cost tier; break ties by model name so the result is stable.

Record the catalog hash, model name, tier, matched capabilities, preflight workflow
stages, rationale, and any uncovered capabilities. If no catalog or match is
available, say that advice is unavailable.

This advice does not claim to cover work discovered later in an interview.
Never fetch prices, invoke a model, monitor a session, or authorize spend.
