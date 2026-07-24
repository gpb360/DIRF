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
config: {"description":"Build a user-facing feature across UI, API, data, and tests.","keywords":["feature","fullstack","full-stack","api","database","login"],"agents":["rapid-prototyper","ux-researcher","ui-designer","frontend-developer","backend-architect","test-engineer"],"workflow":{"phases":["define user outcome","reuse existing patterns","implement vertical slice","verify"],"output":"small working feature slice","validation":"run focused tests or build for touched surface","recovery":"if contracts are unclear, stop after documenting the needed API/data decision"},"questions":["What is the user-visible success criteria?","What existing APIs, routes, or data models should be reused?"],"skill_flow":{"label":"idea → ship (build a feature)","steps":[{"stage":"discover","reason":"Resolve load-bearing decisions before planning.","capability":"stateful discovery"},{"stage":"model","reason":"Make domain and governance terminology explicit.","branch":"multi-session","capability":"domain modeling"},{"stage":"research","reason":"Investigate decisions that require primary-source evidence.","branch":"research","capability":"primary source research"},{"stage":"specify","reason":"Synthesize approved decisions for a multi-session build.","branch":"multi-session","capability":"specification synthesis"},{"stage":"slice","reason":"Create dependency-aware tracer-bullet tickets for a multi-session build.","branch":"multi-session","capability":"dependency ticketing"},{"stage":"handoff","reason":"Preserve the approved plan for fresh execution sessions.","branch":"multi-session","capability":"session handoff"},{"stage":"plan","reason":"Reuse existing patterns and choose the smallest correct slice.","capability":"minimalism"},{"stage":"design","reason":"Design the UI structure when the task has a UI surface.","branch":"ui","capability":"frontend design"},{"stage":"build","reason":"Drive each behavior through a red-green slice.","capability":"testing"},{"stage":"build","reason":"Apply React conventions when React is explicit.","branch":"react","capability":"react engineering"},{"stage":"quality","reason":"Apply the final product-quality gate.","capability":"product quality"},{"stage":"review","reason":"Review standards and specification before committing.","capability":"code review"}]}}
---

# fullstack-feature

Build a user-facing feature across UI, API, data, and tests.

Follow the ordered phases and capability requirements declared above.
