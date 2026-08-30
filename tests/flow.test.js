import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFlow, findCapabilityGaps, reconcile } from "../src/flow.js";
import { bundledSkills } from "../src/skills.js";
import { validateSnapshot } from "../src/validate.js";

const WORKFLOW = {
  phases: ["classify"],
  output: "A route",
  validation: "Check the route",
  recovery: "Ask for context",
};

test("Reconciliation rejects a Playbook without an ordered skill flow", () => {
  const errors = reconcile({ triage: { description: "Fallback", keywords: [], agents: [], workflow: WORKFLOW } });

  assert.deepEqual(errors, ["playbook triage: missing skill_flow"]);
});

test("Reconciliation requires the triage Playbook", () => {
  assert.deepEqual(reconcile({}), ["triage: missing coherent playbook definition"]);
});

test("Reconciliation rejects unknown conditional branches", () => {
  const playbooks = {
    triage: {
      description: "Classify an unrecognized task",
      keywords: [],
      agents: [],
      workflow: WORKFLOW,
      skill_flow: {
        label: "triage",
        steps: [{ stage: "classify", skill: "grill-me", reason: "Classify the task", branch: "mobile" }],
      },
    },
  };

  assert.deepEqual(reconcile(playbooks), ["playbook triage: step 1 references unknown branch mobile"]);
});

test("Reconciliation rejects an incomplete Playbook definition", () => {
  const errors = reconcile({ triage: { skill_flow: { label: "triage", steps: [{ stage: "route", skill: "grill-me", reason: "Classify" }] } } });

  assert.deepEqual(errors, [
    "playbook triage: missing description",
    "playbook triage: keywords must be an array",
    "playbook triage: agents must be an array",
    "playbook triage: workflow must be an object",
  ]);
});

test("Reconciliation rejects malformed definitions instead of throwing", () => {
  assert.deepEqual(reconcile({ triage: null }), ["playbook triage: definition must be an object"]);
  assert.ok(reconcile({
    triage: {
      description: "Classify",
      keywords: [],
      agents: [],
      workflow: WORKFLOW,
      skill_flow: { label: "triage", steps: [null] },
    },
  }).includes("playbook triage: step 1 must be an object"));
});

test("Reconciliation requires a complete workflow contract", () => {
  const errors = reconcile({
    triage: {
      description: "Classify",
      keywords: [],
      agents: [],
      workflow: {},
      skill_flow: { label: "triage", steps: [{ stage: "route", skill: "grill-me", reason: "Classify" }] },
    },
  });

  assert.deepEqual(errors, [
    "playbook triage: workflow.phases must be a non-empty array",
    "playbook triage: workflow.output must be a non-empty string",
    "playbook triage: workflow.validation must be a non-empty string",
    "playbook triage: workflow.recovery must be a non-empty string",
  ]);
});

test("Reconciliation tolerates an optional per-step output contract", () => {
  // Present and non-empty -> no error. Absent -> no error. Empty -> error.
  const ok = reconcile({
    triage: {
      description: "Classify", keywords: [], agents: [], workflow: WORKFLOW,
      skill_flow: { label: "triage", steps: [{ stage: "route", skill: "grill-me", reason: "Classify", output: "a route decision" }] },
    },
  });
  assert.deepEqual(ok, []);

  const empty = reconcile({
    triage: {
      description: "Classify", keywords: [], agents: [], workflow: WORKFLOW,
      skill_flow: { label: "triage", steps: [{ stage: "route", skill: "grill-me", reason: "Classify", output: "  " }] },
    },
  });
  assert.deepEqual(empty, ["playbook triage: step 1 output must be a non-empty string"]);
});

test("buildFlow assembles an existing Selection without classifying again", () => {
  const selection = {
    playbook: "fullstack-feature",
    agents: [],
    skill_flow: {
      label: "build a feature",
      steps: [{ stage: "build", capability: "testing", reason: "Drive one behavior" }],
    },
  };

  assert.deepEqual(buildFlow(selection, { task: "Add review access" }, { tdd: { path: "skills/tdd", description: "testing behavior", capabilities: ["testing"], provider: "project" } }), {
    playbook: "fullstack-feature",
    label: "build a feature",
    steps: [{
      stage: "build", capability: "testing", skill: "tdd", type: "skill", reason: "Drive one behavior",
      output: "", status: "installed", provider: "project", path: "skills/tdd", selection_reason: "best installed match (105) for testing", rejected_candidates: [],
    }],
    gaps: [],
    branches: [],
  });
});

