import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.js");
const TIMEOUT = 30_000;

// Captures stderr too — several host paths report status on stderr.
function run(args, env, cwd) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: TIMEOUT, env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, combined: `${result.stdout}${result.stderr}` };
}

function freshHome() {
  return mkdtempSync(join(tmpdir(), "dirf-host-"));
}

function freshRepo(prefix) {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  execFileSync("git", ["init", "-q"], { cwd: repo, timeout: TIMEOUT });
  return repo;
}

test("dirf setup writes the DIRF bootstrap block into CONTEXT.md and AGENTS.md", () => {
  const home = freshHome();
  const repo = freshRepo("bootproj-");
  // A pre-existing root CONTEXT.md is the common host shape; the block must
  // append to it rather than create the default nested context file.
  writeFileSync(join(repo, "CONTEXT.md"), "# Project Context\n");
  run(["setup", repo], { DIRF_HOME: home });
  for (const file of ["CONTEXT.md", "AGENTS.md"]) {
    const content = readFileSync(join(repo, file), "utf8");
    assert.ok(content.includes("dirf:bootstrap"), `${file} carries the marker`);
    assert.match(content, /`dirf state active`/);
    assert.match(content, /Never read or write `\.dirf\//);
    assert.match(content, /~\/\.dirf\/projects\//, `${file} names the portable store location`);
    assert.ok(!content.includes(home), `${file} stays machine-portable (no absolute store path in committed files)`);
  }
  // A second run must not duplicate the block.
  run(["setup", repo], { DIRF_HOME: home });
  const again = readFileSync(join(repo, "CONTEXT.md"), "utf8");
  assert.equal(again.split("dirf:bootstrap").length - 1, 1);
});

test("dirf setup skips a non-regular AGENTS.md instead of crashing", () => {
  const home = freshHome();
  const repo = freshRepo("bootdir-");
  mkdirSync(join(repo, "AGENTS.md")); // pathological host shape: a directory with that name
  const out = run(["setup", repo], { DIRF_HOME: home });
  assert.equal(out.status, 0, "setup completes despite the directory named AGENTS.md");
  assert.match(out.stdout, /DIRF configured/);
  const ctx = readFileSync(join(repo, "docs", "agents", "domain", "CONTEXT.md"), "utf8");
  assert.ok(ctx.includes("dirf:bootstrap"), "the context file still receives the block");
});

test("bootstrap append matches the host file's CRLF line endings", () => {
  const home = freshHome();
  const repo = freshRepo("bootcrlf-");
  writeFileSync(join(repo, "AGENTS.md"), "# Rules\r\n\r\nBe nice.\r\n");
  run(["setup", repo], { DIRF_HOME: home });
  const content = readFileSync(join(repo, "AGENTS.md"), "utf8");
  assert.ok(content.includes("\r\n<!-- dirf:bootstrap -->"), "block is joined with CRLF");
  assert.ok(!/(?<!\r)\n/.test(content), "no lone LF introduced into a CRLF file");
});

test("bootstrap injection preserves pre-existing AGENTS.md content", () => {
  const home = freshHome();
  const repo = freshRepo("bootpre-");
  writeFileSync(join(repo, "AGENTS.md"), "# Custom rules\n\nDon't break the build.\n");
  run(["setup", repo], { DIRF_HOME: home });
  const content = readFileSync(join(repo, "AGENTS.md"), "utf8");
  assert.ok(content.startsWith("# Custom rules"), "existing content is preserved");
  assert.ok(content.includes("dirf:bootstrap"), "block is appended");
});

test("dirf state which prints the canonical handoff path", () => {
  const home = freshHome();
  const repo = freshRepo("whichhand-");
  run(["setup", repo], { DIRF_HOME: home });
  const out = run(["state", "which"], { DIRF_HOME: home }, repo);
  assert.match(out.stdout, /handoff: .+[\\/]HANDOFF\.md/);
  assert.ok(out.stdout.includes(home), "handoff path resolves inside the store home");
});

test("dirf host hook-snippet prints valid SessionStart hook JSON", () => {
  const out = run(["host", "hook-snippet"], { DIRF_HOME: freshHome() });
  const parsed = JSON.parse(out.stdout);
  const entry = parsed.hooks.SessionStart[0].hooks[0];
  assert.equal(entry.type, "command");
  assert.match(entry.command, /node ".*src[\\/]cli\.js" state active --hook/);
});

test("dirf host setup --settings merges the SessionStart hook idempotently", () => {
  const home = freshHome();
  const settings = join(mkdtempSync(join(tmpdir(), "hookset-")), "settings.json");
  writeFileSync(settings, JSON.stringify({ model: "x", hooks: { PostToolUse: [] } }, null, 2));
  const first = run(["host", "setup", "--settings", settings, "--skip-skill"], { DIRF_HOME: home });
  assert.match(first.stdout, /Hook installed/);
  const parsed = JSON.parse(readFileSync(settings, "utf8"));
  assert.ok(parsed.hooks.SessionStart.some((g) => g.hooks.some((h) => h.command.includes("state active --hook"))));
  assert.deepEqual(parsed.hooks.PostToolUse, [], "unrelated hook groups are preserved");
  assert.equal(parsed.model, "x", "unrelated settings are preserved");
  assert.ok(existsSync(`${settings}.dirf-bak`), "backup is written once");
  const second = run(["host", "setup", "--settings", settings, "--skip-skill"], { DIRF_HOME: home });
  assert.match(second.stdout, /already present/);
  const reParsed = JSON.parse(readFileSync(settings, "utf8"));
  assert.equal(reParsed.hooks.SessionStart.length, 1, "no duplicate hook group on re-run");
});

test("dirf host setup merges into a ZCode-style hooks.events schema and enables hooks", () => {
  const home = freshHome();
  const settings = join(mkdtempSync(join(tmpdir(), "zchook-")), "settings.json");
  writeFileSync(settings, JSON.stringify({ hooks: { enabled: false, events: { PostToolUse: [] } } }, null, 2));
  const first = run(["host", "setup", "--settings", settings, "--skip-skill"], { DIRF_HOME: home });
  assert.match(first.stdout, /Hook installed/);
  assert.match(first.stdout, /hooks\.enabled = true/);
  const parsed = JSON.parse(readFileSync(settings, "utf8"));
  assert.equal(parsed.hooks.enabled, true, "hooks are enabled (ZCode config requirement)");
  assert.ok(parsed.hooks.events.SessionStart.some((g) => g.hooks.some((h) => h.command.includes("state active --hook"))));
  assert.ok(!("SessionStart" in parsed.hooks), "no hook written to the direct schema");
  const second = run(["host", "setup", "--settings", settings, "--skip-skill"], { DIRF_HOME: home });
  assert.match(second.stdout, /already present/);
});

test("dirf host setup rejects a malformed hooks shape without touching the file", () => {
  const home = freshHome();
  const settings = join(mkdtempSync(join(tmpdir(), "badhook-")), "settings.json");
  const original = JSON.stringify({ hooks: [] }, null, 2);
  writeFileSync(settings, original);
  const out = run(["host", "setup", "--settings", settings, "--skip-skill"], { DIRF_HOME: home });
  assert.equal(out.status, 1);
  assert.match(out.combined, /settings\.hooks must be an object, found an array/);
  assert.equal(readFileSync(settings, "utf8"), original, "file is untouched on rejection");
});

test("dirf host setup installs the global dirf skill idempotently and protects local edits", () => {
  const home = freshHome();
  const skills = mkdtempSync(join(tmpdir(), "skills-"));
  const first = run(["host", "setup", "--skill-dir", skills, "--skip-hook"], { DIRF_HOME: home });
  assert.match(first.stdout, /Installed global dirf skill/);
  const path = join(skills, "dirf", "SKILL.md");
  const content = readFileSync(path, "utf8");
  assert.match(content, /^---\s*\nname: dirf/m, "valid skill frontmatter");
  assert.match(content, /`dirf state active`/);
  const second = run(["host", "setup", "--skill-dir", skills, "--skip-hook"], { DIRF_HOME: home });
  assert.match(second.stdout, /already up to date/);
  writeFileSync(path, "edited locally\n");
  const third = run(["host", "setup", "--skill-dir", skills, "--skip-hook"], { DIRF_HOME: home });
  assert.match(third.combined, /local edits present/);
  assert.equal(readFileSync(path, "utf8"), "edited locally\n", "local edits survive without --force");
  run(["host", "setup", "--skill-dir", skills, "--skip-hook", "--force"], { DIRF_HOME: home });
  assert.match(readFileSync(path, "utf8"), /^---\s*\nname: dirf/m, "--force replaces the edited file");
});
