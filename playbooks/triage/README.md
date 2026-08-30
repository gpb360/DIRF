---
name: triage
kind: playbook
order: 11
description: "Classify an unknown task and choose the smallest useful agent set."
uses: []
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description":"Classify an unknown task and choose the smallest useful agent set.","keywords":["help","start","what should","not sure","triage"],"agents":["agent-organizer","documentation-engineer","dx-optimizer"],"workflow":{"phases":["classify task","select closest playbook","ask missing context","stop before edits"],"output":"recommended workflow and next command","validation":"no code changes; recommendation only","recovery":"if confidence is low, show alternates instead of pretending certainty","agent_contracts":{"agent-organizer":{"phases":["classify task","select closest playbook","ask missing context","stop before edits"],"output":"one routed playbook with only the material missing context and no repository change","verification":"the selected playbook best matches the task and the handoff stops before unauthorized edits"}}},"questions":["What are you trying to produce or fix?","What project path should be inspected?"],"skill_flow":{"label":"triage — classify and route","steps":[{"stage":"classify","reason":"Ask the smallest question that classifies the task.","capability":"plan interview"}]}}
---

# triage

Classify an unknown task and choose the smallest useful agent set.

Follow the ordered phases and capability requirements declared above.
