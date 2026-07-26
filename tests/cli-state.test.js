import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
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
  return mkdtempSync(join(tmpdir(), "dirf-cli-"));
}

test("dirf state list is empty for a fresh home", () => {
  const out = run(["state", "list"], { DIRF_HOME: freshHome() });
  assert.match(out, /no projects registered|^\s*$/i);
});

test("dirf state which resolves a registered project from a worktree", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "whichproj-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home });
  const wt = join(tmpdir(), `wt-${Date.now()}`);
  execFileSync("git", ["-C", main, "worktree", "add", "-q", wt], { timeout: TIMEOUT });
  const out = run(["state", "which"], { DIRF_HOME: home }, wt);
  assert.match(out, /whichproj-[a-z0-9]+-[0-9a-f]{8}/);
});

test("dirf state write-handoff --file writes the canonical handoff", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "whproj2-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home });
  const md = "# From file\n\nPhase done.\n";
  const src = join(main, "new-handoff.md");
  writeFileSync(src, md);
  run(["state", "write-handoff", "--file", src], { DIRF_HOME: home }, main);
  const out = run(["state", "read-handoff"], { DIRF_HOME: home }, main);
  assert.equal(out, md);
});

test("dirf state migrate-cleanup removes backup dirs", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "mcp-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home });
  // plant a fake backup dir
  mkdirSync(join(main, ".dirf.migrating.20260101T000000000Z"));
  writeFileSync(join(main, ".dirf.migrating.20260101T000000000Z", "x"), "x");
  run(["state", "migrate-cleanup"], { DIRF_HOME: home }, main);
  const leftovers = readdirSync(main).filter((n) => n.startsWith(".dirf.migrating."));
  assert.equal(leftovers.length, 0);
});

test("dirf state import-handoff --force promotes a local HANDOFF into the store", () => {
  const home = freshHome();
  const main = mkdtempSync(join(tmpdir(), "imph-"));
  execFileSync("git", ["init", "-q"], { cwd: main, timeout: TIMEOUT });
  run(["setup", main], { DIRF_HOME: home });
  // Plant a local .dirf/HANDOFF.md that should be promoted.
  mkdirSync(join(main, ".dirf"), { recursive: true });
  const localMd = "# Promoted from local\n\nNewer content.\n";
  writeFileSync(join(main, ".dirf", "HANDOFF.md"), localMd);
  // Promote via the CLI with --force (skips the prompt).
  run(["state", "import-handoff", "--force"], { DIRF_HOME: home }, main);
  // The canonical store handoff now equals the promoted local content.
  const readBack = run(["state", "read-handoff"], { DIRF_HOME: home }, main);
  assert.equal(readBack, localMd);
});