test("single-word capabilities resolve against local install descriptions", () => {
  const selection = {
    playbook: "demo", agents: [],
    skill_flow: { label: "demo", steps: [{ stage: "write", capability: "copywriting", reason: "Write the copy" }] },
  };
  // No declared capabilities, no name match — only the local skill's own
  // description, including a morphological variant of the capability word.
  const flow = buildFlow(selection, {}, {
    "copywriter-coach": { path: "/s", description: "Professional copywriting coach with frameworks and feedback", provider: "project" },
  });
  assert.equal(flow.steps.length, 1);
  assert.equal(flow.steps[0].skill, "copywriter-coach");
  assert.deepEqual(flow.gaps, []);
});

test("user-invoked skills are not routing candidates when model-invoked ones exist", () => {
  const selection = {
    playbook: "demo", agents: [],
    skill_flow: { label: "demo", steps: [{ stage: "write", capability: "copywriting", reason: "Write the copy" }] },
  };
  // The user-invoked skill is the strictly better match (declared capability)
  // but its description is human-facing by design — it must not win routing.
  const flow = buildFlow(selection, {}, {
    "copywriter-coach": { path: "/u", description: "Professional copywriting coach with frameworks", capabilities: ["copywriting"], provider: "project", invocation: "user" },
    "copywriter-model": { path: "/m", description: "Professional copywriting coach with frameworks", provider: "project" },
  });
  assert.equal(flow.steps.length, 1);
  assert.equal(flow.steps[0].skill, "copywriter-model");
  assert.equal(flow.steps[0].invocation, undefined);
});

test("user-invoked-only hosts leave an automatic routing gap", () => {
  const selection = {
    playbook: "demo", agents: [],
    skill_flow: { label: "demo", steps: [{ stage: "write", capability: "copywriting", reason: "Write the copy" }] },
  };
  const flow = buildFlow(selection, {}, {
    "copywriter-coach": { path: "/u", description: "Professional copywriting coach with frameworks", capabilities: ["copywriting"], provider: "project", invocation: "user", disclosures: ["mocking.md", "tests.md"] },
  });
  assert.deepEqual(flow.steps, []);
  assert.equal(flow.gaps[0].capability, "copywriting");
});

test("a human router lends its capability to one installed model engine", () => {
  const selection = {
    playbook: "improve-plan", agents: [],
    skill_flow: { label: "decide", steps: [{ stage: "decide", capability: "plan interview", reason: "Resolve decisions" }] },
  };
  const skills = {
    "grill-me": {
      path: "/user/grill-me", provider: "codex", invocation: "user",
      capabilities: ["plan interview"], references: ["grilling"],
    },
    grilling: {
      path: "/model/grilling", provider: "codex", invocation: "model",
      description: "Relentless interview that sharpens a plan or design",
    },
  };

  const flow = buildFlow(selection, { task: "interview me one question at a time" }, skills);
  assert.deepEqual(flow.steps.map(({ skill }) => skill), ["grilling"]);
  assert.equal(flow.steps[0].selection_reason, "best installed match (110) for plan interview");
  assert.deepEqual(flow.gaps, []);
});

test("an explicitly named human router is preserved before its model engine", () => {
  const selection = {
    playbook: "improve-plan", agents: [],
    skill_flow: { label: "decide", steps: [{ stage: "decide", capability: "plan interview", reason: "Resolve decisions" }] },
  };
  const skills = {
    "grill-me": {
      path: "/user/grill-me", provider: "codex", invocation: "user",
      capabilities: ["plan interview"], references: ["grilling"],
    },
    grilling: {
      path: "/model/grilling", provider: "codex", invocation: "model",
      description: "Relentless interview that sharpens a plan or design",
    },
  };

  const flow = buildFlow(selection, { task: "grill me about the design before implementation" }, skills);
  assert.deepEqual(flow.steps.map(({ skill }) => skill), ["grill-me", "grilling"]);
  assert.equal(flow.steps[0].invocation, "user");
  assert.equal(flow.steps[0].human_checkpoint, true);
  assert.match(flow.steps[1].selection_reason, /referenced by explicit human router grill-me/);
  assert.deepEqual(flow.gaps, []);
});

