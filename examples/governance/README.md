# Governed execution examples

From the DIRF repository root:

```text
node src/cli.js govern evaluate examples/governance/read-request.json --policy policies/governed-execution-policy.json
node src/cli.js govern append examples/governance/decision-event.json --now 2026-08-10T12:00:00.000Z
```

Save the append output as a JSON ledger, then verify it with `dirf govern verify <ledger.json>`.
