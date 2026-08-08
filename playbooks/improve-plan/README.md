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
config: {"description":"Create a cost-aware execution plan before implementation.","keywords":["improve","cost","cheap","credits","model","models","agent routing","execution plan"],"agents":["agent-organizer","dx-optimizer","documentation-engineer"],"workflow":{"phases":["inspect local context","partition work","assign agents and ownership","define verification gates"],"gates":{"assign agents and ownership":{"kind":"verify"}},"output":"short execution plan with agent/model routing and credit controls","validation":"plan names concrete files/modules, commands, and what not to spawn","recovery":"if scope is unclear, stop at questions and do not implement"},"questions":["What outcome should the plan optimize for?","What files, modules, or repo path should be inspected before planning?"],"skill_flow":{"label":"plan before implementation","steps":[{"stage":"plan","reason":"Resolve load-bearing decisions before implementation.","capability":"plan interview"},{"stage":"plan","reason":"Use the cheapest sufficient execution shape.","capability":"minimalism"}]}}
---

# improve-plan

Create a cost-aware execution plan before implementation.

Follow the ordered phases and capability requirements declared above.
