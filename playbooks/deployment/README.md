---
name: deployment
kind: playbook
order: 10
description: "Prepare, debug, or review deployment and release flow."
uses: []
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description":"Prepare, debug, or review deployment and release flow.","keywords":["deploy","deployment","release","ci","cd","pipeline","hosting"],"agents":["devops-automator","backend-architect","test-engineer","documentation-engineer"],"workflow":{"phases":["inspect current deploy path","identify blocker","patch config or docs","verify"],"output":"deployment-ready change or blocker report","validation":"run the narrowest build, CI, or deploy dry-run command","recovery":"if credentials are missing, stop at config validation and document the blocker","agent_contracts":{"devops-automator":{"phases":["inspect current deploy path","identify blocker","patch config or docs"],"output":"the proven deployment path, root blocker, and smallest configuration or documentation correction","verification":"the change follows the repository deployment contract and includes rollback guidance"},"test-engineer":{"phases":["verify"],"output":"deployment validation evidence without unapproved production mutation","verification":"local or approved environment checks pass and any unrun production step is explicit"}}},"questions":["What host or CI system is used?","Is this a deploy fix, release checklist, or environment setup?"],"skill_flow":{"label":"deployment and release","steps":[{"stage":"diagnose","reason":"Inspect the current deployment path and reproduce the blocker.","capability":"root cause debugging"},{"stage":"change","reason":"Make the smallest deployment or configuration change.","capability":"minimalism"},{"stage":"verify","reason":"Run the narrowest build, CI, or dry-run check.","capability":"testing"}]}}
---

# deployment

Prepare, debug, or review deployment and release flow.

Follow the ordered phases and capability requirements declared above.
