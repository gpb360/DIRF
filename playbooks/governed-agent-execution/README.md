---
name: governed-agent-execution
kind: playbook
order: 16
description: "Govern agent and workflow actions from normalized request through authorization, execution, and tamper-evident records."
uses: ["../../workflows/governed-agent-execution"]
details: []
inputs: ["task", "target policy", "mandate"]
outputs: ["governed execution decision and verified evidence ledger"]
capabilities: ["governed execution", "execution authorization", "evidence ledger"]
config: {"description":"Govern agent and workflow actions from normalized request through authorization, execution, and tamper-evident records.","keywords":["governed execution","agent execution","workflow execution","command governance","tool authorization","execution policy","tamper evident ledger","rtk governance","rtk inspired"],"agents":["governance-execution-auditor","security-auditor","workflow-orchestrator","test-engineer"],"workflow":{"phases":["normalize complete action and scope","evaluate risk mandate and evidence","bind exact human authorization when required","consume authority and execute through one adapter","verify outcome and tamper-evident ledger"],"gates":{"evaluate risk mandate and evidence":{"kind":"decision","verify":"dirf govern evaluate <request.json> --policy <policy.json>"},"bind exact human authorization when required":{"kind":"decision"},"consume authority and execute through one adapter":{"kind":"verify","verify":"prove single-use consumption occurred before credentials or external effects"}},"output":"allow, require_approval, or deny decision plus a verified hash-linked execution ledger","validation":"prove every segment was evaluated, high-risk authority was exact-content-bound and atomically consumed, and the final ledger verifies","recovery":"deny unknown, cross-tenant, stale, malformed, or out-of-scope actions; request a new named approval when exact content or policy changed"},"questions":["What exact action, organization, target, repository/ref, and payload are being governed?","Who granted the mandate, and which named human can approve high-risk effects?"],"skill_flow":{"label":"governed action to verified execution","steps":[{"stage":"normalize","reason":"Represent every action segment and exact target before policy evaluation.","capability":"governed execution","output":"canonical request with no inferred tenant, target, or hidden segment"},{"stage":"review","reason":"Check trust boundaries and prevent policy or adapter bypass.","capability":"security review","output":"no unresolved authorization or secret-handling finding"},{"stage":"verify","reason":"Prove decision precedence, exact authorization binding, single-use consumption, and ledger integrity.","capability":"testing","output":"focused policy and ledger checks pass"}]}}
---

# Governed agent execution

Run the folder workflow and preserve its decision evidence. The governance execution auditor evaluates; a named human grants high-risk authority; the host adapter consumes and executes; the test engineer verifies independently.
