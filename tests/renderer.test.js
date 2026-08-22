// Renderer tests via node:test. Run: npm run test:renderer
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveGraph } from "../src/folders.js";
import { parseAgentMd, renderMarkdownLite, buildInstructions, buildHtml, kickoffPrompt } from "../src/renderer.js";

test("parseAgentMd splits frontmatter and governance block", () => {
  const dir = mkdtempSync(join(tmpdir(), "dirf-rend-"));
  const path = join(dir, "demo.md");
  writeFileSync(path,
    "---\nname: demo\ndescription: x\ntools: A, B\n---\n" +
    "Intro paragraph.\n\n## Section\n- bullet\n\n" +
    "<!-- governance:v1 -->\n## Governance Boundary\n- rule\n", "utf-8");
  const out = parseAgentMd(path);
  assert.equal(out.frontmatter.name, "demo");
  assert.equal(out.frontmatter.tools, "A, B");
  assert.ok(!out.body.includes("Governance Boundary"));
  assert.ok(out.governance.includes("Governance Boundary"));
  assert.ok(out.body.includes("## Section"));
});

test("renderMarkdownLite handles headings and lists", () => {
  const html = renderMarkdownLite("# Title\n\n- one\n- two\n\n1. first\n\n**bold** and `code`");
  assert.ok(html.includes("<h2>Title</h2>"));
  assert.ok(html.includes("<ul>") && html.includes("<li>one</li>"));
  assert.ok(html.includes("<ol>") && html.includes("<li>first</li>"));
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(html.includes("<code>code</code>"));
});

test("renderMarkdownLite handles code fence", () => {
  const html = renderMarkdownLite("```js\nconst x = 1;\n```");
  assert.ok(html.includes("<pre><code>"));
  assert.ok(html.includes("const x = 1;"));
  assert.ok(html.includes("</code></pre>"));
});

test("renderMarkdownLite strips html comments", () => {
  const html = renderMarkdownLite("<!-- a comment -->\nvisible");
  assert.ok(!html.includes("a comment"));
  assert.ok(html.includes("visible"));
});

test("kickoff prompt is embedded in both renders and stays host-agnostic", () => {
  const workflow = {
    name: "demo", task: "review a pull request", playbook: "landing-page",
    workflow: { phases: ["a", "b"], output: "a page", validation: "v", recovery: "r", requirements: ["derive every screen x state x viewport row"] },
    agents: [{ name: "frontend-developer", file: "agents/frontend-developer.md", tags: [], skills: [] }],
    baseline_skills: [],
    skill_flow: { label: "persisted", branches: [], steps: [{ stage: "build", skill: "s", reason: "r", status: "recommended" }] },
    policy: "policies/workflow-policy.md", schema_version: 2,
  };
  const prompt = kickoffPrompt(workflow);
  assert.ok(prompt.includes('"demo" DIRF workflow'));
  assert.ok(prompt.includes("review a pull request"));
  assert.ok(prompt.includes("Repository: not recorded — ask which repository"), "prompt must tell outside models to ask for the repo");
  const withRepo = kickoffPrompt({ ...workflow, repository: { name: "myproject", remote: "https://example.test/org/myproject.git" } });
  assert.ok(withRepo.includes("Repository: https://example.test/org/myproject.git (myproject)"));
  assert.ok(withRepo.includes("Clone or open it before starting"));
  assert.ok(prompt.includes("frontend-developer"));
  assert.ok(prompt.includes("Begin with phase 1: a"));
  assert.ok(prompt.includes("Required acceptance contract"));
  assert.ok(prompt.includes("derive every screen x state x viewport row"));
  assert.ok(prompt.includes("For status updates, validation summaries, and handoffs"));
  assert.ok(prompt.includes("End with exactly one next action, or `Complete`"));
  assert.ok(!/codex|claude/i.test(prompt));
  assert.ok(!prompt.includes("```"), "prompt must be safe inside a fenced block");

  const outDir = mkdtempSync(join(tmpdir(), "dirf-kickoff-"));
  const readme = (buildInstructions(workflow, outDir), readFileSync(join(outDir, "README.md"), "utf-8"));
  assert.ok(readme.includes("## Kickoff prompt (copy into your model of choice)"));
  assert.ok(readme.includes('"demo" DIRF workflow'));
  assert.ok(readme.includes("## Required acceptance contract"));

  const html = buildHtml(workflow);
  assert.ok(html.includes("Kickoff prompt"));
  assert.ok(html.includes("Copy prompt"));
  assert.ok(html.includes('"demo" DIRF workflow'));
  assert.ok(html.includes("Required acceptance contract"));
});

