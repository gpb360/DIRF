import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// DIRF must reach subagents and resist silent skips: the startup hook can name
// the host event it answers, configured checkouts get a mandatory directive,
// host setup installs the subagent hook, and an opt-in edit guard blocks
// tracked edits when no attempt owns the checkout.

const CLI = join(process.cwd(), "src", "cli.js");
const TIMEOUT = 30_000;

function run(args, env, cwd, input) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: TIMEOUT, input, env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  return result;
}

function repoWithHome(prefix) {
  const home = mkdtempSync(join(tmpdir(), "dirf-hookev-home-"));
  const repo = mkdtempSync(join(tmpdir(), prefix));
  execFileSync("git", ["init", "-q"], { cwd: repo, timeout: TIMEOUT });
  return { home, repo };
}

function hook(args, env, cwd) {
  const out = run(["state", "active", "--hook", ...args], env, cwd);
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout).hookSpecificOutput;
}

test("state active --hook names the requested host event", () => {
  const { home, repo } = repoWithHome("hookev-");
  const env = { DIRF_HOME: home };
  assert.equal(hook(["--path", repo], env, repo).hookEventName, "SessionStart", "default stays SessionStart");
  assert.equal(hook(["--path", repo, "--event", "SubagentStart"], env, repo).hookEventName, "SubagentStart");
  run(["setup", repo], env, repo);
  assert.equal(hook(["--path", repo, "--event", "SubagentStart"], env, repo).hookEventName, "SubagentStart");
});

test("state active --hook rejects an unknown event", () => {
  const { home, repo } = repoWithHome("hookbad-");
  const out = run(["state", "active", "--hook", "--path", repo, "--event", "Stop"], { DIRF_HOME: home }, repo);
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /--event must be SessionStart or SubagentStart/);
});

test("configured checkouts get a mandatory directive; unconfigured ones do not", () => {
  const { home, repo } = repoWithHome("hookdir-");
  const env = { DIRF_HOME: home };
  const unconfigured = hook(["--path", repo], env, repo).additionalContext;
  assert.doesNotMatch(unconfigured, /^Required:/, "do not push DIRF onto scratch or unconfigured folders");
  run(["setup", repo], env, repo);
  const idle = hook(["--path", repo, "--event", "SubagentStart"], env, repo).additionalContext;
  assert.match(idle, /^Required: .*`dirf state active`/);
  assert.match(idle, /no in-progress attempt is bound/i, "the state line still follows the directive");
});

test("host setup installs SessionStart and SubagentStart hooks idempotently", () => {
  const settings = join(mkdtempSync(join(tmpdir(), "hookev-set-")), "settings.json");
  writeFileSync(settings, JSON.stringify({ hooks: {} }, null, 2));
  const home = mkdtempSync(join(tmpdir(), "dirf-hookev-home-"));
  const first = run(["host", "setup", "--settings", settings, "--skip-skill"], { DIRF_HOME: home });
  assert.equal(first.status, 0, first.stderr);
  const parsed = JSON.parse(readFileSync(settings, "utf8"));
  const commands = (event) => (parsed.hooks[event] || []).flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(commands("SessionStart").some((c) => /state active --hook$/.test(c)));
  assert.ok(commands("SubagentStart").some((c) => /state active --hook --event SubagentStart$/.test(c)));
  run(["host", "setup", "--settings", settings, "--skip-skill"], { DIRF_HOME: home });
  const again = JSON.parse(readFileSync(settings, "utf8"));
  assert.equal(again.hooks.SessionStart.length, 1);
  assert.equal(again.hooks.SubagentStart.length, 1);
  assert.equal(again.hooks.PreToolUse, undefined, "the edit guard is opt-in");
});

test("host hook-snippet includes the subagent hook", () => {
  const out = run(["host", "hook-snippet"], { DIRF_HOME: mkdtempSync(join(tmpdir(), "dirf-hookev-home-")) });
  const parsed = JSON.parse(out.stdout);
  assert.match(parsed.hooks.SubagentStart[0].hooks[0].command, /state active --hook --event SubagentStart$/);
});

test("host setup --guard installs the opt-in PreToolUse edit guard", () => {
  const settings = join(mkdtempSync(join(tmpdir(), "hookev-guard-")), "settings.json");
  writeFileSync(settings, JSON.stringify({}, null, 2));
  const home = mkdtempSync(join(tmpdir(), "dirf-hookev-home-"));
  run(["host", "setup", "--settings", settings, "--skip-skill", "--guard"], { DIRF_HOME: home });
  run(["host", "setup", "--settings", settings, "--skip-skill", "--guard"], { DIRF_HOME: home });
  const parsed = JSON.parse(readFileSync(settings, "utf8"));
  assert.equal(parsed.hooks.PreToolUse.length, 1);
  assert.equal(parsed.hooks.PreToolUse[0].matcher, "Edit|Write|MultiEdit|NotebookEdit|apply_patch");
  assert.match(parsed.hooks.PreToolUse[0].hooks[0].command, /state guard --hook$/);
});

test("state guard blocks edits only in a configured checkout without a bound attempt", () => {
  const { home, repo } = repoWithHome("guard-");
  const env = { DIRF_HOME: home };
  const payload = (dir) => JSON.stringify({ cwd: dir, tool_name: "Edit", tool_input: { file_path: join(dir, "a.txt") } });
  const guard = (dir) => run(["state", "guard", "--hook"], env, dir, payload(dir));

  const unconfigured = guard(repo);
  assert.equal(unconfigured.status, 0);
  assert.equal(unconfigured.stdout.trim(), "", "unconfigured checkouts pass silently");

  run(["setup", repo], env, repo);
  const idle = guard(repo);
  assert.equal(idle.status, 0, idle.stderr);
  const denied = JSON.parse(idle.stdout).hookSpecificOutput;
  assert.equal(denied.hookEventName, "PreToolUse");
  assert.equal(denied.permissionDecision, "deny");
  assert.match(denied.permissionDecisionReason, /dirf build|dirf resume/);

  const attempt = JSON.parse(run(["build", "guarded", "fix a guarded behavior", "--path", repo, "--json"], env, repo).stdout).attempt;
  run(["resume", attempt.id, "--path", repo], env, repo);
  const active = guard(repo);
  assert.equal(active.status, 0, active.stderr);
  assert.equal(active.stdout.trim(), "", "a bound attempt allows the edit");
});

test("state guard fails open on unreadable hook input", () => {
  const { home, repo } = repoWithHome("guardbad-");
  run(["setup", repo], { DIRF_HOME: home }, repo);
  const out = run(["state", "guard", "--hook"], { DIRF_HOME: home }, repo, "not json");
  assert.equal(out.status, 0);
  assert.equal(out.stdout.trim(), "", "a broken payload never blocks the host");
});
