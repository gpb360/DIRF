---
name: documentation
kind: playbook
order: 9
description: "Write or improve developer-facing documentation."
uses: []
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description":"Write or improve developer-facing documentation.","keywords":["docs","documentation","readme","guide","sdk","tutorial"],"agents":["documentation-engineer","dx-optimizer","knowledge-synthesizer"],"workflow":{"phases":["identify audience","inspect source truth","write","verify commands"],"output":"clear docs grounded in current repo behavior","validation":"run or verify every documented command where practical","recovery":"if behavior cannot be verified, mark it explicitly"},"questions":["Who is the doc for?","Should commands be verified or documented from source only?"],"skill_flow":{"label":"developer documentation","steps":[{"stage":"inspect","reason":"Ground the document in the smallest current source of truth.","capability":"minimalism"},{"stage":"prose","reason":"Remove filler and vague claims while preserving meaning and tone.","capability":"prose editing"},{"stage":"verify","reason":"Review commands, claims, and scope against source.","capability":"code review"}]}}
---

# documentation

Write or improve developer-facing documentation.

Follow the ordered phases and capability requirements declared above. After
checking the source of truth, run the optional `prose editing` pass to remove
slop while preserving meaning and tone. Finish with the existing verification
step.
