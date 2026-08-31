// Router tests via node:test. Run: npm run test:router
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectRoutingFacts, loadPlaybooks, recommend } from "../src/router.js";
import { folderHash } from "../src/paths.js";

test("landing page match", () => {
  const r = recommend("build a landing page");
  assert.equal(r.playbook, "landing-page");
  assert.ok(r.score > 0);
  assert.ok(r.matched_keywords.includes("landing"));
});

test("bug fix match", () => {
  assert.equal(recommend("fix a broken login bug").playbook, "bug-fix");
});

test("security review match", () => {
  assert.equal(recommend("audit security vulnerabilities in auth").playbook, "security-review");
});

test("governed agent execution routes to the enforceable execution playbook", () => {
  const result = recommend("apply RTK-inspired command governance to agent execution with exact tool authorization and a tamper evident ledger");
  assert.equal(result.playbook, "governed-agent-execution");
  assert.ok(result.workflow.phases.includes("consume authority and execute through one adapter"));
  assert.match(result.workflow.validation, /every segment/);
});

test("implementation intent outranks incidental auth terminology", () => {
  assert.equal(
    recommend("Add GitHub repository sync to governance intake with auth, persistence, and tests").playbook,
    "fullstack-feature",
  );
  assert.equal(recommend("Add account settings with auth and permissions").playbook, "fullstack-feature");
  assert.equal(recommend("Create a security feature with auth").playbook, "fullstack-feature");
  assert.equal(recommend("Implement auth vulnerability remediation").playbook, "fullstack-feature");
  assert.equal(recommend("Fix auth vulnerability").playbook, "bug-fix");
  assert.equal(recommend("Create a security audit of auth").playbook, "security-review");
  assert.equal(recommend("Implement a security audit of auth").playbook, "security-review");
});

test("negated implementation language does not override explicit PR review", () => {
  assert.equal(recommend("Review PR #900 and do not add split behavior").playbook, "pr-review");
});

test("standalone negated actions do not route the forbidden work", () => {
  for (const [task, forbidden] of [
    ["Do not deploy the release", "deployment"],
    ["Do not review PR 47", "pr-review"],
    ["Do not implement the feature", "fullstack-feature"],
  ]) {
    assert.notEqual(recommend(task).playbook, forbidden);
    assert.equal(recommend(task).playbook, "triage");
  }
});

test("negated clauses preserve explicit replacement work", () => {
  for (const task of [
    "Do not grill me and instead review PR 47",
    "Don't interview me—just review PR 47",
  ]) assert.equal(recommend(task).playbook, "pr-review");
});

test("common interview exclusions are normalized before routing", () => {
  for (const task of [
    "Do not ask me questions; improve the plan another way",
    "Improve the plan without an interview",
    "Improve the plan; no questions",
    "Improve the plan; no interview",
    "Improve the plan; no interviews",
    "Improve the plan; skip the interview",
    "Improve the plan; avoid interview",
    "Improve the plan; do not use an interview",
    "Improve the plan; don't run an interview",
    "Improve the plan; do not start an interview",
    "Improve the plan; avoid asking me questions",
    "Improve the plan; skip asking me questions",
    "Improve the plan without asking me questions",
    "Improve the plan; I don't want an interview",
    "Improve the plan; no more questions",
    "Improve the plan; do not ask any more questions",
  ]) {
    const result = recommend(task);
    assert.equal(result.playbook, "improve-plan", task);
    assert.equal(result.questions.length, 0, task);
    assert.ok(result.skill_flow.steps.every((step) => step.capability !== "plan interview"), task);
    assert.ok(result.workflow.phases.includes("draft the smallest evidence-based plan"), task);
  }
  assert.equal(recommend("Review PR 47, but do not use Grill Me").playbook, "pr-review");
});

test("explicit interview replacements remove only the excluded mode", () => {
  const plain = recommend("Do not use Grill With Docs; use Grill Me instead");
  assert.equal(plain.playbook, "improve-plan");
  assert.ok(!plain.agents.includes("documentation-engineer"));

  const documented = recommend("Do not use Grill Me; use Grill With Docs instead");
  assert.equal(documented.playbook, "improve-plan");
  assert.ok(documented.agents.includes("documentation-engineer"));
});

