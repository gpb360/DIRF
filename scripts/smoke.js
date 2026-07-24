#!/usr/bin/env node
// Full CLI integration check.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "src", "cli.js");
const TARGET = mkdtempSync(join(tmpdir(), "dirf-smoke-"));
// Point home at an empty temp dir so whatever agents/skills happen to be
// installed on the dev machine can't leak into the assertions.
const FAKE_HOME = mkdtempSync(join(tmpdir(), "dirf-smoke-home-"));
const ENV = { ...process.env, HOME: FAKE_HOME, USERPROFILE: FAKE_HOME };
const TIMEOUT_MS = 30_000;

function run(args, expectFail = false) {
  const res = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: "utf-8", timeout: TIMEOUT_MS, env: ENV });
  const failed = res.status !== 0;
  if (expectFail && !failed) throw new Error(`expected failure but succeeded: ${args.join(" ")}\n${res.stdout}`);
  if (!expectFail && failed) throw new Error(`expected success but failed: ${args.join(" ")}\n${res.error?.message || res.stderr || res.stdout}`);
  return `${res.stdout}${res.stderr}`;
}

function assertContains(output, needle) {
  if (!output.includes(needle)) throw new Error(`expected ${JSON.stringify(needle)} in output:\n${output}`);
}

try {
  const unit = spawnSync(process.execPath, ["--test"], { cwd: join(ROOT, "tests"), encoding: "utf-8", timeout: TIMEOUT_MS });
  if (unit.status !== 0) throw new Error(`unit tests failed\n${unit.error?.message || unit.stderr || unit.stdout}`);
  assertContains(unit.stdout, "# fail 0");

  assertContains(run(["validate"]), "Validation passed");
  assertContains(run(["skills", "scan"]), "Discovered");
  const unconfigured = run(["build", "smoke", "build a landing page", "--path", TARGET], true);
  assertContains(unconfigured, "dirf setup");
  if (/fatal:|\n\s+at /.test(unconfigured)) throw new Error(`unconfigured build did not fail cleanly:\n${unconfigured}`);

  const setup = run(["setup", TARGET, "--reserve-percent", "5"]);
  assertContains(setup, "DIRF configured:");
  assertContains(setup, "Capability gaps:");
  assertContains(run(["setup", TARGET]), "Already configured; no files changed.");
  assertContains(readFileSync(join(TARGET, ".gitignore"), "utf8"), ".dirf/attempts/");

  let out = run(["build", "smoke", "build a landing page", "--path", TARGET]);
  assertContains(out, "Attempt saved:");
  assertContains(out, "Spec kit rendered:");
  assertContains(run(["build", "quiet", "build a landing page", "--path", TARGET, "--no-focused-output"]), "Attempt saved:");
  assertContains(run(["create", "smoke", "build a landing page", "--path", TARGET]), "Attempt saved:");

  const attemptsRoot = join(TARGET, ".dirf", "attempts");
  const smokeAttempts = readdirSync(attemptsRoot).filter((name) => JSON.parse(readFileSync(join(attemptsRoot, name, "attempt.json"), "utf8")).name === "smoke");
  if (smokeAttempts.length !== 2) throw new Error(`expected two isolated smoke attempts, got ${smokeAttempts.length}`);
  const attemptId = smokeAttempts.find((name) => existsSync(join(attemptsRoot, name, "README.md")));
  const attempt = join(attemptsRoot, attemptId);
  const wfJson = join(attempt, "workflow.json");
  const readme = join(attempt, "README.md");
  const html = join(attempt, "instructions.html");
  const detail = join(attempt, "agents", "frontend-developer.md");
  const handoff = join(attempt, "HANDOFF.md");
  for (const path of [wfJson, readme, html, detail, handoff]) if (!existsSync(path)) throw new Error(`missing expected output: ${path}`);

  const readmeText = readFileSync(readme, "utf8");
  for (const text of ["Definition of Done", "Agent roster", "Capabilities", "Idea to ship"]) assertContains(readmeText, text);
  if (/codex|claude/i.test(readmeText)) throw new Error("host-specific agent leaked into operating instructions");
  assertContains(readmeText, "bundled default");
  assertContains(readmeText, "No installed agents were found on this host");
  const handoffText = readFileSync(handoff, "utf8");
  assertContains(handoffText, "Keep lists to five relevant items or fewer.");
  assertContains(handoffText, "State failures plainly and name the affected step.");

  const snapshotText = readFileSync(wfJson, "utf8");
  const snapshot = JSON.parse(snapshotText);
  if (snapshot.schema_version !== 5) throw new Error("attempt did not use schema version 5");
  if (snapshot.focused_output !== true) throw new Error("attempt did not enable focused output by default");
  if (snapshot.context_reserve_percent !== 5) throw new Error("attempt did not persist the context reserve");
  if ("path" in snapshot || snapshotText.includes(TARGET)) throw new Error("target path leaked into portable snapshot");
  assertContains(run(["migrate", "smoke", "--path", TARGET]), "portable schema version 5");
  assertContains(run(["validate", attempt]), "Folder validation passed");
  assertContains(run(["graph", attempt]), "[workflow] smoke");
  const runOutput = run(["run", attempt]);
  assertContains(runOutput, "Focused output:");
  assertContains(runOutput, "Keep lists to five relevant items or fewer.");
  assertContains(runOutput, "State failures plainly and name the affected step.");
  if (run(["run", attempt, "--no-focused-output"]).includes("Focused output:")) throw new Error("run ignored --no-focused-output");

  const quietAttemptId = readdirSync(attemptsRoot).find((name) => JSON.parse(readFileSync(join(attemptsRoot, name, "attempt.json"), "utf8")).name === "quiet");
  const quietSnapshot = JSON.parse(readFileSync(join(attemptsRoot, quietAttemptId, "workflow.json"), "utf8"));
  if (quietSnapshot.focused_output !== false) throw new Error("--no-focused-output was not persisted");

  if (!readFileSync(html, "utf8").startsWith("<!doctype html>")) throw new Error("HTML missing doctype");
  assertContains(run(["render", "smoke", "--path", TARGET]), "Spec kit rendered:");
  assertContains(run(["list", "--path", TARGET]), attemptId);
  assertContains(run(["resume", attemptId, "--path", TARGET]), "## Exact next action");
  run(["render", "does-not-exist-xyz", "--path", TARGET], true);
  const invalidAttemptId = smokeAttempts.find((name) => name !== attemptId);
  writeFileSync(join(attemptsRoot, invalidAttemptId, "workflow.json"), "{");
  const migration = run(["migrate", "--path", TARGET]);
  assertContains(migration, `Failed to migrate ${invalidAttemptId}`);
  assertContains(migration, "Migrated 2 workflow snapshot(s)");

  console.log("Smoke test passed");
} finally {
  rmSync(TARGET, { recursive: true, force: true });
}
