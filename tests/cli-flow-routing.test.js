import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Regression for the flow-vs-create routing divergence.
// `dirf flow` (no --path) called assembleTaskRouting(task, null) while
// `dirf create`/`build` called assembleTaskRouting(task, projectRoot(args.path)).
// collectRoutingFacts(null) returns []; collectRoutingFacts(root) returns
// git branch + changed files. With real repo facts the router can pick a
// different playbook than with empty facts — so the same task routed
// differently between flow and create. The fix: cmdFlow resolves cwd via
// projectRoot(args.path) like every other command.
//
// This test seeds a changed file (so collectRoutingFacts(root) is non-empty)
// and asserts flow-no-path agrees with flow---path. It does NOT assert which
// playbook is chosen — only agreement — so it's robust to router changes.

const CLI = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src", "cli.js");
const TIMEOUT = 30_000;

function run(args, env, cwd) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, ...env },
  });
}

function extractPlaybook(out) {
  const m = out.match(/^Playbook:\s*(\S+)/m);
  return m ? m[1] : null;
}

test("dirf flow with no --path agrees with dirf flow --path (cwd facts are used)", () => {
  const home = mkdtempSync(join(tmpdir(), "dirf-flow-agree-"));
  process.env.DIRF_HOME = home;
  const target = mkdtempSync(join(tmpdir(), "flowagree-"));
  execFileSync("git", ["init", "-q"], { cwd: target, timeout: TIMEOUT });
  run(["setup", target], { DIRF_HOME: home });
  // Seed an uncommitted change so collectRoutingFacts(root) returns non-empty
  // facts (a "changed: dirty.txt" line). collectRoutingFacts(null) returns [].
  writeFileSync(join(target, "dirty.txt"), "uncommitted change to shift the facts\n");

  const task = "Add a footer action rail to a React component";
  const noPath = run(["flow", task], { DIRF_HOME: home }, target);
  const withPath = run(["flow", task, "--path", target], { DIRF_HOME: home });

  const pbNoPath = extractPlaybook(noPath);
  const pbWithPath = extractPlaybook(withPath);
  assert.ok(pbNoPath && pbWithPath, "both flow calls must print a Playbook line");
  assert.equal(pbNoPath, pbWithPath,
    `flow diverged: no-path routed to '${pbNoPath}', --path to '${pbWithPath}'. ` +
    `cmdFlow must resolve cwd the same way create/build do (projectRoot(args.path)), not pass null.`);
});