test("implementation intent outranks domain review terminology", () => {
  assert.equal(
    recommend("Add paid-save entitlement checks and creator execution review access with Supabase persistence and tests").playbook,
    "fullstack-feature",
  );
});

test("frontend mention routes to ui-ux-review", () => {
  const r = recommend("refactor the audio module frontend");
  assert.equal(r.playbook, "ui-ux-review");
  assert.ok(r.matched_keywords.includes("frontend"));
});

test("redesign routes to ui-ux-review", () => {
  assert.equal(recommend("redesign the dashboard").playbook, "ui-ux-review");
});

test("visual mock comparison routes to end-to-end conformance", () => {
  const task = "Audit every screen and button against the design mock; record missing screens and CTAs without implementing fixes";
  assert.equal(recommend(task).playbook, "visual-conformance");
});

test("visual conformance with fixes carries implementation and recapture phases", () => {
  const workflow = recommend("Compare every screen to the design mock, restore missing screens and buttons, and fix every verified mismatch").workflow;
  assert.ok(workflow.phases.includes("implement dependency-ordered issue-owned fixes"));
  assert.ok(workflow.phases.includes("independently recapture and verify the complete matrix"));
  assert.match(workflow.output, /implemented fixes/);
});

test("generic refactor routes to impeccable-polish", () => {
  assert.equal(recommend("refactor the parser for clarity").playbook, "impeccable-polish");
});

test("frontend refactor prefers ui-ux-review over impeccable-polish", () => {
  assert.equal(recommend("frontend refactor of the audio module").playbook, "ui-ux-review");
});

test("content overlap routes a keyword-less task by what the playbook does", () => {
  const r = recommend("reproduce and isolate the crash when saving");
  assert.equal(r.playbook, "bug-fix");
  assert.deepEqual(r.matched_keywords, []);
  assert.ok(r.matched_context.includes("reproduce"));
});

test("content overlap routes research phrasing without keywords", () => {
  assert.equal(recommend("synthesize recommendations about a technology").playbook, "research");
});

test("explicit large-work decision mapping routes to the optional planning playbook", () => {
  const result = recommend("Create a decision map for a large unclear effort before specification and delivery tickets");
  assert.equal(result.playbook, "decision-mapping");
  assert.deepEqual(result.workflow.gates["approve the route into specification"], {
    kind: "decision",
    artifact_type: "research",
  });
  assert.equal(result.skill_flow.steps[0].capability, "plan interview");
  assert.ok(result.workflow.phases.every((phase) => !/implement|build|execute/.test(phase)));
});

test("explicit Grill Me and one-question interview requests route to improve-plan", () => {
  for (const task of [
    "grill me about a design before implementation",
    "grill with docs before implementation",
    "grill-with-docs before implementation",
    "interview me one question at a time to sharpen a software plan before implementation",
  ]) {
    const result = recommend(task);
    assert.equal(result.playbook, "improve-plan");
    assert.ok(result.workflow.phases.includes("confirm shared understanding"));
    assert.deepEqual(result.workflow.gates["confirm shared understanding"], { kind: "decision" });
  }
});

test("Grill With Docs adds a documentation owner after the accepted decision", () => {
  const result = recommend("grill with docs before implementation");
  assert.ok(result.agents.includes("documentation-engineer"));
  assert.ok(result.workflow.phases.indexOf("record accepted domain language and durable decisions") >
    result.workflow.phases.indexOf("confirm shared understanding"));
  assert.deepEqual(result.workflow.agent_contracts["documentation-engineer"].phases, [
    "record accepted domain language and durable decisions",
  ]);
  assert.match(result.workflow.agent_contracts["documentation-engineer"].verification, /accepted interview decision/);
});

