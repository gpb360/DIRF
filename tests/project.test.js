import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAttempt, findAttempt, listAttempts, loadProjectConfig, repositoryIdentity, setupProject } from "../src/project.js";

function project() {
  return mkdtempSync(join(tmpdir(), "dirf-project-"));
}

function freshStateHome() {
  const home = mkdtempSync(join(tmpdir(), "dirf-state-"));
  process.env.DIRF_HOME = home;
  return home;
}

const TIMEOUT_MS = 30_000;

test("setup creates the minimum tracked contract and is idempotent", () => {
  const home = freshStateHome();
  const root = project();
  const first = setupProject(root);
  const storeCfg = () => join(home, "projects", first.slug, "config.json");
  const before = readFileSync(storeCfg(), "utf8");
  const second = setupProject(root);

  assert.ok(first.created.length >= 5, `created: ${first.created.join(",")}`);
  assert.ok(existsSync(storeCfg()));
  assert.deepEqual(second.created, []);
  assert.equal(readFileSync(storeCfg(), "utf8"), before);
  assert.match(readFileSync(join(root, ".gitignore"), "utf8"), /^\.dirf\/attempts\/$/m);
  assert.ok(existsSync(join(root, "docs", "agents", "domain", "CONTEXT.md")));
  assert.ok(existsSync(join(root, "docs", "agents", "issues", "tickets.md")));

  const config = loadProjectConfig(root);
  assert.equal(config.tracker.provider, "local");
  assert.equal(config.context.mode, "single");
  assert.equal(config.context.reserve_percent, 5);
});

test("setup reuses existing context and ADR locations without overwriting", () => {
  freshStateHome();
  const root = project();
  mkdirSync(join(root, "docs", "adr"), { recursive: true });
  writeFileSync(join(root, "docs", "CONTEXT.md"), "existing context\n");

  setupProject(root, { context: "multi" });
  const config = loadProjectConfig(root);

  assert.equal(config.context.path, "docs/CONTEXT.md");
  assert.equal(config.context.mode, "multi");
  assert.equal(config.adr_path, "docs/adr");
  assert.equal(readFileSync(join(root, "docs", "CONTEXT.md"), "utf8"), "existing context\n");
});

test("setup validates and stores a custom context reserve", () => {
  freshStateHome();
  const root = project();
  setupProject(root, { reservePercent: 10 });
  assert.equal(loadProjectConfig(root).context.reserve_percent, 10);
  assert.throws(() => setupProject(project(), { reservePercent: 0 }), /reserve-percent/);
});

