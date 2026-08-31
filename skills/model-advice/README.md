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

Use only the model catalog supplied by the host. Match each workflow
requirement known before execution to an exact declared capability or catalog
wildcard. Choose the lowest cost tier reported by the host. Break ties by model
name so the result is stable.

Record the catalog hash, model name, tier, matched capabilities, preflight workflow
stages, rationale, and any uncovered capabilities. If no catalog or match is
available, say that advice is unavailable.

This advice covers only work known before execution. Never fetch prices, invoke
a model, monitor work, or authorize spend.
