import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  registerProject, createAttemptInStore, updateAttemptLifecycle, claimAttemptCheckout,
  getAttempt, storeProjectDir,
} from "../src/state.js";

const CLI = resolve("src/cli.js");
const scratch = resolve(".scratch/ne007-startup");
mkdirSync(scratch, { recursive: true });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function snapshot(root) {
  const files = [];
  const visit = folder => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push([relative(root, path), digest(readFileSync(path))]);
    }
  };
  visit(root);
  return files;
}

function fixture(t) {
  const previousHome = process.env.DIRF_HOME;
  const home = mkdtempSync(join(scratch, "home-"));
  process.env.DIRF_HOME = home;
  t.after(() => { if (previousHome === undefined) delete process.env.DIRF_HOME; else process.env.DIRF_HOME = previousHome; });
  const root = mkdtempSync(join(scratch, "repo-"));
  execFileSync("git", ["init", "--quiet", root]);
  execFileSync("git", ["-C", root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "--allow-empty", "-m", "Fixture"]);
  const { slug } = registerProject(root);
  const add = (name, { state = "planned", owner = null, gates = {} } = {}) => {
    const attempt = createAttemptInStore(slug, name);
    writeFileSync(join(attempt.folder, "workflow.json"), JSON.stringify({ workflow: { phases: ["build", "verify"], gates } }));
    writeFileSync(join(attempt.folder, "HANDOFF.md"), `# DIRF Handoff\n\n## Attempt ID\n\n${attempt.id}\n\n## Current phase\n\nbuild\n\n## Exact next action\n\nContinue ${name}\n`);
    if (owner) claimAttemptCheckout(slug, attempt.id, owner);
    if (state !== "planned") updateAttemptLifecycle(slug, attempt.id, "start");
    if (state === "blocked") updateAttemptLifecycle(slug, attempt.id, "block", { reason: `Waiting on ${name}` });
    return attempt;
  };
  const run = (args = [], cwd = root) => {
    const env = { ...process.env, DIRF_HOME: home };
    delete env.DIRF_ORCHESTRATOR_TOKEN;
    return spawnSync(process.execPath, [CLI, "state", "active", ...args], { cwd, env,
      encoding: "utf8", timeout: 30000, windowsHide: true });
  };
  const json = (args = [], cwd) => {
    const result = run(["--json", ...args], cwd);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const hook = (cwd = root) => {
    const result = run(["--hook"], cwd);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  };
  const otherWorktree = (prefix = "worktree with spaces-") => {
    const other = mkdtempSync(join(scratch, prefix));
    execFileSync("git", ["-C", root, "worktree", "add", "--quiet", "--detach", other, "HEAD"]);
    return other;
  };
  return { home, root, slug, add, run, json, hook, otherWorktree };
}

test("idle startup pages blocked references without choosing or changing an owner", t => {
  const f = fixture(t);
  const blocked = Array.from({ length: 7 }, (_, i) => f.add(`blocked-${i}`, { state: "blocked" }));
  const before = snapshot(f.home);
  const first = f.json();
  assert.equal(first.state, "idle");
  assert.equal("attempt" in first, false);
  assert.equal(first.unresolved_work.total, 7);
  assert.equal(first.unresolved_work.items.length, 5);
  assert.equal(first.unresolved_work.omitted, 2);
  const second = f.json(["--unresolved-work-cursor", first.unresolved_work.next_cursor]);
  assert.equal(second.state, "idle");
  assert.equal(second.unresolved_work.items.length, 2);
  assert.equal(second.unresolved_work.next_cursor, null);
  assert.deepEqual([...first.unresolved_work.items, ...second.unresolved_work.items].map(row => row.attempt_id), blocked.map(a => a.id));
  assert.match(f.hook(), /Unresolved work:.*7/);
  assert.match(f.run().stdout, /--unresolved-work-cursor/);
  assert.deepEqual(snapshot(f.home), before);
});

test("another checkout's active owner stays separate from project blockers", t => {
  const f = fixture(t);
  const other = f.otherWorktree();
  const blocked = f.add("blocked-here", { state: "blocked", owner: f.root });
  const owner = f.add("owner-elsewhere", { state: "in_progress", owner: other });
  const before = snapshot(f.home);
  const idle = f.json();
  assert.equal(idle.state, "idle");
  assert.equal("attempt" in idle, false);
  assert.deepEqual(idle.unresolved_work.items.map(row => row.attempt_id), [blocked.id]);
  const active = f.json([], other);
  assert.equal(active.state, "active");
  assert.equal(active.attempt.id, owner.id);
  assert.equal(active.attempt.current_phase, "build");
  assert.deepEqual(active.unresolved_work.items.map(row => row.attempt_id), [blocked.id]);
  assert.match(f.hook(other), new RegExp(owner.id));
  assert.equal(getAttempt(f.slug, blocked.id).status, "blocked");
  assert.deepEqual(snapshot(f.home), before);
});

test("conflicting ownership remains explicit and never selects either attempt", t => {
  const f = fixture(t);
  const first = f.add("first", { state: "in_progress", owner: f.root });
  const second = f.add("second", { state: "in_progress" });
  // Simulate an existing legacy/concurrent ownership conflict in an isolated store.
  const path = join(second.folder, "attempt.json");
  const metadata = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...metadata, responsibility_path: f.root }));
  const blocked = f.add("blocked", { state: "blocked" });
  const before = snapshot(f.home);
  const output = f.json();
  assert.equal(output.state, "conflict");
  assert.equal("attempt" in output, false);
  assert.deepEqual(output.attempts.map(a => a.id), [first.id, second.id]);
  assert.deepEqual(output.unresolved_work.items.map(row => row.attempt_id), [blocked.id]);
  assert.match(f.hook(), /responsibility conflict.*Stop and select/i);
  assert.deepEqual(snapshot(f.home), before);
});

