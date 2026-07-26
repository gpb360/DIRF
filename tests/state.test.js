import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProjects, storeHome } from "../src/state.js";
import { deriveSlug, normalizeIdentityKey, identityKeyForPath } from "../src/state.js";
import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";

const TIMEOUT = 30_000;

function gitInit(cwd) {
  execFileSync("git", ["init", "-q"], { cwd, timeout: TIMEOUT, windowsHide: true });
}

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), "dirf-state-"));
  process.env.DIRF_HOME = home;
  return home;
}

test("storeHome honors DIRF_HOME override", () => {
  const home = freshHome();
  assert.equal(storeHome(), home);
});

test("listProjects returns empty array when no registry exists", () => {
  freshHome();
  assert.deepEqual(listProjects(), []);
});

test("listProjects reads an existing registry without mutating it", async () => {
  const home = freshHome();
  const { writeFileSync } = await import("node:fs");
  const reg = { schema_version: 1, projects: {} };
  writeFileSync(join(home, "projects.json"), JSON.stringify(reg));
  assert.deepEqual(listProjects(), []);
});

test("normalizeIdentityKey: forward + back slashes, trailing slash, case all collapse", () => {
  const a = normalizeIdentityKey("E:\\\\s7s-projects\\\\Storytellers\\\\.git");
  const b = normalizeIdentityKey("e:/s7s-projects/storytellers/.git/");
  assert.equal(a, b, "Windows case + separator variants must produce the same key");
});

test("normalizeIdentityKey resolves symlinks", () => {
  const real = mkdtempSync(join(tmpdir(), "real-repo-"));
  const link = join(tmpdir(), `link-${Date.now()}`);
  try { symlinkSync(real, link, "junction"); } catch { /* junction may need admin; skip if unavailable */ }
  if (existsSync(link)) {
    assert.equal(normalizeIdentityKey(link), normalizeIdentityKey(real));
  }
});

test("identityKeyForPath: git common-dir for main tree", () => {
  const repo = mkdtempSync(join(tmpdir(), "myrepo-"));
  gitInit(repo);
  const key = identityKeyForPath(repo);
  // main tree: common-dir resolves to <repo>/.git (normalized)
  assert.equal(key, normalizeIdentityKey(join(repo, ".git")));
});

test("deriveSlug: basename + 8-hex, stable across worktrees", () => {
  const main = mkdtempSync(join(tmpdir(), "storytellers-"));
  gitInit(main);
  writeFileSync(join(main, "file.txt"), "x");
  execFileSync("git", ["-C", main, "add", "."], { timeout: TIMEOUT, windowsHide: true });
  execFileSync("git", ["-C", main, "commit", "-q", "-m", "init"], { timeout: TIMEOUT, windowsHide: true, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });

  const wt = join(tmpdir(), `wt-${Date.now()}`);
  execFileSync("git", ["-C", main, "worktree", "add", "-q", wt], { timeout: TIMEOUT, windowsHide: true });

  const slugMain = deriveSlug(main);
  const slugWt = deriveSlug(wt);
  assert.equal(slugMain, slugWt, "main tree and worktree must produce the SAME slug");
  // mkdtemp appends a random suffix to the basename; the byte-stable tail is the 8-hex hash.
  assert.match(slugMain, /^storytellers-[a-z0-9]+-[0-9a-f]{8}$/, "format: basename-<8 hex>");
});

test("deriveSlug: non-git folder uses normalized path", () => {
  const dir = mkdtempSync(join(tmpdir(), "plainproj-"));
  const slug = deriveSlug(dir);
  // mkdtemp appends a random suffix to the basename; the byte-stable tail is the 8-hex hash.
  assert.match(slug, /^plainproj-[a-z0-9]+-[0-9a-f]{8}$/);
});

test("deriveSlug: two distinct repos produce distinct slugs", () => {
  const a = mkdtempSync(join(tmpdir(), "projX-"));
  const b = mkdtempSync(join(tmpdir(), "projY-"));
  gitInit(a); gitInit(b);
  assert.notEqual(deriveSlug(a), deriveSlug(b));
});