test("an explicit human router with no installed engine stops with a clear gap", () => {
  const selection = {
    playbook: "improve-plan", agents: [],
    skill_flow: { label: "decide", steps: [{ stage: "decide", capability: "plan interview", reason: "Resolve decisions" }] },
  };
  const flow = buildFlow(selection, { task: "grill me before implementation" }, {
    "grill-me": {
      path: "/user/grill-me", provider: "codex", invocation: "user",
      capabilities: ["plan interview"], references: ["missing-engine"],
    },
  });

  assert.deepEqual(flow.steps.map(({ skill }) => skill), ["grill-me"]);
  assert.equal(flow.gaps[0].code, "invalid_router_reference");
  assert.equal(flow.gaps[0].blocking, true);
  assert.match(flow.gaps[0].question, /none of its installed model-invoked references covers/);
});

test("an explicit human router binds its engine and every model dependency", () => {
  const selection = {
    playbook: "improve-plan", agents: [],
    skill_flow: { label: "decide", steps: [{ stage: "decide", capability: "plan interview", reason: "Resolve decisions" }] },
  };
  const flow = buildFlow(selection, { task: "grill with docs before implementation" }, {
    "grill-with-docs": {
      path: "/user/grill-with-docs", provider: "codex", invocation: "user",
      capabilities: ["plan interview"], references: ["domain-modeling", "grilling"],
    },
    "domain-modeling": {
      path: "/model/domain-modeling", provider: "codex", invocation: "model",
      capabilities: ["domain modeling"], description: "Maintain the domain glossary",
    },
    grilling: {
      path: "/model/grilling", provider: "codex", invocation: "model",
      description: "Relentless interview that sharpens a plan or design",
    },
  });

  assert.deepEqual(flow.steps.map(({ skill }) => skill), ["grill-with-docs", "grilling", "domain-modeling"]);
  assert.match(flow.steps[2].selection_reason, /dependency referenced by explicit human router grill-with-docs/);
  assert.deepEqual(flow.gaps, []);
});

test("an explicit human router fails when any referenced model dependency is missing", () => {
  const selection = {
    playbook: "improve-plan", agents: [],
    skill_flow: { label: "decide", steps: [{ stage: "decide", capability: "plan interview", reason: "Resolve decisions" }] },
  };
  const flow = buildFlow(selection, { task: "grill with docs before implementation" }, {
    "grill-with-docs": {
      path: "/user/grill-with-docs", provider: "codex", invocation: "user",
      capabilities: ["plan interview"], references: ["domain-modeling", "grilling"],
    },
    grilling: {
      path: "/model/grilling", provider: "codex", invocation: "model",
      description: "Relentless interview that sharpens a plan or design",
    },
  });

  assert.deepEqual(flow.steps.map(({ skill }) => skill), ["grill-with-docs"]);
  assert.equal(flow.gaps[0].code, "invalid_router_reference");
  assert.equal(flow.gaps[0].blocking, true);
  assert.match(flow.gaps[0].question, /unavailable or human-only dependencies: domain-modeling/);
});

test("multi-session feature activates spec, ticket, and handoff branches", () => {
  const selection = {
    playbook: "fullstack-feature",
    agents: [],
    skill_flow: {
      label: "build",
      steps: [
        { stage: "specify", branch: "multi-session", capability: "specification synthesis", reason: "Specify" },
        { stage: "slice", branch: "multi-session", capability: "dependency ticketing", reason: "Slice" },
        { stage: "handoff", branch: "multi-session", capability: "session handoff", reason: "Handoff" },
      ],
    },
  };
  const bundledIndex = {
    "to-spec": { capabilities: ["specification synthesis"], provider: "dirf" },
    "to-tickets": { capabilities: ["dependency ticketing"], provider: "dirf" },
    handoff: { capabilities: ["session handoff"], provider: "dirf" },
  };
  const flow = buildFlow(selection, { task: "plan a multi-session feature", bundledIndex });
  assert.deepEqual(flow.steps.map(({ skill }) => skill), ["to-spec", "to-tickets", "handoff"]);
  assert.ok(flow.branches.includes("multi-session"));
});

