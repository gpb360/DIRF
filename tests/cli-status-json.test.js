import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.js");
const TIMEOUT = 30_000;

function run(args, env, cwd) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, ...env },
  });
}

function setupProj(home, dir) {
  execFileSync("git", ["init", "-q"], { cwd: dir, timeout: TIMEOUT });
  execFileSync("git", ["commit", "--allow-empty", "-q", "-m", "init"], { cwd: dir, timeout: TIMEOUT });
  run(["setup", dir], { DIRF_HOME: home });
  run(["build", "demo", "some task"], { DIRF_HOME: home }, dir);
}

test("status --json returns the machine-readable projection on a configured project", () => {
  const home = mkdtempSync(join(tmpdir(), "dirf-cli-status-"));
  const dir = mkdtempSync(join(tmpdir(), "statusproj-"));
  setupProj(home, dir);
  const status = JSON.parse(run(["status", "--json"], { DIRF_HOME: home }, dir));
  assert.equal(status.configured, true);
  assert.equal(status.attempts, 1);
  assert.equal(typeof status.latest_attempt, "string");
  assert.equal(status.most_recently_updated_attempt, status.latest_attempt);
  assert.equal(status.repository.is_git, true);
  assert.equal(typeof status.repository.branch, "string");
  assert.equal(typeof status.repository.changed_paths, "number");
  assert.equal(status.repository.ahead, null);
  assert.equal(status.repository.behind, null);
});

test("status --json on an unconfigured project reports configured: false", () => {
  const home = mkdtempSync(join(tmpdir(), "dirf-cli-status-unc-"));
  const dir = mkdtempSync(join(tmpdir(), "statusprojunc-"));
  execFileSync("git", ["init", "-q"], { cwd: dir, timeout: TIMEOUT });
  const status = JSON.parse(run(["status", "--json"], { DIRF_HOME: home }, dir));
  assert.equal(status.configured, false);
  assert.equal(status.attempts, 0);
  assert.equal(status.latest_attempt, null);
  assert.equal(status.most_recently_updated_attempt, null);
  assert.equal(status.repository.is_git, true);
});

test("status --json on a detached HEAD reports is_git true with branch null", () => {
  const home = mkdtempSync(join(tmpdir(), "dirf-cli-status-det-"));
  const dir = mkdtempSync(join(tmpdir(), "statusprojdet-"));
  setupProj(home, dir);
  execFileSync("git", ["checkout", "-q", "--detach"], { cwd: dir, timeout: TIMEOUT });
  const status = JSON.parse(run(["status", "--json"], { DIRF_HOME: home }, dir));
  assert.equal(status.repository.is_git, true);
  assert.equal(status.repository.branch, null);
  assert.equal(typeof status.repository.changed_paths, "number");
});
