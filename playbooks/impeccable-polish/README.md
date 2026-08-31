---
name: impeccable-polish
kind: playbook
order: 14
description: "Final product-quality pass for professional fit, finish, consistency, and obvious rough edges."
uses: []
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description":"Final product-quality pass for professional fit, finish, consistency, and obvious rough edges.","keywords":["impeccable","polish","fit and finish","make it better","professional","quality pass","refactor"],"agents":["ui-designer","brand-guardian","performance-benchmarker","test-engineer","documentation-engineer"],"workflow":{"phases":["scan current experience","identify rough edges","apply smallest polish fixes","verify user-facing quality"],"output":"polish findings or fixes with proof","validation":"run focused UI/runtime checks and document before/after evidence","recovery":"if no target is provided, produce a prioritized polish checklist instead of editing","agent_contracts":{"ui-designer":{"phases":["scan current experience","apply smallest polish fixes"],"output":"a focused experience scan and the smallest coherent visual or interaction refinements","verification":"fixes reuse existing patterns and preserve accessibility and responsive behavior"},"brand-guardian":{"phases":["identify rough edges"],"output":"a prioritized list of inconsistent, generic, or off-brand details","verification":"each retained issue is visible in the current experience and traces to the supplied brand"},"test-engineer":{"phases":["verify user-facing quality"],"output":"user-facing regression and quality evidence","verification":"the touched states are exercised across relevant viewports, inputs, and reduced-motion settings"}}},"questions":["What screen, workflow, or artifact needs the polish pass?","Should this only review, or also apply fixes?"],"skill_flow":{"label":"polish pass","steps":[{"stage":"scan","reason":"Find visible hierarchy, spacing, and interaction rough edges.","capability":"user experience design"},{"stage":"polish","reason":"Apply the smallest product-quality fixes.","capability":"product quality"},{"stage":"verify","reason":"Verify responsive, performance, and accessibility behavior.","capability":"web quality"}]}}
---

# impeccable-polish

Final product-quality pass for professional fit, finish, consistency, and obvious rough edges.

Follow the ordered phases and capability requirements declared above.