test("forced plan branches produce the lifecycle and optional research", () => {
  const selection = {
    playbook: "fullstack-feature",
    agents: [],
    skill_flow: {
      label: "plan",
      steps: [
        { stage: "discover", capability: "stateful discovery", reason: "Discover" },
        { stage: "model", branch: "multi-session", capability: "domain modeling", reason: "Model" },
        { stage: "research", branch: "research", capability: "primary source research", reason: "Research" },
        { stage: "specify", branch: "multi-session", capability: "specification synthesis", reason: "Specify" },
        { stage: "slice", branch: "multi-session", capability: "dependency ticketing", reason: "Slice" },
        { stage: "handoff", branch: "multi-session", capability: "session handoff", reason: "Handoff" },
      ],
    },
  };
  const bundledIndex = {
    "grill-with-docs": { capabilities: ["stateful discovery"], provider: "dirf" },
    "domain-modeling": { capabilities: ["domain modeling"], provider: "dirf" },
    research: { capabilities: ["primary source research"], provider: "dirf" },
    "to-spec": { capabilities: ["specification synthesis"], provider: "dirf" },
    "to-tickets": { capabilities: ["dependency ticketing"], provider: "dirf" },
    handoff: { capabilities: ["session handoff"], provider: "dirf" },
  };

  const normal = buildFlow(selection, { task: "build it", branches: ["multi-session"], bundledIndex });
  assert.deepEqual(normal.steps.map(({ stage }) => stage), ["discover", "model", "specify", "slice", "handoff"]);

  const researched = buildFlow(selection, { task: "build it", branches: ["multi-session", "research"], bundledIndex });
  assert.deepEqual(researched.steps.map(({ stage }) => stage), ["discover", "model", "research", "specify", "slice", "handoff"]);
});

test("single-word capabilities do not match a passing description mention", () => {
  const selection = {
    playbook: "demo", agents: [],
    skill_flow: { label: "demo", steps: [{ stage: "verify", capability: "testing", reason: "Verify" }] },
  };
  // "test" appears only in the description — not in the skill's identity —
  // so this must stay a gap rather than a misleading match.
  const flow = buildFlow(selection, { bundledIndex: {} }, {
    "skill-creator": { path: "/s", description: "create skills and run evals to test them", provider: "project" },
  });
  assert.deepEqual(flow.steps, []);
  assert.equal(flow.gaps[0].capability, "testing");
});

test("kit ships zero skills: bundled units are fallback-only and labeled", () => {
  const selection = {
    playbook: "demo", agents: [],
    skill_flow: { label: "demo", steps: [{ stage: "build", capability: "minimalism", reason: "Small change" }] },
  };
  const bundledIndex = {
    "minimal-implementation": { path: "/kit/skills/minimal-implementation", description: "smallest correct implementation", capabilities: ["minimalism"], provider: "dirf" },
  };
  // Local install has nothing -> bundled fallback, explicitly labeled.
  const fallback = buildFlow(selection, { bundledIndex }, {});
  assert.equal(fallback.steps[0].skill, "minimal-implementation");
  assert.equal(fallback.steps[0].status, "fallback");
  assert.match(fallback.steps[0].selection_reason, /no matching skill in the local install/);
  assert.deepEqual(fallback.gaps, []);
  // Local install covers it -> the host skill wins, bundled never consulted.
  const local = buildFlow(selection, { bundledIndex }, {
    ponytail: { path: "/fixtures/skills/ponytail", description: "minimalism ladder", capabilities: ["minimalism"], provider: "claude" },
  });
  assert.equal(local.steps[0].skill, "ponytail");
  assert.equal(local.steps[0].status, "installed");
});

test("bundled human-only skills stay out of automatic routing", () => {
  const selection = {
    playbook: "demo", agents: [],
    skill_flow: { label: "demo", steps: [{ stage: "explain", capability: "plain-language repair", reason: "Clarify" }] },
  };
  const bundled = bundledSkills();
  assert.equal(bundled["wait-what"].invocation, "user");
  const flow = buildFlow(selection, { bundledIndex: bundled, allowedSkills: ["wait-what"] }, {});
  assert.deepEqual(flow.steps, []);
  assert.equal(flow.gaps[0].capability, "plain-language repair");
});

