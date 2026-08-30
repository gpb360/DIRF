---
name: improve-plan
kind: playbook
order: 12
description: "Create a cost-aware execution plan before implementation."
uses: []
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description":"Create a cost-aware execution plan before implementation.","keywords":["improve","cost","cheap","credits","model","models","agent routing","execution plan","grill me","grill with docs","grill-with-docs","interview me","question me","one question at a time","sharpen a plan","clarify the plan","resolve decisions"],"agents":["workflow-orchestrator","agent-organizer","dx-optimizer"],"workflow":{"phases":["inspect repository facts and existing decisions","identify the highest-leverage unresolved decision","ask and record one decision at a time","confirm shared understanding","partition the confirmed work","assign agents and ownership","define verification gates"],"gates":{"inspect repository facts and existing decisions":{"kind":"soft"},"identify the highest-leverage unresolved decision":{"kind":"soft"},"ask and record one decision at a time":{"kind":"soft"},"confirm shared understanding":{"kind":"decision"},"partition the confirmed work":{"kind":"soft"},"assign agents and ownership":{"kind":"soft"}},"agent_contracts":{"workflow-orchestrator":{"phases":["inspect repository facts and existing decisions","identify the highest-leverage unresolved decision","ask and record one decision at a time","confirm shared understanding"],"output":"a confirmed decision record with scope, constraints, exclusions, and unresolved decisions","verification":"the confirm shared understanding decision gate is accepted"},"agent-organizer":{"phases":["partition the confirmed work","assign agents and ownership"],"output":"bounded, non-overlapping assignments for every confirmed work item","verification":"every assignment names one owner, input, output, and excluded scope"},"dx-optimizer":{"phases":["define verification gates"],"output":"concrete verification commands and evidence expectations for the plan","verification":"the plan names a command or manual evidence check for every owned result"}},"output":"a confirmed decision record and short execution plan with agent/model routing, ownership, verification, and credit controls","validation":"discoverable facts were inspected before questions; one unresolved decision was asked at a time with meaningful choices, a recommendation, and its material tradeoff; user acceptance is recorded before implementation; the plan names concrete files or modules, commands, and work that should not be delegated","recovery":"if a fact is discoverable, inspect it instead of asking; if a load-bearing decision remains unresolved, continue the interview one question at a time and stop before implementation"},"questions":["What outcome should this plan optimize for?"],"skill_flow":{"label":"facts -> one-decision interview -> confirmed plan","steps":[{"stage":"decide","reason":"Resolve load-bearing decisions one at a time before implementation.","capability":"plan interview","output":"confirmed scope, constraints, definition of done, explicit exclusions, and any unresolved decisions"},{"stage":"plan","reason":"Use the cheapest sufficient execution shape.","capability":"minimalism","output":"the smallest executable plan with owned work and verification"}]}}
---

# improve-plan

Create a cost-aware execution plan before implementation. Look up repository
facts first. Ask one unresolved decision at a time, recommend an answer with
its real tradeoff, and wait for the user to confirm the shared understanding
before planning implementation.

Follow the ordered phases and capability requirements declared above.