test("buildInstructions writes router + per-agent detail", () => {

  const outDir = mkdtempSync(join(tmpdir(), "dirf-instr-"));
  const workflow = {
    name: "demo", task: "review a pull request", playbook: "landing-page",
    workflow: { phases: ["a", "b"], output: "a page", validation: "v", recovery: "r" },
    agents: [{ name: "frontend-developer", file: "agents/frontend-developer.md", tags: ["frontend"], skills: [{ name: "ponytail", status: "recommended" }] }],
    baseline_skills: [{ name: "ponytail", status: "recommended" }],
    skill_flow: { label: "persisted", branches: [], steps: [{ stage: "build", skill: "persisted-only", reason: "Use the snapshot", status: "recommended" }] },
    policy: "policies/workflow-policy.md", schema_version: 2, context_reserve_percent: 5,
    issue_policy: { mode: "local_only", externalCreation: "project_policy_required" },
  };
  const written = buildInstructions(workflow, outDir);
  const names = written.map((p) => p.split(/[\\/]/).pop());
  assert.ok(names.includes("README.md"));
  assert.ok(names.includes("policy.md"));
  const readme = readFileSync(join(outDir, "README.md"), "utf-8");
  const policy = readFileSync(join(outDir, "policy.md"), "utf-8");
  assert.ok(readme.includes("review a pull request"));
  assert.ok(readme.includes("persisted-only"));
  assert.ok(readme.includes("## Next step"));
  assert.ok(readme.includes("current host"));
  assert.ok(!/codex|claude/i.test(readme));
  const userProfileRoot = ["C:", "Users"].join("\\");
  assert.ok(!readme.includes(userProfileRoot));
  assert.ok(readme.includes("Definition of Done"));
  assert.ok(readme.includes("agents/frontend-developer.md"));
  assert.match(readme, /Keep 5% of the model context available for handoff/);
  assert.match(readme, /## Focused output/);
  assert.match(readme, /Keep lists to five relevant items or fewer/);
  assert.match(readme, /uses: \["playbook"\]/);
  assert.match(policy, /The user's task defines what the workflow delivers/);
  assert.match(policy, /they do not add deliverables/);
  assert.match(policy, /the authoritative requirement source, the exact registry model and intended capability, and the approved provider abstraction or contract/);
  assert.match(policy, /when a model- or provider-specific skill or contract exists, read and cite it before implementation, review, testing, or a merge-readiness claim/);
  assert.match(policy, /exact registry identifier, capability or type .* approved provider route, request payload, expected response or callback shape, pricing, and lifecycle status/);
  assert.match(policy, /Never infer those facts from name similarity, legacy code, an old issue, or a fallback map/);
  assert.match(policy, /If authoritative sources conflict, stop and report the conflict instead of changing code or calling a PR ready/);
  assert.match(policy, /Proof is valid only when it exercises the referenced contract/);
  assert.match(policy, /A different model, direct-provider path, request payload, response expectation, or inferred requirement is out of scope/);
  assert.match(policy, /Do not infer readiness from GitHub's mechanical mergeable or ready status, a green build, or a prior review/);
  assert.match(policy, /After every final push, refresh the exact PR head/);
  assert.match(policy, /reconcile every P0, P1, and P2 finding/);
  assert.match(policy, /Re-fetch that exact head's reviews, unresolved threads, checks, mergeability, and diff/);
  assert.match(policy, /Identify every waived or dismissed finding and obtain explicit user approval/);  assert.match(readme, /## Issue governance/);
  assert.match(policy, /When the workflow includes a prose-editing capability/);
  assert.match(policy, /Do not rewrite code, machine-readable data, commands, logs, citations/);
  assert.match(readme, /Findings stay local by default/);
  assert.deepEqual(resolveGraph(outDir, { allowedRoots: [outDir] }).map((unit) => unit.meta.kind), ["skill", "playbook", "workflow"]);
  const detail = readFileSync(join(outDir, "agents", "frontend-developer.md"), "utf-8");
  assert.ok(detail.includes("# frontend-developer"));
  assert.ok(detail.includes("## Skills"));
  assert.ok(detail.includes("global skill"), "agent should be told it can use global skill discovery");
});

test("skill steps render progressive-disclosure pointers", () => {
  const outDir = mkdtempSync(join(tmpdir(), "dirf-instr-disclose-"));
  const workflow = {
    name: "disclose", task: "write tests", playbook: "tdd",
    workflow: { phases: ["a"], output: "tests", validation: "v", recovery: "r" },
    agents: [], baseline_skills: [], questions: [],
    skill_flow: { label: "persisted", branches: [], steps: [{ stage: "build", skill: "tdd", reason: "Drive one behavior", status: "installed", disclosures: ["tests.md", "mocking.md"] }] },
    policy: "policies/workflow-policy.md", schema_version: 2, context_reserve_percent: 5,
  };
  buildInstructions(workflow, outDir);
  const readme = readFileSync(join(outDir, "README.md"), "utf-8");
  assert.match(readme, /Reference files \(in the skill's folder — load on demand\): tests\.md, mocking\.md/);
});

test("focused output can be disabled without changing task instructions", () => {
  const workflow = {
    name: "demo", task: "write a story", playbook: "content",
    workflow: { phases: ["write"], output: "a story", validation: "review", recovery: "revise" },
    agents: [], baseline_skills: [], skill_flow: { label: "write", steps: [] },
    schema_version: 5, focused_output: false,
  };
  const outDir = mkdtempSync(join(tmpdir(), "dirf-unfocused-"));
  buildInstructions(workflow, outDir);
  const readme = readFileSync(join(outDir, "README.md"), "utf8");
  assert.doesNotMatch(readme, /## Focused output/);
  assert.doesNotMatch(kickoffPrompt(workflow), /For status updates, validation summaries, and handoffs/);
  assert.doesNotMatch(buildHtml(workflow), /Focused output/);
  assert.match(readme, /write a story/);
});

test("buildInstructions includes lifecycle guidance when persisted", () => {
  const outDir = mkdtempSync(join(tmpdir(), "dirf-lifecycle-"));
  const workflow = {
    name: "demo", task: "build", playbook: "fullstack-feature",
    workflow: { phases: ["build"], output: "done", validation: "test", recovery: "stop" },
    agents: [], baseline_skills: [], skill_flow: { label: "build", steps: [] }, schema_version: 4,
    lifecycle: { clarify: "Clarify first", review: "Review independently" },
  };
  buildInstructions(workflow, outDir);
  const readme = readFileSync(join(outDir, "README.md"), "utf8");
  assert.match(readme, /## Idea to ship/);
  assert.match(readme, /Review independently/);
});

test("compaction policy renders from config and falls back to defaults", () => {
  const outDir = mkdtempSync(join(tmpdir(), "dirf-compaction-"));

  // Configured policy surfaces in both renders.
  const configured = {
    name: "demo", task: "build", playbook: "fullstack-feature",
    workflow: { phases: ["build"], output: "done", validation: "test", recovery: "stop" },
    agents: [], baseline_skills: [], skill_flow: { label: "build", steps: [] }, schema_version: 5,
    compaction: { method: "verbatim-line", preserve_recent: 3, compression_ratio: 0.4, protected: ["objective", "open-decisions"] },
  };
  buildInstructions(configured, outDir);
  const readme = readFileSync(join(outDir, "README.md"), "utf-8");
  assert.match(readme, /## Compaction policy/);
  assert.match(readme, /40% of the lines/);
  assert.match(readme, /preserving the 3 most recent turns/);
  assert.match(readme, /`objective`, `open-decisions`/);
  assert.match(readme, /byte-identical/);

  const html = buildHtml(configured);
  assert.match(html, /Compaction policy/);
  assert.match(html, /40% of the lines/);
  assert.match(html, /<code>open-decisions<\/code>/);

  // Absent compaction -> defaults applied (no crash, default ratio/recent/protected).
  const bare = { ...configured, compaction: undefined };
  buildInstructions(bare, mkdtempSync(join(tmpdir(), "dirf-comp-default-")));
});

test("per-step output contract renders as a checkpoint", () => {
  const outDir = mkdtempSync(join(tmpdir(), "dirf-output-"));
  const workflow = {
    name: "demo", task: "build", playbook: "fullstack-feature",
    workflow: { phases: ["build"], output: "done", validation: "test", recovery: "stop" },
    agents: [], baseline_skills: [], schema_version: 5,
    skill_flow: {
      label: "build",
      steps: [
        { stage: "build", skill: "tdd", reason: "Drive behavior", status: "recommended", output: "a green test with the touched surface building clean" },
        { stage: "review", skill: "code-review", reason: "Review independently", status: "recommended" },
      ],
    },
  };
  buildInstructions(workflow, outDir);
  const readme = readFileSync(join(outDir, "README.md"), "utf-8");
  assert.match(readme, /\*\*Done at this step when:\*\* a green test/);
  // A step without output renders no checkpoint line.
  const reviewLine = readme.split("\n").find((l) => l.includes("`code-review`"));
  assert.ok(reviewLine, "step without output still renders");
  assert.ok(!/Done at this step when:/.test(reviewLine), "step without output has no checkpoint");

  const html = buildHtml(workflow);
  assert.match(html, /Done at this step when:/);
  assert.match(html, /a green test/);

  // Per-skill README surfaces output in its outputs frontmatter.
  const skillReadme = readFileSync(join(outDir, "skills", "01-tdd", "README.md"), "utf-8");
  assert.match(skillReadme, /outputs: \["a green test with the touched surface building clean"\]/);
});

test("rendered workflow preserves repository context and full skill instructions", () => {
  const outDir = mkdtempSync(join(tmpdir(), "dirf-context-"));
  const workflow = {
    name: "audit", task: "compare screens", playbook: "ui-ux-review",
    repository_context: ["AGENTS.md", ".gsd/STATE.md"],
    workflow: { phases: ["audit"], output: "ledger", validation: "evidence", recovery: "stop" },
    agents: [], baseline_skills: [], schema_version: 5,
    skill_flow: { label: "audit", steps: [{
      stage: "review", skill: "graphify", reason: "Map the repo", status: "installed",
      instructions: "# Graphify\n\nRun the graph query before source browsing.\n",
    }] },
  };

  buildInstructions(workflow, outDir);
  const readme = readFileSync(join(outDir, "README.md"), "utf8");
  const skillReadme = readFileSync(join(outDir, "skills", "01-graphify", "README.md"), "utf8");
  const source = readFileSync(join(outDir, "skills", "01-graphify", "SOURCE.md"), "utf8");
  assert.match(readme, /Repository context preflight/);
  assert.match(readme, /`AGENTS\.md`/);
  assert.match(skillReadme, /details: \["SOURCE\.md"\]/);
  assert.match(skillReadme, /Read \[SOURCE\.md\]/);
  assert.match(source, /Run the graph query before source browsing/);
});

test("buildHtml is self-contained and collapsible", () => {
  const workflow = {
    name: "demo", task: "build a landing page",
    workflow: { phases: ["a"], output: "a page", validation: "v", recovery: "r" },
    agents: [{ name: "frontend-developer", file: "agents/frontend-developer.md", tags: ["frontend"], skills: [{ name: "ponytail", status: "recommended" }] }],
    baseline_skills: [{ name: "ponytail", status: "recommended" }],
    skill_flow: { label: "persisted", branches: [], steps: [{ stage: "verify", skill: "persisted-only", reason: "Use the snapshot", status: "recommended" }] },
    schema_version: 2,
  };
  const html = buildHtml(workflow);
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("<style>")); // inline CSS
  assert.ok(html.includes("<details>") && html.includes("<summary>")); // collapsible
  assert.ok(html.includes("frontend-developer"));
  assert.ok(html.includes("persisted-only"));
  assert.ok(html.includes("<h2>Next step</h2>"));
  assert.ok(html.includes("current host"));
  assert.ok(!/codex|claude/i.test(html));
  assert.ok(html.includes("Definition of Done"));
  assert.ok(!html.includes("src=") && !html.includes('href="')); // no external assets
});

test("agent casting statuses surface in README, details, and kickoff prompt", () => {
  const outDir = mkdtempSync(join(tmpdir(), "dirf-cast-"));
  const workflow = {
    name: "cast", task: "t", playbook: "landing-page",
    workflow: { phases: ["a"], output: "o", validation: "v", recovery: "r" },
    agents: [
      { name: "frontend-developer", file: "agents/frontend-developer.md", tags: ["frontend"], skills: [], status: "installed", matched: "my-own-dev", matched_description: "their agent" },
      { name: "ui-designer", file: "agents/ui-designer.md", tags: ["design"], skills: [], status: "fallback" },
    ],
    baseline_skills: [],
    questions: ["No installed agents were found on this host. Use DIRF's bundled default agents for this workflow, or point DIRF at your own agents folder and re-run?"],
    skill_flow: { label: "l", branches: [], steps: [{ stage: "build", skill: "s", reason: "r", status: "recommended" }] },
    policy: "policies/workflow-policy.md", schema_version: 5,
  };
  buildInstructions(workflow, outDir);
  const readme = readFileSync(join(outDir, "README.md"), "utf-8");
  assert.ok(readme.includes("installed agent `my-own-dev`"));
  assert.ok(readme.includes("*bundled default*"));
  assert.ok(readme.includes("## Open questions (settle with the user before starting)"));
  assert.ok(readme.includes("bundled default agents for this workflow"));

  const installedDetail = readFileSync(join(outDir, "agents", "frontend-developer.md"), "utf-8");
  assert.ok(installedDetail.includes("filled by the installed agent `my-own-dev`"));
  const fallbackDetail = readFileSync(join(outDir, "agents", "ui-designer.md"), "utf-8");
  assert.ok(fallbackDetail.includes("DIRF bundled default"));

  const prompt = kickoffPrompt(workflow);
  assert.ok(prompt.includes("bundled defaults"));

  const html = buildHtml(workflow);
  assert.ok(html.includes("bundled default"));
  assert.ok(html.includes("my-own-dev"));
  assert.ok(html.includes("Open questions"));
});