test("buildFlow rejects incidental one-word overlap", () => {
  const selection = {
    playbook: "triage", agents: [],
    skill_flow: { label: "review", steps: [{ stage: "review", capability: "code review", reason: "Review independently" }] },
  };
  const flow = buildFlow(selection, { bundledIndex: {} }, { formatter: { description: "formats code", provider: "project" } });
  assert.deepEqual(flow.steps, []);
  assert.equal(flow.gaps[0].capability, "code review");
});

test("buildFlow does not infer UI from the word build", () => {
  const selection = {
    playbook: "fullstack-feature",
    agents: [],
    skill_flow: {
      label: "build",
      steps: [
        { stage: "build", capability: "testing", reason: "Drive behavior" },
        { stage: "design", capability: "design", reason: "Design UI", branch: "ui" },
      ],
    },
  };

  const installed = {
    tdd: { path: "skills/tdd", description: "testing behavior", capabilities: ["testing"] },
    "frontend-design": { path: "skills/frontend-design", description: "design UI", capabilities: ["design"] },
  };
  assert.deepEqual(buildFlow(selection, { task: "build an API" }, installed).steps.map((step) => step.skill), ["tdd"]);
  assert.deepEqual(buildFlow(selection, { task: "build a UI component" }, installed).steps.map((step) => step.skill), ["tdd", "frontend-design"]);
});

test("security-sensitive UI acceptance retains a security verification branch", () => {
  const selection = {
    playbook: "ui-ux-review",
    agents: [],
    skill_flow: {
      label: "UI/UX review",
      steps: [
        { stage: "review", capability: "user experience design", reason: "Review the UI" },
        { stage: "verify", capability: "security review", reason: "Verify auth and no-spend boundaries", branch: "security" },
      ],
    },
  };
  const installed = {
    design: { description: "user experience design", capabilities: ["user experience design"] },
    security: { description: "security review", capabilities: ["security review"] },
  };

  assert.deepEqual(
    buildFlow(selection, { task: "authenticated visual acceptance without token spend" }, installed).steps.map((step) => step.skill),
    ["design", "security"],
  );
  assert.deepEqual(
    buildFlow(selection, { task: "review responsive typography" }, installed).steps.map((step) => step.skill),
    ["design"],
  );
});

test("buildFlow selects one deterministic installed match and reports gaps", () => {
  const selection = {
    playbook: "demo", agents: [],
    skill_flow: { label: "demo", steps: [
      { stage: "quality", capability: "quality", reason: "Improve quality" },
      { stage: "memory", capability: "memory", reason: "Recover context" },
    ] },
  };
  const flow = buildFlow(selection, {
    task: "quality pass",
    trustedSources: [{ name: "user-choice", capabilities: ["memory"], url: "https://example.test" }],
  }, {
    zeta: { path: "/z", description: "quality", capabilities: ["quality"] },
    alpha: { path: "/a", description: "quality", capabilities: ["quality"] },
  });
  assert.equal(flow.steps.length, 1);
  assert.equal(flow.steps[0].skill, "alpha");
  assert.equal(flow.gaps[0].capability, "memory");
  assert.equal(flow.gaps[0].requires_approval, true);
  assert.equal(flow.gaps[0].trusted_candidates[0].name, "user-choice");
});

test("findCapabilityGaps reports unresolved configured requirements once", () => {
  const playbooks = {
    one: { description: "one", agents: [], skill_flow: { label: "one", steps: [{ stage: "build", capability: "testing", reason: "test" }] } },
    two: { description: "two", agents: [], skill_flow: { label: "two", steps: [{ stage: "verify", capability: "testing", reason: "verify" }, { stage: "review", capability: "code review", reason: "review" }] } },
  };

  assert.deepEqual(findCapabilityGaps(playbooks, { tdd: { description: "testing", capabilities: ["testing"] } }, { bundledIndex: {} }).map((gap) => gap.capability), ["code review"]);
});