test("an explicit interview checkpoint precedes a mixed review or build request", () => {
  for (const [task, continuation, continuationPhase] of [
    ["Review PR 47 and grill me about the risks first", "pr-review", "freeze exact base and head"],
    ["Grill with docs before you review this pull request", "pr-review", "freeze exact base and head"],
    ["Build the feature, but interview me one question at a time before implementation", "fullstack-feature", "define user outcome"],
  ]) {
    const result = recommend(task);
    assert.equal(result.playbook, "improve-plan");
    assert.deepEqual(result.workflow.gates["confirm shared understanding"], { kind: "decision" });
    assert.equal(result.continuation.playbook, continuation);
    assert.ok(result.workflow.phases.indexOf(continuationPhase) > result.workflow.phases.indexOf("confirm shared understanding"));
    assert.ok(result.workflow.gates["define verification gates"], "the interview's final phase becomes a tracked transition");
    assert.ok(result.skill_flow.steps.some((step) => step.capability === "code review" || step.capability === "testing"));
  }
});

test("standalone interview topics do not invent continuation work", () => {
  for (const task of [
    "Grill me about the code architecture decisions",
    "Grill me about security review expectations",
  ]) {
    const result = recommend(task);
    assert.equal(result.playbook, "improve-plan");
    assert.equal(result.continuation, undefined);
  }
});

test("sequenced change, update, and writing verbs preserve requested continuation work", () => {
  for (const task of [
    "Grill me before changing the checkout flow",
    "Grill me before modifying the checkout flow",
    "Grill me before updating the checkout flow",
    "Grill me, then write the approved feature",
  ]) {
    const result = recommend(task);
    assert.equal(result.playbook, "improve-plan");
    assert.equal(result.continuation.playbook, "fullstack-feature");
  }
});

test("workflow composition does not repeat capabilities already fulfilled by the interview", () => {
  const result = recommend("Grill me before changing the checkout flow");
  const capabilities = result.skill_flow.steps.map((step) => step.capability);
  assert.equal(capabilities.filter((capability) => capability === "plan interview").length, 1);
  assert.equal(capabilities.filter((capability) => capability === "minimalism").length, 1);
});

test("action-first requests preserve both workflows in their stated order", () => {
  for (const task of [
    "Review the PR and grill me",
    "Review the PR, then grill me",
    "Review the PR before you grill me",
    "Review the PR and grill me afterward",
    "After you review the PR, grill me",
    "Grill me after you review the PR",
    "Grill me after you review the PR first",
    "Grill me after you first review the PR",
    "Once you review PR 47, grill me",
    "When you finish reviewing PR 47, grill me",
    "Only after reviewing PR 47, grill me",
  ]) {
    const result = recommend(task);
    assert.equal(result.playbook, "pr-review", task);
    assert.equal(result.continuation.playbook, "improve-plan", task);
    assert.equal(result.continuation.transition, "after-primary", task);
    assert.ok(result.workflow.phases.indexOf("freeze exact base and head") <
      result.workflow.phases.indexOf("confirm shared understanding"), task);
    assert.ok(result.continuation.questions.includes("What outcome should this plan optimize for?"), task);
    assert.ok(!result.questions.includes("What outcome should this plan optimize for?"), task);
  }
});

test("plain action-first conjunctions preserve build work before the interview", () => {
  const result = recommend("Build the feature and grill me");
  assert.equal(result.playbook, "fullstack-feature");
  assert.equal(result.continuation.playbook, "improve-plan");
  assert.equal(result.continuation.transition, "after-primary");
  assert.ok(result.workflow.phases.indexOf("define user outcome") <
    result.workflow.phases.indexOf("confirm shared understanding"));
  const interviewSteps = result.skill_flow.steps
    .map((step, index) => ({ ...step, index }))
    .filter((step) => step.capability === "plan interview");
  assert.equal(interviewSteps.length, 2);
  assert.equal(interviewSteps.at(-1).stage, "decide");
  assert.ok(interviewSteps.at(-1).index >= loadPlaybooks()["fullstack-feature"].skill_flow.steps.length);
});