test("active startup reports decisions and lifecycle phase disagreement without advancing", t => {
  const f = fixture(t);
  const owner = f.add("owner", { state: "in_progress", owner: f.root, gates: { verify: { kind: "decision" } } });
  const handoff = join(owner.folder, "HANDOFF.md");
  writeFileSync(handoff, readFileSync(handoff, "utf8").replace("\nbuild\n", "\nverify\n"));
  const before = snapshot(f.home);
  const output = f.json();
  assert.equal(output.state, "active");
  assert.equal(output.attempt.current_phase, "build");
  assert.equal(output.attempt.needs_refresh, false);
  assert.equal(output.evidence_completeness, "unverified");
  assert.ok(output.warnings.some(warning => warning.code === "phase_mismatch"));
  assert.deepEqual(output.unresolved_work.items.map(row => [row.kind, row.attempt_id, row.phase]), [["decision", owner.id, "verify"]]);
  const hook = f.hook();
  assert.match(hook, /Current stage: build/);
  assert.match(hook, /phase_mismatch/);
  assert.match(hook, /Evidence: unverified/);
  assert.equal(getAttempt(f.slug, owner.id).current_phase, "build");
  assert.deepEqual(snapshot(f.home), before);
});

test("startup never presents an invalid persisted lifecycle phase as valid", t => {
  const f = fixture(t);
  const owner = f.add("owner", { state: "in_progress", owner: f.root });
  const path = join(owner.folder, "attempt.json");
  const metadata = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...metadata, current_phase: "invalid-phase" }));
  const before = snapshot(f.home);
  const output = f.json();
  assert.equal(output.attempt.current_phase, null);
  assert.ok(output.warnings.some(warning => warning.code === "phase_mismatch"));
  assert.deepEqual(snapshot(f.home), before);
});

test("startup cursors reject changed blocker rows and ownership changes before any write", t => {
  const f = fixture(t);
  for (let i = 0; i < 6; i++) f.add(`blocked-${i}`, { state: "blocked" });
  const first = f.json();
  f.add("new-blocker", { state: "blocked" });
  let before = snapshot(f.home);
  const stale = f.run(["--json", "--unresolved-work-cursor", first.unresolved_work.next_cursor]);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /Invalid summary cursor/);
  assert.deepEqual(snapshot(f.home), before);
  const refreshed = f.json();
  f.add("new-owner", { state: "in_progress", owner: f.root });
  before = snapshot(f.home);
  const otherScope = f.run(["--json", "--unresolved-work-cursor", refreshed.unresolved_work.next_cursor]);
  assert.notEqual(otherScope.status, 0);
  assert.match(otherScope.stderr, /Invalid summary cursor/);
  assert.deepEqual(snapshot(f.home), before);
});