test("schema v2 requires resolved skill snapshots", () => {
  const snapshot = {
    schema_version: 2,
    name: "demo",
    task: "build an API",
    playbook: "fullstack-feature",
    playbook_description: "Build",
    agents: [{ name: "backend-developer", skills: ["tdd"] }],
    baseline_skills: ["ponytail"],
    questions: [],
    skill_flow: { label: "build", steps: [{ stage: "build", skill: "tdd", reason: "Test" }] },
    policy: "policies/workflow-policy.md",
  };

  assert.deepEqual(validateSnapshot(snapshot, "demo.json"), [
    "demo.json: baseline skill 1 must be a resolved skill object",
    "demo.json: agent 1 skill 1 must be a resolved skill object",
    "demo.json: skill_flow step 1 status must be installed, recommended, or fallback",
  ]);
});

test("schema v2 reports malformed collections instead of throwing", () => {
  const errors = validateSnapshot({ schema_version: 2, agents: {}, baseline_skills: {} }, "bad.json");
  assert.ok(errors.includes("bad.json: key agents must be array"));
  assert.ok(errors.includes("bad.json: key baseline_skills must be array"));
});

test("schema v2 requires complete persisted flow fields", () => {
  const errors = validateSnapshot({
    schema_version: 2,
    name: "demo",
    task: "build",
    playbook: "fullstack-feature",
    playbook_description: "Build",
    agents: [],
    baseline_skills: [],
    questions: [],
    skill_flow: { label: "", steps: [{ skill: "tdd", status: "recommended" }] },
    policy: "policies/workflow-policy.md",
  }, "demo.json");

  assert.ok(errors.includes("demo.json: skill_flow.label must be a non-empty string"));
  assert.ok(errors.includes("demo.json: skill_flow step 1 stage must be a non-empty string"));
  assert.ok(errors.includes("demo.json: skill_flow step 1 reason must be a non-empty string"));
});

test("schema v4 rejects persisted runtime paths", () => {
  const errors = validateSnapshot({
    schema_version: 4,
    name: "portable",
    task: "build",
    path: "C:\\repo",
    playbook: "fullstack-feature",
    playbook_description: "Build",
    agents: [{ name: "backend-developer", skills: [{ name: "tdd", status: "installed", provider: "project", path: "C:/skills/tdd" }] }],
    baseline_skills: [],
    questions: [],
    skill_flow: { label: "build", steps: [{ stage: "build", capability: "testing", skill: "tdd", status: "installed", provider: "project", reason: "Test" }], gaps: [] },
    capability_gaps: [],
    policy: "policies/workflow-policy.md",
  }, "portable.json");

  assert.ok(errors.includes("portable.json: must not persist target repository path"));
  assert.ok(errors.includes("portable.json: agent 1 skill 1 must not persist a runtime path"));
});

test("schema v5 requires portable attempt metadata and lifecycle guidance", () => {
  const errors = validateSnapshot({
    schema_version: 5,
    name: "demo", task: "build", playbook: "fullstack-feature", playbook_description: "Build",
    agents: [], baseline_skills: [], questions: [], capability_gaps: [], policy: "policies/workflow-policy.md",
    skill_flow: { label: "build", steps: [] },
    attempt: { id: "demo", path: "Z:\\fixtures\\demo" },
    lifecycle: {},
  }, "demo");

  assert.ok(errors.includes("demo: attempt path must be target-relative"));
  assert.ok(errors.includes("demo: lifecycle.review must be a non-empty string"));
});