test("composed workflows give every phase exactly one typed owner", () => {
  for (const task of ["Grill me before reviewing PR 47", "Review PR 47, then grill me"]) {
    const result = recommend(task);
    const ownership = new Map(result.workflow.phases.map((phase) => [phase, []]));
    for (const [agent, contract] of Object.entries(result.workflow.agent_contracts)) {
      for (const phase of contract.phases) ownership.get(phase).push(agent);
    }
    for (const [phase, owners] of ownership) assert.equal(owners.length, 1, `${task}: ${phase}`);
  }
});

test("common multi-agent actions compose with declared ownership", () => {
  for (const task of [
    "Grill me, then fix the checkout bug",
    "Grill me, then run a security audit",
    "Grill me, then deploy the release",
    "Grill me, then build a landing page",
  ]) {
    const result = recommend(task);
    assert.equal(result.playbook, "improve-plan", task);
    assert.ok(result.continuation, task);
    const ownership = new Map(result.workflow.phases.map((phase) => [phase, []]));
    for (const [agent, contract] of Object.entries(result.workflow.agent_contracts)) {
      for (const phase of contract.phases) ownership.get(phase).push(agent);
    }
    for (const [phase, owners] of ownership) assert.equal(owners.length, 1, `${task}: ${phase}`);
  }
});

test("every bundled multi-agent workflow declares exactly one owner per phase", () => {
  for (const [name, playbook] of Object.entries(loadPlaybooks())) {
    if ((playbook.agents || []).length < 2) continue;
    const owners = new Map(playbook.workflow.phases.map((phase) => [phase, []]));
    for (const [agent, contract] of Object.entries(playbook.workflow.agent_contracts || {})) {
      for (const phase of contract.phases || []) owners.get(phase)?.push(agent);
    }
    for (const [phase, phaseOwners] of owners) {
      assert.equal(phaseOwners.length, 1, `${name}: ${phase}`);
    }
  }
});

test("generic interview negation resolves a complete non-interview plan", () => {
  const result = recommend("Do not interview me; improve the plan another way");
  assert.equal(result.playbook, "improve-plan");
  assert.equal(result.questions.length, 0);
  assert.equal(result.skill_flow.steps.some((step) => step.capability === "plan interview"), false);
  const persisted = JSON.stringify({
    phases: result.workflow.phases,
    gates: result.workflow.gates,
    contracts: result.workflow.agent_contracts,
    output: result.workflow.output,
    validation: result.workflow.validation,
  });
  assert.doesNotMatch(persisted, /ask and record|confirm shared understanding|one unresolved decision/i);
  assert.ok(result.workflow.phases.includes("draft the smallest evidence-based plan"));
});

test("negated interview and action cues never become executable work", () => {
  assert.equal(recommend("do not grill me, just review PR 47").playbook, "pr-review");
  for (const task of [
    "grill me about release risks but do not deploy anything",
    "grill me, then I do not want you to deploy anything",
    "grill me about the design but do not implement it",
  ]) {
    const result = recommend(task);
    assert.equal(result.playbook, "improve-plan");
    assert.equal(result.continuation, undefined);
  }
});

test("documentation changes keep their specific playbook with or without an interview", () => {
  assert.equal(recommend("update docs").playbook, "documentation");
  const result = recommend("grill me then update docs");
  assert.equal(result.playbook, "improve-plan");
  assert.equal(result.continuation.playbook, "documentation");
});

test("continuation composition merges contracts owned by the same agent", () => {
  const playbooks = structuredClone(loadPlaybooks());
  const continuation = playbooks["fullstack-feature"];
  continuation.agents = [...new Set([...continuation.agents, "workflow-orchestrator"])];
  continuation.workflow.agent_contracts = {
    "workflow-orchestrator": {
      phases: ["define user outcome"],
      output: "an implementation outcome",
      verification: "the implementation outcome is verified",
    },
  };

  const result = recommend("Build the feature, but grill me first", [], playbooks);
  const contract = result.workflow.agent_contracts["workflow-orchestrator"];
  assert.ok(contract.phases.includes("inspect repository facts and existing decisions"));
  assert.ok(contract.phases.includes("define user outcome"));
  assert.match(contract.output, /confirmed decision record.*implementation outcome/);
  assert.match(contract.verification, /decision gate is accepted.*implementation outcome is verified/);
});

