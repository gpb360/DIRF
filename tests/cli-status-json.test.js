import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
  execFileSync("git", ["config", "user.name", "DIRF Test"], { cwd: dir, timeout: TIMEOUT });
  execFileSync("git", ["config", "user.email", "dirf@example.invalid"], { cwd: dir, timeout: TIMEOUT });
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

test("status --json uses legacy creation times while preserving newer update precedence", () => {
  for (const updatedAt of [undefined, "2026-01-03T00:00:00.000Z"]) {
    const home = mkdtempSync(join(tmpdir(), "dirf-cli-status-legacy-"));
    const dir = mkdtempSync(join(tmpdir(), "statusprojlegacy-"));
    const olderId = "20260101T000000000Z-old";
    const newerId = "20260102T000000000Z-new";
    for (const [id, createdAt, updated] of [
      [olderId, "2026-01-01T00:00:00.000Z", updatedAt],
      [newerId, "2026-01-02T00:00:00.000Z", undefined],
    ]) {
      const folder = join(dir, ".dirf", "attempts", id);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "attempt.json"), JSON.stringify({
        schema_version: 1, id, name: id, relativePath: `.dirf/attempts/${id}`,
        created_at: createdAt, ...(updated ? { updated_at: updated } : {}),
      }));
    }
    run(["setup", dir], { DIRF_HOME: home });
    const status = JSON.parse(run(["status", "--json"], { DIRF_HOME: home }, dir));
    assert.equal(status.configured, true);
    assert.equal(status.attempts, 2);
    assert.equal(status.latest_attempt, newerId);
    assert.equal(status.most_recently_updated_attempt, updatedAt ? olderId : newerId);
  }
});

test("status reports an unavailable working tree inspection when Git rejects the index", () => {
  const home = mkdtempSync(join(tmpdir(), "dirf-cli-status-index-"));
  const dir = mkdtempSync(join(tmpdir(), "statusprojindex-"));
  execFileSync("git", ["init", "-q"], { cwd: dir, timeout: TIMEOUT });
  const clean = JSON.parse(run(["status", "--json"], { DIRF_HOME: home }, dir));
  assert.equal(clean.repository.changed_paths, 0);
  writeFileSync(join(dir, ".git", "index"), "truncated");
  const gitStatus = spawnSync("git", ["status", "--porcelain"], {
    cwd: dir, encoding: "utf8", timeout: TIMEOUT,
  });
  assert.equal(gitStatus.status, 128);
  assert.match(gitStatus.stderr, /index file smaller than expected/);
  const result = spawnSync(process.execPath, [CLI, "status", "--json"], {
    cwd: dir, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, DIRF_HOME: home },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const status = JSON.parse(result.stdout);
  assert.equal(status.repository.is_git, true);
  assert.equal(status.repository.changed_paths, null);
  const text = run(["status"], { DIRF_HOME: home }, dir);
  assert.match(text, /working tree status unavailable/);
  assert.doesNotMatch(text, /\(clean\)/);
});