test("validateSnapshot accepts a valid compaction directive and rejects a malformed one", () => {
  const base = {
    schema_version: 5, name: "demo", task: "build", playbook: "fullstack-feature", playbook_description: "Build",
    agents: [], baseline_skills: [], questions: [], capability_gaps: [], policy: "policies/workflow-policy.md",
    skill_flow: { label: "build", steps: [] },
    attempt: { id: "demo", path: "attempts/demo" },
    lifecycle: { clarify: "c", prototype: "p", split: "s", implement: "i", review: "r" },
  };
  // Valid compaction -> no compaction-related error.
  const valid = validateSnapshot({ ...base, compaction: { method: "verbatim-line", preserve_recent: 3, compression_ratio: 0.4, protected: ["objective"] } }, "demo");
  assert.ok(!valid.some((e) => e.includes("compaction")));

  // Absent compaction -> no error (backward compatible, applies defaults).
  const absent = validateSnapshot({ ...base }, "demo");
  assert.ok(!absent.some((e) => e.includes("compaction")));

  // Malformed -> errors per field.
  const bad = validateSnapshot({ ...base, compaction: { method: "summarize", preserve_recent: -1, compression_ratio: 2, protected: ["", 5] } }, "demo");
  assert.ok(bad.includes("demo: compaction.method must be \"verbatim-line\""));
  assert.ok(bad.includes("demo: compaction.preserve_recent must be a non-negative integer"));
  assert.ok(bad.includes("demo: compaction.compression_ratio must be a number from 0.1 to 0.9"));
  assert.ok(bad.includes("demo: compaction.protected must be an array of non-empty strings"));
});

test("validateSnapshot tolerates optional per-step output and rejects empty output", () => {
  const base = {
    schema_version: 5, name: "demo", task: "build", playbook: "fullstack-feature", playbook_description: "Build",
    agents: [], baseline_skills: [], questions: [], capability_gaps: [], policy: "policies/workflow-policy.md",
    skill_flow: { label: "build", steps: [{ stage: "build", capability: "testing", skill: "tdd", status: "installed", provider: "project", reason: "Drive behavior", output: "green test" }] },
    attempt: { id: "demo", path: "attempts/demo" },
    lifecycle: { clarify: "c", prototype: "p", split: "s", implement: "i", review: "r" },
  };
  // Present and non-empty -> no output error.
  assert.ok(!validateSnapshot(base, "demo").some((e) => e.includes("output")));

  // Absent -> no error.
  const noOutput = structuredClone(base);
  delete noOutput.skill_flow.steps[0].output;
  assert.ok(!validateSnapshot(noOutput, "demo").some((e) => e.includes("output")));

  // Empty -> error.
  const empty = structuredClone(base);
  empty.skill_flow.steps[0].output = "  ";
  assert.ok(validateSnapshot(empty, "demo").includes("demo: skill_flow step 1 output must be a non-empty string"));
});

test("validateSnapshot rejects a blocking capability-reference gap", () => {
  const gap = {
    code: "invalid_router_reference",
    blocking: true,
    question: "grill-me has no installed model-invoked engine",
  };
  const snapshot = {
    schema_version: 5, name: "demo", task: "grill me", playbook: "improve-plan", playbook_description: "Plan",
    agents: [], baseline_skills: [], questions: [], capability_gaps: [gap], policy: "policies/workflow-policy.md",
    skill_flow: { label: "decide", steps: [], gaps: [gap] },
    attempt: { id: "demo", path: "attempts/demo" },
    lifecycle: { clarify: "c", prototype: "p", split: "s", implement: "i", review: "r" },
  };

  assert.ok(validateSnapshot(snapshot, "demo").includes(
    "demo: blocking capability gap: grill-me has no installed model-invoked engine",
  ));
});

test("validateSnapshot accepts the local-first issue policy and rejects unsafe shapes", () => {
  const base = {
    schema_version: 5, name: "demo", task: "t", playbook: "triage", playbook_description: "d",
    agents: [], baseline_skills: [], questions: [], capability_gaps: [], policy: "policies/workflow-policy.md",
    skill_flow: { label: "l", steps: [] },
    attempt: { id: "a", path: ".dirf/attempts/a" },
    lifecycle: { clarify: "c", prototype: "p", split: "s", implement: "i", review: "r" },
  };
  const issuePolicy = {
    schemaVersion: 1, version: "dirf-local-findings-v1", mode: "local_only",
    externalCreation: "project_policy_required",
  };
  assert.deepEqual(validateSnapshot({ ...base, issue_policy: issuePolicy }, "demo"), []);
  assert.ok(validateSnapshot({ ...base, issue_policy: { ...issuePolicy, mode: "github_first" } }, "demo").includes("demo: issue_policy.mode must be local_only"));
  assert.ok(validateSnapshot({ ...base, issue_policy: { ...issuePolicy, externalCreation: "automatic" } }, "demo").includes("demo: issue_policy.externalCreation must be project_policy_required"));
});
