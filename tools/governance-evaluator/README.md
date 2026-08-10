---
name: governance-evaluator
kind: tool
description: "Deterministic action decision and tamper-evident ledger CLI"
uses: []
details: []
inputs: ["normalized action request", "governance policy", "ledger event"]
outputs: ["allow, require_approval, or deny decision", "verified hash-linked ledger"]
capabilities: ["governed execution", "evidence ledger"]
approval: none
---

# Governance evaluator tool

Invoke the host-neutral interface through DIRF:

```text
dirf govern digest request.json
dirf govern evaluate request.json --policy policy.json
dirf govern append event.json --ledger ledger.json
dirf govern verify ledger.json
```

`evaluate` exits `0` for `allow`, `3` for `require_approval`, and `4` for `deny`. `verify` exits `0` only for an intact ledger.

The tool decides and records. It does not execute the requested action, grant approval, consume authorization, or handle credentials.
