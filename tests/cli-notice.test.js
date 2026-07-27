import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.js");
const TIMEOUT = 30_000;

function run(args, env, cwd) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, ...env },
  });
}

function freshHome() {
  return mkdtempSync(join(tmpdir(), "dirf-cli-notice-"));
}

function setupProj(home, dir) {
  execFileSync("git", ["init", "-q"], { cwd: dir, timeout: TIMEOUT });
  run(["setup", dir], { DIRF_HOME: home });
  // create an attempt so `dirf notice` has a default target
  run(["build", "demo", "some task"], { DIRF_HOME: home }, dir);
}

test('"dirf notice <text>" writes an observation to the current attempt', () => {
  const home = freshHome();
  const dir = mkdtempSync(join(tmpdir(), "noticeproj-"));
  setupProj(home, dir);
  const out = run(["notice", "Sidebar has 23 text-white — not this task"], { DIRF_HOME: home }, dir);
  assert.match(out, /observation|logged|noted/i);
});

test('"dirf notice list" prints the observations back', () => {
  const home = freshHome();
  const dir = mkdtempSync(join(tmpdir(), "noticeproj2-"));
  setupProj(home, dir);
  run(["notice", "first side note"], { DIRF_HOME: home }, dir);
  run(["notice", "second side note"], { DIRF_HOME: home }, dir);
  const out = run(["notice", "list"], { DIRF_HOME: home }, dir);
  assert.match(out, /first side note/);
  assert.match(out, /second side note/);
});

test('"dirf notice <text> --attempt <id>" targets a specific attempt', () => {
  const home = freshHome();
  const dir = mkdtempSync(join(tmpdir(), "noticeproj3-"));
  setupProj(home, dir);
  // Find the attempt id from `dirf state list-attempts`.
  const listOut = run(["state", "list-attempts"], { DIRF_HOME: home }, dir);
  const idMatch = listOut.match(/(\d{8}T\d+Z-demo)/);
  assert.ok(idMatch, "expected a demo attempt id in list-attempts output");
  const attemptId = idMatch[1];
  run(["notice", "targeted note", "--attempt", attemptId], { DIRF_HOME: home }, dir);
  const out = run(["notice", "list", "--attempt", attemptId], { DIRF_HOME: home }, dir);
  assert.match(out, /targeted note/);
});

test('"dirf notice <text> --project" writes to the project-level file', () => {
  const home = freshHome();
  const dir = mkdtempSync(join(tmpdir(), "noticeproj4-"));
  setupProj(home, dir);
  run(["notice", "project-wide note", "--project"], { DIRF_HOME: home }, dir);
  const out = run(["notice", "list", "--project"], { DIRF_HOME: home }, dir);
  assert.match(out, /project-wide note/);
});

test('"dirf notice promote <n>" lifts entry N to the project level', () => {
  const home = freshHome();
  const dir = mkdtempSync(join(tmpdir(), "noticeproj5-"));
  setupProj(home, dir);
  run(["notice", "ephemeral one"], { DIRF_HOME: home }, dir);
  run(["notice", " keeper — this matters "], { DIRF_HOME: home }, dir);
  // Promote entry 2.
  const promoteOut = run(["notice", "promote", "2"], { DIRF_HOME: home }, dir);
  assert.match(promoteOut, /promoted|promote/i);
  // Project list now contains the promoted text.
  const projectOut = run(["notice", "list", "--project"], { DIRF_HOME: home }, dir);
  assert.match(projectOut, /this matters/);
});

test('"dirf notice" with no attempt and no --project errors clearly', () => {
  const home = freshHome();
  const dir = mkdtempSync(join(tmpdir(), "noticeproj6-"));
  // setup but do NOT build an attempt
  execFileSync("git", ["init", "-q"], { cwd: dir, timeout: TIMEOUT });
  run(["setup", dir], { DIRF_HOME: home });
  let err;
  try {
    run(["notice", "nowhere to put this"], { DIRF_HOME: home }, dir);
  } catch (e) {
    err = e;
  }
  assert.ok(err, "expected nonzero exit when no attempt exists");
  assert.match(err.stderr || err.stdout || "", /no attempt|build first/i);
});
