---
name: governance-gateway
kind: playbook
order: 15
description: "Design or review an execution governance gateway for agent actions."
uses: []
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description":"Design or review an execution governance gateway for agent actions.","keywords":["governance","gateway","approval","mandate","authority","audit control","control plane","human approval","enforcement"],"agents":["security-auditor","agent-organizer","documentation-engineer","error-coordinator","test-engineer"],"workflow":{"phases":["classify action risk","define mandate and authority","check evidence requirements","emit allow/deny/approval decision contract"],"gates":{"check evidence requirements":{"kind":"decision"}},"output":"governance contract or review with decision evidence","validation":"prove state-changing actions are blocked without mandate, evidence, scope, and named authority","recovery":"if authority, scope, or evidence is missing, deny or require named human approval"},"questions":["What actions need gateway enforcement?","Which tools, credentials, or resources must be withheld from agents?"],"skill_flow":{"label":"governance gateway","steps":[{"stage":"map","reason":"Map authority, evidence, scope, and trust boundaries.","capability":"security review"},{"stage":"design","reason":"Define the smallest enforceable governance contract.","capability":"minimalism"},{"stage":"verify","reason":"Prove unauthorized state changes are denied.","capability":"testing"}]}}
---

# governance-gateway

Design or review an execution governance gateway for agent actions.

Follow the ordered phases and capability requirements declared above.
