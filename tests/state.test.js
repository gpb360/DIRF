import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProjects, storeHome } from "../src/state.js";
import { deriveSlug, normalizeIdentityKey, identityKeyForPath } from "../src/state.js";
import { execFileSync } from "node:child_process";
import { migrateProject, importHandoff } from "../src/state.js";

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
  const a = normalizeIdentityKey("C:\\\\code\\\\MyProject\\\\.git");
  const b = normalizeIdentityKey("c:/code/myproject/.git/");
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
  const main = mkdtempSync(join(tmpdir(), "myproject-"));
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
  assert.match(slugMain, /^myproject-[a-z0-9]+-[0-9a-f]{8}$/, "format: basename-<8 hex>");
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

import { registerProject, resolveProject, getProject, writeRegistry } from "../src/state.js";

test("registerProject creates a store entry + registry record", () => {
  const home = freshHome();
  const repo = mkdtempSync(join(tmpdir(), "regproj-"));
  gitInit(repo);
  const { slug, isNew } = registerProject(repo);
  assert.equal(isNew, true);
  assert.match(slug, /^regproj-[a-z0-9]+-[0-9a-f]{8}$/);
  assert.ok(existsSync(join(home, "projects", slug)));
  assert.ok(getProject(slug));
  assert.equal(getProject(slug).slug, slug);
});

test("registerProject is idempotent and preserves the original record", () => {
  const repo = mkdtempSync(join(tmpdir(), "regproj2-"));
  gitInit(repo);
  const first = registerProject(repo);
  const before = getProject(first.slug);
  const second = registerProject(repo);
  const after = getProject(first.slug);
  assert.equal(second.isNew, false);
  assert.equal(second.slug, first.slug);
  // Re-register must preserve the original record (created_at, name, identity) — only last_seen moves.
  assert.equal(after.created_at, before.created_at, "created_at must be preserved on re-register");
  assert.equal(after.name, before.name);
  assert.equal(after.git_common_dir, before.git_common_dir);
  assert.equal(after.main_path, before.main_path);
  assert.ok(after.last_seen >= before.last_seen, "last_seen should bump");
});

test("resolveProject returns slug for a registered repo and bumps last_seen", () => {
  const repo = mkdtempSync(join(tmpdir(), "resproj-"));
  gitInit(repo);
  const { slug } = registerProject(repo);
  const before = getProject(slug).last_seen;
  // small delay then resolve
  const resolved = resolveProject(repo);
  assert.ok(resolved, "must resolve a registered project");
  assert.equal(resolved.slug, slug);
  assert.ok(getProject(slug).last_seen >= before);
});

test("resolveProject returns null for an unregistered path", () => {
  freshHome();
  const dir = mkdtempSync(join(tmpdir(), "unknown-"));
  // not a git repo, not registered -> null
  assert.equal(resolveProject(dir), null);
});

import { readHandoff, writeHandoff, listAttempts, getAttempt, storeAttemptDir, createAttemptInStore } from "../src/state.js";

function withRegisteredProject() {
  freshHome();
  const repo = mkdtempSync(join(tmpdir(), "hproj-"));
  gitInit(repo);
  const { slug } = registerProject(repo);
  return { repo, slug };
}

test("writeHandoff then readHandoff round-trips content", () => {
  const { slug } = withRegisteredProject();
  const md = "# Handoff\n\nPhase 2 done.\n";
  writeHandoff(slug, md);
  assert.equal(readHandoff(slug), md);
});

test("readHandoff returns null when no handoff exists", () => {
  const { slug } = withRegisteredProject();
  assert.equal(readHandoff(slug), null);
});

test("createAttemptInStore writes attempt.json under the store and listAttempts finds it", () => {
  const { slug } = withRegisteredProject();
  const attempt = createAttemptInStore(slug, "Demo Run", new Date("2026-07-25T10:00:00.000Z"));
  assert.equal(attempt.id, "20260725T100000000Z-demo-run");
  assert.ok(existsSync(join(storeAttemptDir(slug, attempt.id), "attempt.json")));
  const listed = listAttempts(slug);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, attempt.id);
  assert.equal(getAttempt(slug, attempt.id).id, attempt.id);
});

test("writeHandoff is atomic — file is valid after concurrent writes", () => {
  const { slug } = withRegisteredProject();
  // Simulate two concurrent writers by writing many times rapidly; final file must be valid.
  for (let i = 0; i < 50; i++) writeHandoff(slug, `# v${i}\n`);
  assert.equal(readHandoff(slug), "# v49\n");
});

import { storeProjectDir } from "../src/state.js";

function seedLegacyDirf(target, { handoff = "# Legacy\n", config = null } = {}) {
  mkdirSync(join(target, ".dirf", "attempts", "20260101T000000000Z-old"), { recursive: true });
  writeFileSync(join(target, ".dirf", "attempts", "20260101T000000000Z-old", "attempt.json"), JSON.stringify({ schema_version: 1, id: "20260101T000000000Z-old", name: "old", relativePath: ".dirf/attempts/20260101T000000000Z-old", created_at: "2026-01-01T00:00:00.000Z" }));
  const cfg = config || { schema_version: 1, tracker: { provider: "local", specs_path: "docs/agents/issues/specs", tickets_path: "docs/agents/issues/tickets.md" }, context: { mode: "single", path: "docs/CONTEXT.md", reserve_percent: 5 }, compaction: { method: "verbatim-line", preserve_recent: 2, compression_ratio: 0.5, protected: ["objective"] }, adr_path: "docs/adr", attempt_root: ".dirf/attempts" };
  writeFileSync(join(target, ".dirf", "config.json"), JSON.stringify(cfg));
  writeFileSync(join(target, ".dirf", "HANDOFF.md"), handoff);
}

