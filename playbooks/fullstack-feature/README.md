---
name: fullstack-feature
kind: playbook
order: 3
description: "Build a user-facing feature across UI, API, data, and tests."
uses: ["../../skills/minimal-implementation"]
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description":"Build a user-facing feature across UI, API, data, and tests.","keywords":["feature","fullstack","full-stack","api","database","login"],"agents":["rapid-prototyper","ux-researcher","ui-designer","frontend-developer","backend-architect","test-engineer"],"workflow":{"phases":["define user outcome","reuse existing patterns","implement vertical slice","verify"],"output":"small working feature slice","validation":"run focused tests or build for touched surface","recovery":"if contracts are unclear, stop after documenting the needed API/data decision"},"questions":["What is the user-visible success criteria?","What existing APIs, routes, or data models should be reused?"],"skill_flow":{"label":"idea → ship (build a feature)","steps":[{"stage":"sharpen","reason":"Resolve the decision tree before building.","capability":"stateful discovery","output":"every open question either has a recorded answer or is explicitly deferred with the blocker named"},{"stage":"specify","reason":"Synthesize approved decisions for a multi-session build.","branch":"multi-session","capability":"specification synthesis"},{"stage":"slice","reason":"Create dependency-aware tracer-bullet tickets for a multi-session build.","branch":"multi-session","capability":"dependency ticketing"},{"stage":"handoff","reason":"Preserve the approved plan for fresh execution sessions.","branch":"multi-session","capability":"session handoff"},{"stage":"plan","reason":"Reuse existing patterns and choose the smallest correct slice.","capability":"minimalism","output":"one chosen slice that reuses existing code and names the single verification check"},{"stage":"design","reason":"Design the UI structure when the task has a UI surface.","branch":"ui","capability":"frontend design"},{"stage":"build","reason":"Drive each behavior through a red-green slice.","capability":"testing","output":"a failing test made green by the smallest implementation, with the touched surface building clean"},{"stage":"build","reason":"Apply React conventions when React is explicit.","branch":"react","capability":"react engineering"},{"stage":"quality","reason":"Apply the product-quality gate.","capability":"product quality"},{"stage":"review","reason":"Review Standards and Spec before committing.","capability":"code review","output":"review notes citing file:line for each finding, or an explicit all-clear with the standards checked"}]}}
---

# fullstack-feature

Build a user-facing feature across UI, API, data, and tests.

Follow the ordered phases and capability requirements declared above.
