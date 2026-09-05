import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recommend, requestsReadOnlyAudit } from "../src/router.js";
import { buildFlow } from "../src/flow.js";
import { bundledSkills } from "../src/skills.js";
import { installationDiagnostics } from "../src/doctor.js";
import { registerProject, createAttemptInStore, updateAttemptLifecycle, claimAttemptCheckout,
  appendObservation, listObservations, promoteObservation } from "../src/state.js";

test("explicit audit scope selects reporting rather than repair phases", () => {
  for (const task of [
    "Review the architecture and suggest improvements. Read-only; do not fix code.",
    "Audit DIRF functionality and performance without implementation; use Wait What and Unslop.",
    "Review this PR but don't change code.",
    "Read-only security audit of authentication",
  ]) {
    const result = recommend(task, []);
    assert.equal(result.workflow.execution_mode, "read_only", task);
    assert.doesNotMatch(result.workflow.phases.join(" "), /fix|patch|implement|merge/);
    assert.match(result.workflow.output, /unresolved findings do not prevent/);
  }
  assert.equal(requestsReadOnlyAudit("Build a read-only dashboard and review its accessibility"), false);
  assert.equal(recommend("review this PR", []).playbook, "pr-review");
  assert.equal(recommend("improve performance", []).playbook, "performance-pass");
  const before = recommend("Grill me first, then do a read-only audit", []);
  assert.equal(before.continuation?.playbook, "read-only-audit");
  assert.ok(before.workflow.phases.indexOf("identify the audit target and scope") > 0);
  const after = recommend("Do a read-only audit, then grill me", []);
  assert.equal(after.playbook, "read-only-audit");
  assert.equal(after.continuation?.transition, "after-primary");
});

test("requested prose passes survive routing in user order without implicit human invocation", () => {
  const task = "Read-only audit; use wait-what and unslop";
  const selection = recommend(task, []);
  const flow = buildFlow(selection, { task }, {});
  assert.deepEqual(flow.steps.filter(s => s.stage === "prose").map(s => s.skill), ["wait-what", "unslop"]);
  assert.equal(flow.gaps.length, 0);
  const generic = buildFlow(selection, { task: "read-only audit" }, {});
  assert.ok(!generic.steps.some(s => s.skill === "wait-what"));
  const reversed = buildFlow(selection, { task: "read-only audit; use unslop then wait-what" }, {});
  assert.deepEqual(reversed.steps.filter(s => s.stage === "prose").map(s => s.skill), ["unslop", "wait-what"]);
  const excluded = buildFlow(selection, { task, allowedSkills: ["code-review"] }, {});
  assert.equal(excluded.gaps.filter(g => g.blocking).length, 2);
  const negated = buildFlow(selection, { task: "read-only audit without unslop" }, {});
  assert.ok(!negated.steps.some(s => s.skill === "unslop"));
  for (const exclusion of ["do not use wait-what or unslop", "without wait-what and unslop",
    "skip wait-what, unslop", "neither wait-what nor unslop"]) {
    const excludedList = buildFlow(selection, { task: `read-only audit; ${exclusion}` }, {});
    assert.ok(!excludedList.steps.some(s => ["wait-what", "unslop"].includes(s.skill)), exclusion);
  }
  const laterRequest = buildFlow(selection, { task: "read-only audit; skip wait-what and unslop, then use unslop" }, {});
  assert.deepEqual(laterRequest.steps.filter(s => s.stage === "prose").map(s => s.skill), ["unslop"]);
  const installed = { unslop: { ...bundledSkills().unslop, path: "/custom/unslop", provider: "project" } };
  const preferred = buildFlow(selection, { task: "read-only audit; use unslop" }, installed);
  assert.equal(preferred.steps.find(s => s.skill === "unslop").path, "/custom/unslop");
  const legacy = buildFlow(selection, { task: "read-only audit; use wait-what and unslop" }, {
    unslop: { path: "/legacy/unslop", invocation: "model", description: "Review prose" },
  });
  assert.deepEqual(legacy.steps.filter(s => s.stage === "prose").map(s => s.skill), ["wait-what", "unslop"]);
  assert.equal(legacy.steps.find(s => s.skill === "unslop").path, "/legacy/unslop");
});

test("notices use the active checkout owner even when a newer task exists", () => {
  const previous = process.env.DIRF_HOME;
  process.env.DIRF_HOME = mkdtempSync(join(tmpdir(), "dirf-notice-owner-home-"));
  try {
    const dir = mkdtempSync(join(tmpdir(), "dirf-notice-owner-repo-"));
    execFileSync("git", ["init", "-q", dir], { windowsHide: true });
    const { slug } = registerProject(dir);
    const owner = createAttemptInStore(slug, "owner", new Date("2026-09-01T00:00:00Z"));
    writeFileSync(join(owner.folder, "workflow.json"), JSON.stringify({ workflow: { phases: ["inspect"] } }));
    updateAttemptLifecycle(slug, owner.id, "start");
    claimAttemptCheckout(slug, owner.id, dir);
    const newer = createAttemptInStore(slug, "unrelated", new Date("2026-09-02T00:00:00Z"));
    appendObservation(slug, "correct owner", { checkoutPath: dir });
    assert.equal(listObservations(slug, { attemptId: newer.id }).length, 0);
    assert.equal(listObservations(slug, { checkoutPath: dir })[0].text, "correct owner");
    promoteObservation(slug, 1, { checkoutPath: dir });
    assert.equal(listObservations(slug, { project: true })[0].text, "correct owner");
    updateAttemptLifecycle(slug, owner.id, "block", { reason: "waiting" });
    for (const action of [
      () => appendObservation(slug, "no owner", { checkoutPath: dir }),
      () => listObservations(slug, { checkoutPath: dir }),
      () => promoteObservation(slug, 1, { checkoutPath: dir }),
    ]) assert.throws(action, /No unique active attempt/);
    appendObservation(slug, "explicit blocked task", { attemptId: owner.id });
    assert.equal(listObservations(slug, { attemptId: owner.id }).length, 2);
  } finally {
    if (previous === undefined) delete process.env.DIRF_HOME;
    else process.env.DIRF_HOME = previous;
  }
});

test("doctor exposes installation identity without creating a project store", () => {
  const info = installationDiagnostics();
  assert.match(info.cli.replaceAll("\\", "/"), /src\/cli\.js$/);
  assert.equal(info.version, JSON.parse(readFileSync("package.json", "utf8")).version);
  assert.match(info.revision, /^[a-f0-9]{40}$/);
  assert.equal(typeof info.dirty, "boolean");
  const json = JSON.parse(execFileSync(process.execPath, ["src/cli.js", "doctor", "--json"], { encoding: "utf8", windowsHide: true }));
  assert.equal(json.revision, info.revision);
  assert.equal(json.project_store, info.project_store);
});