test("ordinary understood feature work bypasses decision mapping", () => {
  assert.equal(
    recommend("Build the approved account settings feature from the existing specification").playbook,
    "fullstack-feature",
  );
});

test("short keywords only match whole words, not inside other words", () => {
  // "pr" must not match inside "reproduce"
  const r = recommend("reproduce the crash when saving");
  assert.notEqual(r.playbook, "pr-review");
  // but plurals still count
  assert.equal(recommend("review the prs for regressions").playbook, "pr-review");
});

test("keywords match complete words and simple plurals, not inflections or embedded phrases", () => {
  assert.ok(recommend("measure the bundle").matched_keywords.includes("bundle"));
  assert.ok(recommend("measure the bundles").matched_keywords.includes("bundle"));
  assert.notEqual(recommend("use bundled defaults").playbook, "performance-pass");
  assert.notEqual(recommend("inspect score web vitals").playbook, "performance-pass");

  const auditedTask = "Keep DIRF unopinionated and complete with zero-install bundled defaults, prefer relevant capabilities already enabled on the host when they help with context rot or output quality, and offer provenance-bound optional source suggestions when capabilities are missing without hardcoding products, auto-installing anything, or positioning DIRF as a token-savings tool.";
  assert.notEqual(recommend(auditedTask).playbook, "performance-pass");
});

test("falls back to triage when nothing matches", () => {
  const r = recommend("xyzzy qwerty nothing matches here");
  assert.equal(r.playbook, "triage");
  assert.equal(r.score, 0);
});

test("triage cues still use the unclassified fallback", () => {
  const r = recommend("help me triage where to start");
  assert.equal(r.playbook, "triage");
  assert.equal(r.score, 0);
  assert.deepEqual(r.matched_keywords, []);
});

test("alternates present on multi-match", () => {
  // "review a pr for security bugs" matches pr-review, security-review, bug-fix
  const r = recommend("review a pr for security bugs");
  assert.ok(["pr-review", "security-review", "bug-fix"].includes(r.playbook));
  assert.ok(r.alternates.length >= 1);
  for (const alt of r.alternates) {
    assert.ok("playbook" in alt && "score" in alt && "description" in alt);
  }
});

test("workflow contract is carried through", () => {
  const r = recommend("build a landing page");
  assert.ok("phases" in r.workflow);
  assert.ok("output" in r.workflow);
  assert.ok(Array.isArray(r.agents) && r.agents.length > 0);
  assert.ok(Array.isArray(r.baseline_skills));
  assert.ok(Array.isArray(r.questions));
});

test("a cue-less conditional contract never replaces the base workflow", () => {
  const base = {
    description: "Route a demo task", keywords: ["demo"], agents: [], questions: [],
    workflow: {
      phases: ["base"], output: "base output", validation: "check base", recovery: "recover base",
      conditional_contract: { phases: ["conditional"], output: "conditional output" },
    },
    skill_flow: { label: "demo", steps: [{ stage: "route", reason: "Route", capability: "minimalism" }] },
  };
  const result = recommend("demo", [], { triage: base, demo: base });
  assert.deepEqual(result.workflow.phases, ["base"]);
  assert.equal(result.workflow.output, "base output");
});

test("facts augment matching", () => {
  const without = recommend("help me with something");
  const withFacts = recommend("help me", ["build a landing page"]);
  assert.ok(withFacts.score >= without.score);
});

test("frontend design refactor selects the UI playbook", () => {
  assert.equal(recommend("continue frontend design refactor").playbook, "ui-ux-review");
});

test("work-in-progress facts augment routing", () => {
  const r = recommend("continue the current work", ["branch: m024/design-system-foundation"]);
  assert.equal(r.playbook, "ui-ux-review");
  assert.ok(r.matched_keywords.includes("design-system"));
});

