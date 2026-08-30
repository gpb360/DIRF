---
name: performance-pass
kind: playbook
order: 5
description: "Find and improve performance bottlenecks."
uses: []
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description":"Find and improve performance bottlenecks.","keywords":["performance","slow","speed","lighthouse","core web vitals","bundle"],"agents":["performance-benchmarker","frontend-developer","backend-architect","test-engineer"],"workflow":{"phases":["measure","identify bottleneck","patch smallest cause","remeasure"],"output":"before/after evidence","validation":"rerun the same benchmark or focused timing check","recovery":"if no metric exists, establish baseline before changing code","agent_contracts":{"performance-benchmarker":{"phases":["measure","identify bottleneck","remeasure"],"output":"comparable before and after measurements tied to one proven bottleneck","verification":"measurements use the same workload and show whether the target metric improved"},"backend-architect":{"phases":["patch smallest cause"],"output":"the smallest architecture or code change addressing the measured cause","verification":"the patch targets the measured bottleneck and preserves correctness"}}},"questions":["What metric is too slow?","What command, page, or endpoint should be measured?"],"skill_flow":{"label":"performance pass","steps":[{"stage":"measure","reason":"Establish a baseline before changing code.","capability":"web quality"},{"stage":"fix","reason":"Patch the smallest measured bottleneck.","capability":"minimalism"},{"stage":"remeasure","reason":"Repeat the same measurement for before-after proof.","capability":"web quality"}]}}
---

# performance-pass

Find and improve performance bottlenecks.

Follow the ordered phases and capability requirements declared above.