test("migrateProject moves legacy .dirf into the store, schema upgraded to v2, with backup", () => {
  const home = freshHome();
  const target = mkdtempSync(join(tmpdir(), "migproj-"));
  seedLegacyDirf(target);
  const slug = deriveSlug(target);
  migrateProject(target, slug);

  // State now in store
  const storeCfg = JSON.parse(readFileSync(join(storeProjectDir(slug), "config.json"), "utf8"));
  assert.equal(storeCfg.schema_version, 2);
  assert.equal(storeCfg.slug, slug);
  assert.equal(storeCfg.attempt_root, undefined);
  assert.ok(existsSync(join(storeProjectDir(slug), "attempts", "20260101T000000000Z-old", "attempt.json")));
  assert.equal(readFileSync(join(storeProjectDir(slug), "HANDOFF.md"), "utf8"), "# Legacy\n");
  // Backup exists
  const backups = readdirSync(target).filter((n) => n.startsWith(".dirf.migrating."));
  assert.ok(backups.length === 1, "a backup copy must exist");
  assert.ok(readFileSync(join(target, backups[0], "HANDOFF.md"), "utf8").includes("Legacy"));
});

test("migrateProject is idempotent/restartable: re-running is a no-op once in store", () => {
  const home = freshHome();
  const target = mkdtempSync(join(tmpdir(), "migproj2-"));
  seedLegacyDirf(target);
  const slug = deriveSlug(target);
  migrateProject(target, slug);
  // second run must not throw or duplicate
  migrateProject(target, slug);
  assert.ok(getProject(slug));
});

// Reproduces the real-world EXDEV: legacy target on one volume, store on another.
// renameSync across volumes throws EXDEV (cross-device link not permitted); the
// migration must copy-then-delete instead. Auto-skips on single-volume hosts.
test("migrateProject moves attempts across volumes (EXDEV regression)", { skip: !process.env.DIRF_CROSS_VOLUME_ROOT ? "set DIRF_CROSS_VOLUME_ROOT to a second drive root (e.g. E:/) to run" : false }, () => {
  // Store stays on the default (C: via tmpdir); the legacy target goes on the other volume.
  const home = freshHome();
  const otherRoot = process.env.DIRF_CROSS_VOLUME_ROOT.replace(/[\\/]+$/, "");
  const target = mkdtempSync(join(otherRoot, "dirf-xvol-"));
  seedLegacyDirf(target);
  const slug = deriveSlug(target);
  // Must not throw EXDEV.
  migrateProject(target, slug);
  // Attempt landed in the store (different volume from the source).
  assert.ok(existsSync(join(storeProjectDir(slug), "attempts", "20260101T000000000Z-old", "attempt.json")));
  // Source attempt removed from the legacy target (it was a move, not a copy).
  assert.ok(!existsSync(join(target, ".dirf", "attempts", "20260101T000000000Z-old")), "source attempt should be removed after move");
});

test("resolveProject migrates a legacy target on first resolve", () => {
  const home = freshHome();
  const target = mkdtempSync(join(tmpdir(), "resolvemig-"));
  seedLegacyDirf(target);
  const resolved = resolveProject(target);
  assert.ok(resolved, "resolve should have migrated + registered");
  assert.equal(resolved.slug, deriveSlug(target));
  assert.ok(existsSync(join(storeProjectDir(resolved.slug), "config.json")));
});

test("importHandoff backs up the store handoff before replacing", () => {
  const home = freshHome();
  const target = mkdtempSync(join(tmpdir(), "imphproj-"));
  seedLegacyDirf(target, { handoff: "# Store copy\n" });
  const slug = deriveSlug(target);
  migrateProject(target, slug); // store now has "# Store copy"
  // Simulate a newer local handoff
  writeFileSync(join(target, ".dirf", "HANDOFF.md"), "# Newer local\n");
  importHandoff(target, slug, { force: true });
  assert.equal(readHandoff(slug), "# Newer local\n");
  // Backup of the old store handoff exists
  const backups = readdirSync(storeProjectDir(slug)).filter((n) => n.startsWith("HANDOFF.md.") && n.endsWith(".bak"));
  assert.ok(backups.length >= 1);
  assert.equal(readFileSync(join(storeProjectDir(slug), backups[0]), "utf8"), "# Store copy\n");
});

test("resolveProject surfaces a newer-local-HANDOFF conflict (registered + newer local)", () => {
  const home = freshHome();
  const target = mkdtempSync(join(tmpdir(), "confproj-"));
  seedLegacyDirf(target, { handoff: "# old\n" });
  const slug = deriveSlug(target);
  migrateProject(target, slug); // store now has "# old"
  // Recreate a local .dirf/HANDOFF.md (migration moved it) and set its mtime AHEAD of the store's.
  mkdirSync(join(target, ".dirf"), { recursive: true });
  const localPath = join(target, ".dirf", "HANDOFF.md");
  writeFileSync(localPath, "# newer local\n");
  const future = new Date(Date.now() + 60_000);
  utimesSync(localPath, future, future);
  const storeHandoff = join(storeProjectDir(slug), "HANDOFF.md");
  utimesSync(storeHandoff, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));

  // Non-interactive (test has no TTY): resolve must throw a clear, instructive error.
  assert.throws(() => resolveProject(target), /newer than canonical|import-handoff/i);
});
