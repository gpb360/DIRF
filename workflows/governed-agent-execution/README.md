---
name: governed-agent-execution
kind: workflow
description: "Execute agent state changes through deterministic risk, authority, evidence, and ledger gates"
uses: ["../../skills/governed-execution"]
details: []
inputs: ["requested action", "organization policy", "named mandate"]
outputs: ["decision", "approval artifact when required", "verified execution ledger"]
capabilities: ["governed execution", "execution authorization", "evidence ledger"]
---

# Governed agent execution workflow

1. Ground actor, tenant, mandate, exact target, repository/ref, and adapter identity.
2. Normalize the complete action and payload; split compound actions into independently attestable segments.
3. Evaluate with `dirf govern evaluate`. Stop on `deny`; retain reasons as evidence.
4. On `require_approval`, present the action digest, policy digest, risk, evidence, expiry, and exact effect to a named human. Re-evaluate the signed authorization; never edit the decision.
5. On `allow`, have the selected host adapter atomically consume `authorizationToConsume` when present, then execute only the normalized action.
6. Verify the outcome, append decision/consumption/execution events, and run `dirf govern verify` on the resulting ledger.

Recovery is deterministic: normalization uncertainty returns to step 2, missing scope/evidence returns to step 1, stale approval returns to step 4, failed consumption blocks execution, and execution failure records the failure plus recovery reference before retry.
