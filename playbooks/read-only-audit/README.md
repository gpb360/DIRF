---
name: read-only-audit
kind: playbook
order: 23
description: "Inspect a system or change and report evidence-backed findings without implementation."
uses: ["../../skills/code-review"]
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description":"Inspect a system or change and report evidence-backed findings without implementation.","keywords":["read-only audit","audit-only","review-only"],"agents":["test-engineer"],"workflow":{"execution_mode":"read_only","phases":["identify the audit target and scope","inspect behavior and relevant risks","prove findings with proportionate checks","deliver findings and recommendations"],"output":"an evidence-backed report with findings, limitations, and suggested corrections; unresolved findings do not prevent audit completion","validation":"check that each finding identifies its trigger, evidence, impact, and suggested correction, and that no implementation was performed","recovery":"if evidence is unavailable, label the limitation; do not implement corrections or claim merge readiness","requirements":["Read-only audit: do not edit application code or implement corrections. Isolated proof fixtures and the requested report are permitted.","Complete the report even when findings remain. Merge readiness and implementation are separate tasks."]},"questions":[],"skill_flow":{"label":"inspect, verify, and report","steps":[{"stage":"review","capability":"code review","reason":"Inspect the requested target and prove findings under the read-only audit boundary; produce a report without implementation or merge approval."}]}}
---

# Read-only audit

Inspect the requested system, branch, or change. Record the target revision,
scope, evidence, and limitations. Report confirmed findings and suggested
corrections. The audit is complete when the report is supported by evidence;
it does not require repairs or a clean pull request.