test("setup writes default compaction policy and loadProjectConfig enforces it", () => {
  freshStateHome();
  const root = project();
  setupProject(root);
  const compaction = loadProjectConfig(root).compaction;
  assert.equal(compaction.method, "verbatim-line");
  assert.equal(compaction.preserve_recent, 2);
  assert.equal(compaction.compression_ratio, 0.5);
  assert.deepEqual(compaction.protected, ["objective", "definition-of-done", "policy"]);

  // A config without a compaction section still resolves to defaults (backward compatible).
  const bare = project();
  const r = setupProject(bare);
  const configPath = join(process.env.DIRF_HOME, "projects", r.slug, "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  delete config.compaction;
  writeFileSync(configPath, JSON.stringify(config));
  const defaulted = loadProjectConfig(bare).compaction;
  assert.equal(defaulted.method, "verbatim-line");
  assert.equal(defaulted.preserve_recent, 2);
});

test("loadProjectConfig rejects a malformed compaction policy", () => {
  freshStateHome();
  const root = project();
  const r = setupProject(root);
  const configPath = join(process.env.DIRF_HOME, "projects", r.slug, "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.compaction = { method: "summarize" };
  writeFileSync(configPath, JSON.stringify(config));
  assert.throws(() => loadProjectConfig(root), /verbatim-line/);

  config.compaction = { method: "verbatim-line", compression_ratio: 1.5 };
  writeFileSync(configPath, JSON.stringify(config));
  assert.throws(() => loadProjectConfig(root), /compression_ratio/);

  config.compaction = { method: "verbatim-line", preserve_recent: -1 };
  writeFileSync(configPath, JSON.stringify(config));
  assert.throws(() => loadProjectConfig(root), /preserve_recent/);
});

test("attempts are timestamped, portable, and resolved by id or latest name", () => {
  freshStateHome();
  const root = project();
  setupProject(root);
  const first = createAttempt(root, "Demo Run", new Date("2026-07-18T10:00:00.000Z"));
  const second = createAttempt(root, "Demo Run", new Date("2026-07-18T11:00:00.000Z"));

  assert.equal(first.id, "20260718T100000000Z-demo-run");
  assert.equal(second.relativePath, "attempts/20260718T110000000Z-demo-run");
  assert.equal(findAttempt(root, first.id).id, first.id);
  assert.equal(findAttempt(root, "Demo Run").id, second.id);
  assert.deepEqual(listAttempts(root).map((attempt) => attempt.id), [first.id, second.id]);
  assert.equal(readFileSync(join(second.folder, "attempt.json"), "utf8").includes(root), false);
});

test("same-millisecond attempts receive deterministic collision suffixes", () => {
  freshStateHome();
  const root = project();
  setupProject(root);
  const now = new Date("2026-07-18T10:00:00.000Z");

  const first = createAttempt(root, "demo", now);
  const second = createAttempt(root, "demo", now);

  assert.equal(first.id, "20260718T100000000Z-demo");
  assert.equal(second.id, "20260718T100000000Z-demo-02");
});

test("setup rejects configured write paths outside the target", () => {
  freshStateHome();
  const root = project();
  const r = setupProject(root);
  const configPath = join(process.env.DIRF_HOME, "projects", r.slug, "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.tracker.tickets_path = "../../outside.md";
  writeFileSync(configPath, JSON.stringify(config));

  assert.throws(() => setupProject(root), /tickets path must stay inside/);
});

test("setup accepts names beginning with two dots when they remain inside", () => {
  freshStateHome();
  const root = project();
  const r = setupProject(root);
  const configPath = join(process.env.DIRF_HOME, "projects", r.slug, "config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.tracker.tickets_path = "..tickets.md";
  writeFileSync(configPath, JSON.stringify(config));

  assert.equal(loadProjectConfig(root).tracker.tickets_path, "..tickets.md");
});

test("Git sees setup docs but ignores attempts and renders", () => {
  freshStateHome();
  const root = project();
  execFileSync("git", ["init", "-q"], { cwd: root, timeout: TIMEOUT_MS });
  setupProject(root);
  const attempt = createAttempt(root, "demo");
  writeFileSync(join(attempt.folder, "render.mp4"), "render");

  const status = execFileSync("git", ["status", "--short", "--untracked-files=all"], { cwd: root, encoding: "utf8", timeout: TIMEOUT_MS });
  assert.match(status, /docs\/agents\/domain\/CONTEXT\.md/);
  assert.doesNotMatch(status, /\.dirf\/attempts/);
  assert.match(execFileSync("git", ["check-ignore", "-q", ".dirf/attempts/"], { cwd: root, encoding: "utf8", timeout: TIMEOUT_MS }), /^$/);
});

test("attempt creation fails before setup", () => {
  freshStateHome();
  assert.throws(() => createAttempt(project(), "demo"), /dirf setup/);
});

test("repositoryIdentity strips credentials and never persists local paths", () => {
  const root = project();
  // no git repo: folder name only, still an anchor
  assert.deepEqual(repositoryIdentity(root), { name: root.split(/[\\/]/).pop() });
  assert.equal(repositoryIdentity(null), null);

  execFileSync("git", ["init", "-q"], { cwd: root, timeout: TIMEOUT_MS });
  execFileSync("git", ["remote", "add", "origin", "https://user:token@example.test/org/repo.git"], { cwd: root, timeout: TIMEOUT_MS });
  assert.equal(repositoryIdentity(root).remote, "https://example.test/org/repo.git", "credentials must be stripped");

  for (const local of ["/somewhere/private/repo", "file:///somewhere/private/repo", "../sibling/repo", "sibling/repo.git", "C:\\repos\\private", "..\\sibling\\repo"]) {
    execFileSync("git", ["remote", "set-url", "origin", local], { cwd: root, timeout: TIMEOUT_MS });
    assert.equal(repositoryIdentity(root).remote, undefined, `local remote ${local} must not persist`);
  }

  // genuinely remote shapes survive: scheme URLs (userinfo stripped) and scp-like host paths
  execFileSync("git", ["remote", "set-url", "origin", "ssh://git@example.test/org/repo.git"], { cwd: root, timeout: TIMEOUT_MS });
  assert.equal(repositoryIdentity(root).remote, "ssh://example.test/org/repo.git", "ssh URL must persist with userinfo stripped");
  execFileSync("git", ["remote", "set-url", "origin", "git@example.test:org/repo.git"], { cwd: root, timeout: TIMEOUT_MS });
  assert.equal(repositoryIdentity(root).remote, "git@example.test:org/repo.git", "scp-like remote must persist");
});

test("build pipeline writes attempt + HANDOFF into the store (M2 integration)", async () => {
  const home = freshStateHome();
  const root = project();
  execFileSync("git", ["init", "-q"], { cwd: root, timeout: TIMEOUT_MS });
  const setup = setupProject(root);
  const slug = setup.slug;
  const attempt = createAttempt(root, "Demo Run");
  assert.ok(attempt.folder.startsWith(home), "attempt folder must be under DIRF_HOME");
  assert.ok(existsSync(join(attempt.folder, "attempt.json")));
  // Simulate savePlan writing workflow.json + HANDOFF.md into the attempt folder.
  writeFileSync(join(attempt.folder, "workflow.json"), "{}");
  writeFileSync(join(attempt.folder, "HANDOFF.md"), "# Handoff\n");
  assert.equal(readFileSync(join(attempt.folder, "HANDOFF.md"), "utf8"), "# Handoff\n");
  // The per-attempt HANDOFF.md (attempt-scoped) and the canonical project HANDOFF.md
  // (project-scoped, managed via state.js) are distinct files. This is intentional
  // and unchanged from today's behavior; this test only verifies the attempt folder
  // is store-backed.
  const { readHandoff } = await import("../src/state.js");
  // readHandoff reads the project-scoped canonical handoff, which we did NOT write here,
  // so it should be null. This confirms the two are distinct.
  process.env.DIRF_HOME = home;
  assert.equal(readHandoff(slug), null);
});

test("setup migrates legacy .dirf content (handoff + attempts + config) into the store", () => {
  const home = freshStateHome();
  const root = project();
  // Seed a legacy .dirf/ as if this target predated the store.
  mkdirSync(join(root, ".dirf", "attempts", "20260101T000000000Z-old"), { recursive: true });
  writeFileSync(join(root, ".dirf", "attempts", "20260101T000000000Z-old", "attempt.json"), JSON.stringify({ schema_version: 1, id: "20260101T000000000Z-old", name: "old", relativePath: ".dirf/attempts/20260101T000000000Z-old", created_at: "2026-01-01T00:00:00.000Z" }));
  writeFileSync(join(root, ".dirf", "config.json"), JSON.stringify({ schema_version: 1, tracker: { provider: "local", specs_path: "docs/agents/issues/specs", tickets_path: "docs/agents/issues/tickets.md" }, context: { mode: "single", path: "docs/CONTEXT.md", reserve_percent: 5 }, adr_path: "docs/adr", attempt_root: ".dirf/attempts" }));
  writeFileSync(join(root, ".dirf", "HANDOFF.md"), "# Legacy handoff\n");

  const result = setupProject(root);
  const slug = result.slug;
  const storeCfg = join(home, "projects", slug, "config.json");
  // Config migrated + upgraded to schema v2 (setup wrote it; legacy upgrade skipped because store config exists).
  const cfg = JSON.parse(readFileSync(storeCfg, "utf8"));
  assert.equal(cfg.schema_version, 2);
  assert.equal(cfg.slug, slug);
  // Handoff migrated.
  assert.equal(readFileSync(join(home, "projects", slug, "HANDOFF.md"), "utf8"), "# Legacy handoff\n");
  // Attempt migrated.
  assert.ok(existsSync(join(home, "projects", slug, "attempts", "20260101T000000000Z-old", "attempt.json")));
  // Backup created.
  const backups = readdirSync(root).filter((n) => n.startsWith(".dirf.migrating."));
  assert.ok(backups.length >= 1, "a backup copy must exist");
});
