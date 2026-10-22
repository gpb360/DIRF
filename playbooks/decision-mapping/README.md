---
name: decision-mapping
kind: playbook
order: 5
description: "Review and map load-bearing decisions for large unclear work before specification and delivery tickets."
uses: []
details: ["DECISION-MAP.md"]
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description":"Review and map load-bearing decisions for large unclear work before specification and delivery tickets.","keywords":["decision map","decision mapping","map the decisions","not yet specified","large unclear effort","unclear multi-session work"],"agents":["workflow-orchestrator","research-analyst","knowledge-synthesizer"],"workflow":{"phases":["name the destination and exit condition","record accepted decisions without duplicating their artifacts","state precise open decisions and prerequisites","separate not-yet-specified uncertainty from out-of-scope work","derive the decisions ready now","approve the route into specification"],"gates":{"approve the route into specification":{"kind":"decision","artifact_type":"research"}},"output":"a tracker-neutral decision map that links accepted answers, exposes ready questions, preserves unresolved uncertainty without premature tickets, and stops before specification until accepted","validation":"every open decision is a precise question; every ready decision has no unresolved prerequisite; accepted answers link to one authoritative artifact; not-yet-specified and out-of-scope items are disjoint; no delivery ticket or implementation work begins before map acceptance","recovery":"if the destination is already clear, use the existing specification and ticket workflow; if a question cannot yet be stated precisely, keep it not yet specified; if tracker or concurrency machinery appears necessary, record the observed failure and stop before adding runtime state","agent_contracts":{"workflow-orchestrator":{"phases":["name the destination and exit condition","state precise open decisions and prerequisites","separate not-yet-specified uncertainty from out-of-scope work","approve the route into specification"],"output":"a bounded route from accepted decisions to specification with an explicit approval record","verification":"the final decision gate and its governing research artifact are accepted before completion"},"knowledge-synthesizer":{"phases":["record accepted decisions without duplicating their artifacts"],"output":"a traceable index of accepted decisions and their authoritative artifacts","verification":"each entry links to its source and does not copy or reinterpret accepted content"},"research-analyst":{"phases":["derive the decisions ready now"],"output":"the decisions supportable by current evidence","verification":"each ready decision cites sufficient evidence and unresolved prerequisites remain open"}}},"questions":["What destination would make the route clear enough for specification?","Which decisions can change that route, and which require a named human authority?"],"skill_flow":{"label":"unclear effort -> accepted decisions -> specification handoff","steps":[{"stage":"discover","reason":"Name the destination and expose only questions that can change the route.","capability":"plan interview","output":"one destination, exit condition, and bounded uncertainty inventory"},{"stage":"model","reason":"Separate decisions, prerequisites, unspecified uncertainty, scope boundaries, and later delivery work.","capability":"domain modeling","output":"a map whose categories do not overlap"},{"stage":"research","reason":"Resolve ready questions against current authoritative evidence.","capability":"primary source research","output":"accepted answers stored once and linked from the map"},{"stage":"handoff","reason":"Cross into specification only when unresolved uncertainty can no longer change the destination.","capability":"session handoff","output":"an accepted recommendation or an explicit blocker; never implementation"}]}}
---

# decision-mapping

Use this playbook only when work is both too large for one context and too
unclear to specify safely. Small or already-understood work should continue
through DIRF's existing workflows.

Read [DECISION-MAP.md](DECISION-MAP.md) before executing. The map resolves
questions; it is not a delivery backlog, issue provider, or second canonical
store. Implementation begins only after the resulting research artifact and
decision gate are explicitly accepted.