test("work-in-progress facts cannot override explicit PR-review intent", () => {
  const r = recommend(
    "Review pull request 23 and determine merge next steps",
    ["changed: product-build-prompt.md", "changed: AGENTS.md", "changed: cleanup-notes.md"],
  );
  assert.equal(r.playbook, "pr-review");
});

test("work-in-progress facts cannot override explicit UI intent", () => {
  const r = recommend(
    "ui ux review, figure out what design piece to work on next",
    ["changed: AGENTS.md", "branch: m024/design-system-foundation"],
  );
  assert.equal(r.playbook, "ui-ux-review");
});

test("explicit visual acceptance outranks incidental auth and Audit stage terms", () => {
  const r = recommend(
    "UI UX visual acceptance test for the authenticated Story workspace across Script, Scenes, Cast, Prompts, Audit, and Storyboard on desktop and 390px mobile; verify persistence, reload, behavior, and approved component parity without generation or spend.",
  );

  assert.equal(r.playbook, "ui-ux-review");
  assert.ok(r.alternates.some((alternate) => alternate.playbook === "security-review"));
  assert.match(r.workflow.output, /screen x state x viewport manifest/);
  assert.match(r.workflow.validation, /source-discovery completeness/);
  assert.ok(r.workflow.requirements.some((requirement) => requirement.includes("parent-page screenshot cannot cover")));
  assert.ok(r.workflow.requirements.some((requirement) => requirement.includes("security, privacy, and no-spend")));
  assert.deepEqual(r.workflow.phases.slice(0, 2), [
    "derive the source-reachable screen and state inventory",
    "freeze the complete screen x state x viewport manifest and exact references",
  ]);
});

test("generic UI review does not receive the authenticated acceptance contract", () => {
  const r = recommend("review responsive typography");
  assert.equal(r.playbook, "ui-ux-review");
  assert.equal(r.workflow.output, "UI/UX plan or review with concrete fixes and verification checks");
  assert.equal(r.workflow.requirements, undefined);

  for (const task of ["authenticated ui ux review", "unauthenticated visual acceptance"]) {
    const generic = recommend(task);
    assert.equal(generic.playbook, "ui-ux-review");
    assert.equal(generic.workflow.requirements, undefined);
  }
});

test("direct authenticated acceptance cues route to the complete UI contract", () => {
  for (const task of [
    "authenticated visual acceptance",
    "authenticated visual regression",
    "authenticated ui ux acceptance",
    "authenticated ui/ux acceptance",
  ]) {
    const r = recommend(task);
    assert.equal(r.playbook, "ui-ux-review");
    assert.match(r.workflow.output, /screen x state x viewport manifest/);
  }
});

test("collectRoutingFacts reads branch, changed paths, and active plan", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-facts-"));
  execFileSync("git", ["init", "-b", "design-system-foundation", root]);
  mkdirSync(join(root, ".gsd"));
  writeFileSync(join(root, ".gsd", "STATE.md"), "**Active Milestone:** Frontend refactor\n");
  writeFileSync(join(root, "DesignPanel.tsx"), "export {}\n");
  execFileSync("git", ["-C", root, "add", "DesignPanel.tsx"]);
  execFileSync("git", ["-C", root, "-c", "user.name=DIRF Test", "-c", "user.email=dirf@example.invalid", "commit", "-m", "seed"]);
  writeFileSync(join(root, "DesignPanel.tsx"), "export const changed = true\n");

  const facts = collectRoutingFacts(root);
  assert.ok(facts.includes("branch: design-system-foundation"));
  assert.ok(facts.includes("changed: DesignPanel.tsx"));
  assert.ok(facts.includes("plan: Active Milestone: Frontend refactor"));
});

test("folderHash tracks authoritative README content", () => {
  const root = mkdtempSync(join(tmpdir(), "dirf-hash-"));
  mkdirSync(join(root, "demo"));
  writeFileSync(join(root, "demo", "README.md"), "first\n");
  const first = folderHash(root);
  writeFileSync(join(root, "demo", "README.md"), "second\n");
  assert.notEqual(folderHash(root), first);
});

