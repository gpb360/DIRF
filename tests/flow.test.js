import { test } from "node:test";
import assert from "node:assert/strict";
import { buildFlow, findCapabilityGaps, reconcile } from "../src/flow.js";
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
      status: "installed", provider: "project", selection_reason: "best installed match (105) for testing", rejected_candidates: [],
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
    ponytail: { path: "/home/skills/ponytail", description: "minimalism ladder", capabilities: ["minimalism"], provider: "claude" },
  });
  assert.equal(local.steps[0].skill, "ponytail");
  assert.equal(local.steps[0].status, "installed");
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
    attempt: { id: "demo", path: "C:\\tmp\\demo" },
    lifecycle: {},
  }, "demo");

  assert.ok(errors.includes("demo: attempt path must be target-relative"));
  assert.ok(errors.includes("demo: lifecycle.review must be a non-empty string"));
});
