---
name: security-review
kind: playbook
order: 6
description: "Review code or architecture for security risk."
uses: []
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description":"Review code or architecture for security risk.","keywords":["security","audit","vulnerability","auth","permission","secrets","compliance"],"agents":["security-auditor","backend-architect","test-engineer","documentation-engineer"],"workflow":{"phases":["map trust boundary","inspect controls","rank risks","recommend fixes"],"output":"security findings with impact and remediation","validation":"prove findings with code references or commands","recovery":"if boundary is unclear, ask for the asset and attacker model","agent_contracts":{"security-auditor":{"phases":["map trust boundary","inspect controls","rank risks","recommend fixes"],"output":"a trust-boundary map and evidence-backed, prioritized security findings with bounded remediations","verification":"authorization, data exposure, secrets, injection, and fail-open behavior are checked where applicable"}}},"questions":["What trust boundary or asset matters most?","Should this be a review only or include fixes?"],"skill_flow":{"label":"security review","steps":[{"stage":"map","reason":"Map the trust boundary and attacker model.","capability":"security review"},{"stage":"inspect","reason":"Trace the control flow methodically.","capability":"root cause debugging"},{"stage":"verify","reason":"Prove findings through code references or a focused test.","capability":"testing"}]}}
---

# security-review

Review code or architecture for security risk.

Follow the ordered phases and capability requirements declared above.