// ─── Stack-aware routing ───────────────────────────────────────────────────
// The regression that motivated this: a React/Vite web app task that mentions
// "video" as a MODULE NAME was routed to video-campaign. "video" is a medium
// noun here, not a production request. The detected stack + code-structure
// intent must steer it to a software playbook instead.

const WEB_STACK = { frameworks: ["React", "Vite", "Tailwind CSS", "TanStack Query", "Zustand", "Supabase"], appKind: "web" };
const ELECTRON_STACK = { frameworks: ["Electron", "React"], appKind: "electron" };
const NODE_STACK = { frameworks: ["Express"], appKind: "node" };

test("the bug: a React web app task naming 'video' as a module routes to fullstack-feature, not video-campaign", () => {
  // The exact shape of the reported misroute: gate/predicate/route/module intent
  // + "video" as a module label, against a detected web stack.
  const task = "Gate modules on content instead of route position so empty Video Audio Edit and Export are unreachable, shared predicate for the desktop rail";
  const r = recommend(task, [], undefined, WEB_STACK);
  assert.equal(r.playbook, "fullstack-feature", `expected fullstack-feature, got ${r.playbook}`);
  assert.notEqual(r.playbook, "video-campaign");
});

test("medium-noun demotion is stack-agnostic: even with no stack profile, 'video' as a module name does not win video-campaign", () => {
  // The demotion guard (Part 3b) fires without a stack too, so the fix holds
  // for non-Node repos DIRF cannot profile.
  const r = recommend("gate the video module behind a content predicate and route guard");
  assert.notEqual(r.playbook, "video-campaign");
});

test("explicit video-production intent still wins video-campaign even in a detected web repo", () => {
  // Regression guard against over-correction: a genuine campaign-video request
  // must still route to video-campaign in a React repo, because multiple
  // production keywords match AND the task has no code-structure intent.
  const r = recommend("produce a launch campaign video with motion design and b-roll for youtube shorts", [], undefined, WEB_STACK);
  assert.equal(r.playbook, "video-campaign");
});

test("electron-app requires an electron stack — a 'desktop rail' task in a web repo is NOT misrouted to electron-app", () => {
  // The original workflow.json also listed electron-app as an alternate on the
  // strength of "desktop". With a web stack detected, electron-app is not the
  // software affinity winner.
  const r = recommend("rework the desktop rail navigation for the workspace", [], undefined, WEB_STACK);
  assert.notEqual(r.playbook, "electron-app");
});

test("electron task in an electron repo routes to electron-app", () => {
  const r = recommend("fix the IPC handler in the main process that crashes the BrowserWindow on cold start", [], undefined, ELECTRON_STACK);
  assert.equal(r.playbook, "electron-app");
});

test("no stack (null/undefined) leaves existing keyword routing intact", () => {
  // Backward compatibility: callers that pass no stack get pre-change behavior.
  assert.equal(recommend("build a landing page").playbook, "landing-page");
  assert.equal(recommend("build a landing page", [], undefined, null).playbook, "landing-page");
  assert.equal(recommend("build a landing page", [], undefined, undefined).playbook, "landing-page");
  // A real video production request with no stack still routes correctly.
  assert.equal(recommend("render a campaign video for youtube shorts").playbook, "video-campaign");
});

test("node stack boosts software playbooks for backend intent", () => {
  const r = recommend("add a login endpoint with database persistence and tests", [], undefined, NODE_STACK);
  assert.equal(r.playbook, "fullstack-feature");
});

test("audio as a module name does not win video-campaign for a code task", () => {
  // Sibling medium noun: same shape of false match.
  const r = recommend("extract the audio module reducer into its own hook with a typed store", [], undefined, WEB_STACK);
  assert.notEqual(r.playbook, "video-campaign");
});

// ─── Project playbook directory experiment ───────────────────────────────────

