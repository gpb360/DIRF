import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
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
  return mkdtempSync(join(tmpdir(), "dirf-plain-"));
}

function setupProj(home, dir) {
  execFileSync("git", ["init", "-q"], { cwd: dir, timeout: TIMEOUT });
  run(["setup", dir], { DIRF_HOME: home });
}

// Each plain-English alias must produce the SAME output as its canonical command.
// That's the contract: aliases are sugar, not a parallel surface.

test('"where am i" matches "state which"', () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "plainwhich-"));
  setupProj(home, main);
  const plain = run(["where", "am", "i"], { DIRF_HOME: home }, main).trim();
  const canon = run(["state", "which"], { DIRF_HOME: home }, main).trim();
  assert.equal(plain, canon);
  assert.match(plain, /plainwhich-[a-z0-9]+-[0-9a-f]{8}/);
});

test('"show me the projects" matches "state list"', () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "plainlist-"));
  setupProj(home, main);
  const plain = run(["show", "me", "the", "projects"], { DIRF_HOME: home });
  const canon = run(["state", "list"], { DIRF_HOME: home });
  assert.equal(plain, canon);
});

test('"show me the handoff" matches "state read-handoff"', () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "plainhandoff-"));
  setupProj(home, main);
  const md = "# plain handoff\n";
  const src = join(main, "h.md");
  writeFileSync(src, md);
  run(["state", "write-handoff", "--file", src], { DIRF_HOME: home }, main);
  const plain = run(["show", "me", "the", "handoff"], { DIRF_HOME: home }, main);
  const canon = run(["state", "read-handoff"], { DIRF_HOME: home }, main);
  assert.equal(plain, canon);
  assert.equal(plain, md);
});

test('"show me the attempts" matches "state list-attempts"', () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "plainattempts-"));
  setupProj(home, main);
  const plain = run(["show", "me", "the", "attempts"], { DIRF_HOME: home }, main);
  const canon = run(["state", "list-attempts"], { DIRF_HOME: home }, main);
  assert.equal(plain, canon);
});

test('"start work on <task>" builds an attempt for the task', () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "plainstart-"));
  setupProj(home, main);
  // Plain-English form: auto-generates a name from the task.
  const out = run(["start", "work", "on", "fix the checkout timeout"], { DIRF_HOME: home }, main);
  assert.match(out, /Attempt saved:/);
  // The attempt must exist in the store for this project, and its task must match.
  const listed = run(["state", "list-attempts"], { DIRF_HOME: home }, main);
  assert.match(listed, /fix-the-checkout-timeout|checkout/);
});

test('"save the handoff --file F" matches "state write-handoff --file F"', () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "plainsave-"));
  setupProj(home, main);
  const md = "# saved via plain english\n";
  const src = join(main, "h.md");
  writeFileSync(src, md);
  run(["save", "the", "handoff", "--file", src], { DIRF_HOME: home }, main);
  const readBack = run(["state", "read-handoff"], { DIRF_HOME: home }, main);
  assert.equal(readBack, md);
});

test('"what can i do" prints the help', () => {
  const home = freshHome();
  const out = run(["what", "can", "i", "do"], { DIRF_HOME: home });
  assert.match(out, /Usage:/);
  assert.match(out, /start work on/i);
});

test('unknown plain-english still falls through to the normal command handling', () => {
  // A bogus canonical command must still error as before, not get swallowed.
  const home = freshHome();
  let err;
  try {
    run(["totally-not-a-command"], { DIRF_HOME: home });
  } catch (e) {
    err = e;
  }
  assert.ok(err, "unknown command must exit nonzero");
  assert.match(err.stderr || err.stdout || "", /unknown command|Usage:/i);
});