test("active continuation reuses the shared attempt summary page", t => {
  const f = fixture(t);
  const owner = f.add("owner", { state: "in_progress", owner: f.root, gates: { verify: { kind: "decision" } } });
  for (let i = 0; i < 7; i++) f.add(`blocked-${i}`, { state: "blocked" });
  const before = snapshot(f.home);
  const first = f.json();
  assert.equal(first.unresolved_work.total, 8);
  const second = f.json(["--unresolved-work-cursor", first.unresolved_work.next_cursor]);
  assert.equal(second.attempt.id, owner.id);
  assert.equal(second.unresolved_work.offset, 5);
  assert.equal(second.unresolved_work.items.length, 3);
  const result = spawnSync(process.execPath, [CLI, "state", "summary", "--attempt", owner.id,
    "--unresolved-work-cursor", first.unresolved_work.next_cursor, "--json"], {
    cwd: f.root, env: { ...process.env, DIRF_HOME: f.home }, encoding: "utf8", timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(second.unresolved_work, JSON.parse(result.stdout).unresolved_work);
  assert.deepEqual(snapshot(f.home), before);
});

test("startup remains bounded when many blocked attempts and long history exist", t => {
  const f = fixture(t);
  const owner = f.add("owner", { state: "in_progress", owner: f.root });
  for (let i = 0; i < 30; i++) f.add(`blocked-${i}`, { state: "blocked" });
  const handoff = join(owner.folder, "HANDOFF.md");
  writeFileSync(handoff, readFileSync(handoff, "utf8") + "\n## Completed\n" + "- Historical checkpoint\n".repeat(1000));
  const before = snapshot(f.home);
  const output = f.json();
  assert.equal(output.unresolved_work.total, 30);
  assert.equal(output.unresolved_work.items.length, 5);
  assert.equal(output.unresolved_work.omitted, 25);
  assert.ok(output.unresolved_work.next_cursor);
  assert.doesNotMatch(JSON.stringify(output), /Historical checkpoint/);
  const hook = f.hook();
  assert.ok(Buffer.byteLength(hook) < 3000);
  assert.ok(hook.split("\n").length <= 10);
  assert.match(hook, /25 omitted/);
  assert.deepEqual(snapshot(f.home), before);
});

test("startup rejects pending recovery without replaying its checkpoint", t => {
  const f = fixture(t);
  f.add("owner", { state: "in_progress", owner: f.root });
  writeFileSync(join(storeProjectDir(f.slug), ".pending-progress.json"), "Pending recovery sentinel\n");
  const before = snapshot(f.home);
  for (const args of [[], ["--json"], ["--hook"]]) {
    const output = f.run(args);
    assert.notEqual(output.status, 0);
    assert.match(output.stderr, /progress write is pending/);
    assert.deepEqual(snapshot(f.home), before);
  }
});

test("unregistered legacy startup stays unconfigured without migrating or touching files", t => {
  const f = fixture(t);
  const legacy = mkdtempSync(join(scratch, "legacy-"));
  execFileSync("git", ["init", "--quiet", legacy]);
  mkdirSync(join(legacy, ".dirf"));
  writeFileSync(join(legacy, ".dirf/config.json"), "{}\n");
  writeFileSync(join(legacy, ".dirf/HANDOFF.md"), "Legacy sentinel\n");
  const before = snapshot(f.home), localBefore = snapshot(legacy);
  const output = f.json([], legacy);
  assert.equal(output.state, "idle");
  assert.equal(output.configured, false);
  assert.match(f.hook(legacy), /not configured/);
  assert.deepEqual(snapshot(f.home), before);
  assert.deepEqual(snapshot(legacy), localBefore);
});

test("printed continuation retains an explicitly queried checkout from another working directory", t => {
  const f = fixture(t);
  const other = f.otherWorktree("worktree $team `owner's space-");
  const owner = f.add("other-owner", { state: "in_progress", owner: other, gates: { verify: { kind: "decision" } } });
  for (let i = 0; i < 7; i++) f.add(`blocked-${i}`, { state: "blocked" });
  const before = snapshot(f.home);
  const text = f.run(["--path", other]);
  assert.equal(text.status, 0, text.stderr);
  const line = text.stdout.split(/\r?\n/).find(line => line.startsWith("More: "));
  assert.ok(line, "startup must print a continuation command");
  const env = { ...process.env, DIRF_HOME: f.home };
  delete env.DIRF_ORCHESTRATOR_TOKEN;
  const windows = process.platform === "win32";
  const literal = value => windows
    ? `'${value.replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", "'\\''")}'`;
  const prefix = windows
    ? `function dirf { & ${literal(process.execPath)} ${literal(CLI)} @args }; `
    : `dirf() { ${literal(process.execPath)} ${literal(CLI)} "$@"; }; `;
  const command = prefix + line.slice("More: ".length);
  const result = spawnSync(windows ? "powershell.exe" : "sh", windows
    ? ["-NoProfile", "-NonInteractive", "-Command", command]
    : ["-c", command], { cwd: f.root, env, encoding: "utf8", timeout: 30000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const next = JSON.parse(result.stdout);
  assert.equal(next.state, "active");
  assert.equal(next.attempt.id, owner.id);
  assert.equal(next.unresolved_work.offset, 5);
  assert.deepEqual(snapshot(f.home), before);
});