function writeProjectPlaybook(root, name, config) {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, "README.md"), [
    "---",
    `name: ${name}`,
    "kind: playbook",
    "order: 9",
    'description: "Project-supplied playbook for the portability experiment."',
    "uses: []",
    "details: []",
    'inputs: ["task"]',
    'outputs: ["workflow"]',
    "capabilities: []",
    `config: ${JSON.stringify(config)}`,
    "---",
    "",
    `# ${name}`,
    "",
    "Project-supplied playbook body. Treated as inert metadata; never executed.",
  ].join("\n"));
}

const DECISION_LEDGER_CONFIG = {
  description: "Maintain the project decision ledger.",
  keywords: ["decision ledger", "record decisions"],
  agents: ["workflow-orchestrator"],
  workflow: {
    phases: ["list open decisions", "record accepted answers"],
    output: "a maintained decision ledger",
    validation: "every open decision is a precise question; every accepted answer links to one authoritative artifact",
    recovery: "if a decision cannot be stated precisely, record it as not yet specified and stop",
  },
  skill_flow: {
    label: "open decisions -> accepted answers -> ledger",
    steps: [{ stage: "record", reason: "Record accepted answers once and link them.", capability: "domain modeling", output: "a maintained ledger" }],
  },
  questions: ["Which decisions are open?"],
};

test("loadPlaybooks without options returns no provenance fields", () => {
  const playbooks = loadPlaybooks();
  assert.ok(playbooks["fullstack-feature"]);
  assert.equal("playbook_source" in playbooks["fullstack-feature"], false);
  assert.equal("playbook_source_path" in playbooks["fullstack-feature"], false);
});

test("project playbook directory loads unique playbooks, routes them, and records provenance", () => {
  const root = mkdtempSync(join(tmpdir(), "proj-pbs-"));
  writeProjectPlaybook(root, "decision-ledger", DECISION_LEDGER_CONFIG);
  const playbooks = loadPlaybooks({ projectPlaybookDir: root });
  assert.equal(playbooks["decision-ledger"].playbook_source, "project");
  assert.ok(playbooks["decision-ledger"].playbook_source_path.endsWith("decision-ledger"));
  assert.equal(playbooks["fullstack-feature"].playbook_source, "bundled");

  const r = recommend("maintain the decision ledger for this project", [], playbooks);
  assert.equal(r.playbook, "decision-ledger");
  assert.equal(r.playbook_source, "project");
  assert.ok(r.playbook_source_path.endsWith("decision-ledger"));
  assert.equal(r.workflow.phases[0], "list open decisions");
});

test("a same-name project playbook collides fail-closed and names both sources", () => {
  const root = mkdtempSync(join(tmpdir(), "proj-collide-"));
  writeProjectPlaybook(root, "fullstack-feature", DECISION_LEDGER_CONFIG);
  assert.throws(
    () => loadPlaybooks({ projectPlaybookDir: root }),
    /collides: bundled at .*fullstack-feature.*project at .*fullstack-feature.*no silent override/,
  );
});

test("malformed or missing project playbook inputs fail before routing", () => {
  const missing = join(tmpdir(), "does-not-exist-anywhere");
  assert.throws(() => loadPlaybooks({ projectPlaybookDir: missing }), /does not exist/);

  const noFrontmatter = mkdtempSync(join(tmpdir(), "proj-broken-"));
  mkdirSync(join(noFrontmatter, "broken"));
  writeFileSync(join(noFrontmatter, "broken", "README.md"), "no frontmatter here\n");
  assert.throws(() => loadPlaybooks({ projectPlaybookDir: noFrontmatter }), /missing frontmatter/);

  const wrongKind = mkdtempSync(join(tmpdir(), "proj-kind-"));
  mkdirSync(join(wrongKind, "not-a-playbook"));
  writeFileSync(join(wrongKind, "not-a-playbook", "README.md"), [
    "---",
    "name: not-a-playbook",
    "kind: skill",
    "uses: []",
    "details: []",
    'inputs: []',
    'outputs: []',
    "capabilities: []",
    "---",
    "",
    "A skill, not a playbook.",
  ].join("\n"));
  assert.throws(() => loadPlaybooks({ projectPlaybookDir: wrongKind }), /expected kind playbook/);
});
