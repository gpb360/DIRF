import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileHash } from "../src/paths.js";
import { materializeSkills, removeMaterializedSkills } from "../src/skill-materialize.js";
import { discover } from "../src/skills.js";
import { refreshSkillBindings } from "../src/skill-bindings.js";

const CLI = join(process.cwd(), "src", "cli.js");

function readdirNames(path) {
  return readdirSync(path).sort();
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function repo(prefix = "dirf-materialize-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const main = join(root, "main");
  mkdirSync(main);
  git(main, "init", "-q");
  git(main, "config", "user.email", "dirf@example.invalid");
  git(main, "config", "user.name", "DIRF Test");
  writeFileSync(join(main, "file.txt"), "base\n");
  git(main, "add", "file.txt");
  git(main, "commit", "-q", "-m", "base");
  return { root, main };
}

function source(root, name, file = "SKILL.md") {
  const dir = join(root, "source", name);
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, file), `---\nname: ${name}\ndescription: Test skill\n---\nBody of ${name}\n`);
  writeFileSync(join(dir, "scripts", "run.mjs"), "export {};\n");
  const entry = join(dir, file);
  return { skill: name, provider: "claude", status: "installed", entry, fingerprint: fileHash(entry) };
}

test("copies each bound skill folder into a linked worktree and keeps the checkout clean", () => {
  const { root, main } = repo();
  const worktree = join(root, "wt");
  git(main, "worktree", "add", "-q", worktree, "-b", "wt");
  const result = materializeSkills({
    worktree, host: "claude", attemptId: "a1",
    bindings: [source(root, "with-skill-md"), source(root, "with-readme", "README.md")],
  });
  assert.deepEqual(result.copied, ["with-skill-md", "with-readme"]);
  assert.deepEqual(result.skipped, []);
  const skills = join(worktree, ".claude", "skills");
  assert.match(readFileSync(join(skills, "with-skill-md", "SKILL.md"), "utf8"), /Body of with-skill-md/);
  assert.ok(existsSync(join(skills, "with-skill-md", "scripts", "run.mjs")));
  assert.match(readFileSync(join(skills, "with-readme", "SKILL.md"), "utf8"), /Body of with-readme/);
  assert.ok(!existsSync(join(skills, "with-readme", "README.md")));
  assert.equal(git(worktree, "status", "--porcelain", "--untracked-files=all"), "");

  mkdirSync(join(skills, "users-own"));
  writeFileSync(join(skills, "users-own", "SKILL.md"), "mine\n");
  assert.match(git(worktree, "status", "--porcelain", "--untracked-files=all"), /users-own/, "only DIRF copies are hidden");
});

test("never overwrites a skill it did not copy, and repeats safely", () => {
  const { root, main } = repo();
  const binding = source(root, "taken");
  const existing = join(main, ".claude", "skills", "taken");
  mkdirSync(existing, { recursive: true });
  writeFileSync(join(existing, "SKILL.md"), "user version\n");
  const first = materializeSkills({ worktree: main, host: "claude", bindings: [binding] });
  assert.deepEqual(first.copied, []);
  assert.match(first.skipped[0].reason, /already there/);
  assert.equal(readFileSync(join(existing, "SKILL.md"), "utf8"), "user version\n");

  const other = source(root, "fresh");
  assert.deepEqual(materializeSkills({ worktree: main, host: "claude", bindings: [other] }).copied, ["fresh"]);
  const again = materializeSkills({ worktree: main, host: "claude", bindings: [other] });
  assert.deepEqual(again.copied, []);
  assert.match(again.skipped[0].reason, /already copied/);
});

test("skips what it cannot copy safely and says why", () => {
  const { root, main } = repo();
  const changed = source(root, "changed");
  writeFileSync(changed.entry, "edited after build\n");
  const whole = source(root, "whole-repo");
  mkdirSync(join(root, "source", "whole-repo", ".git"));
  const result = materializeSkills({
    worktree: main, host: "claude",
    bindings: [
      { skill: "absent", status: "missing", entry: null },
      { skill: "partial", status: "incomplete", entry: changed.entry },
      { ...source(root, "safe"), skill: "plugin:skill" },
      { ...source(root, "safe2"), skill: "../escape" },
      changed,
      whole,
    ],
  });
  assert.deepEqual(result.copied, []);
  assert.deepEqual(result.skipped.map(({ reason }) => reason), [
    "the skill is missing",
    "the skill is incomplete",
    "the skill name is not a safe folder name",
    "the skill name is not a safe folder name",
    "the source changed after the workflow was built",
    "the source folder is a whole repository",
  ]);
  assert.ok(!existsSync(join(main, ".claude", "skills", "escape")));
  assert.ok(!existsSync(join(main, ".claude", "escape")));
});

test("does not follow links or copy dependency folders", (t) => {
  const { root, main } = repo();
  const binding = source(root, "linked");
  const dir = join(root, "source", "linked");
  mkdirSync(join(dir, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(root, "secret.txt"), "secret\n");
  let linked = false;
  try {
    symlinkSync(join(root, "secret.txt"), join(dir, "link.txt"));
    linked = true;
  } catch {
    t.diagnostic("symlinks unavailable on this system");
  }
  const result = materializeSkills({ worktree: main, host: "claude", bindings: [binding] });
  assert.equal(result.warnings.length, linked ? 1 : 0);
  const copy = join(main, ".claude", "skills", "linked");
  assert.ok(existsSync(join(copy, "SKILL.md")));
  assert.ok(!existsSync(join(copy, "link.txt")));
  assert.ok(!existsSync(join(copy, "node_modules")));
});

test("cleanup removes only what DIRF copied", () => {
  const { root, main } = repo();
  materializeSkills({ worktree: main, host: "codex", bindings: [source(root, "ours")] });
  const skills = join(main, ".codex", "skills");
  mkdirSync(join(skills, "users-own"));
  assert.deepEqual(removeMaterializedSkills({ worktree: main, host: "codex" }).removed, ["ours"]);
  assert.ok(!existsSync(join(skills, "ours")));
  assert.ok(existsSync(join(skills, "users-own")));
  assert.deepEqual(removeMaterializedSkills({ worktree: main, host: "codex" }).removed, []);
});

test("an unknown host fails clearly", () => {
  const { main } = repo();
  assert.throws(() => materializeSkills({ worktree: main, host: "constructor", bindings: [] }), /Unknown host/);
});

test("cleanup never deletes a folder that is not an unchanged DIRF copy", () => {
  const { root, main } = repo();
  const skills = join(main, ".claude", "skills");
  materializeSkills({ worktree: main, host: "claude", bindings: [source(root, "replaced"), source(root, "edited"), source(root, "broken")] });

  rmSync(join(skills, "replaced"), { recursive: true });
  mkdirSync(join(skills, "replaced"));
  writeFileSync(join(skills, "replaced", "SKILL.md"), "user version\n");
  writeFileSync(join(skills, "edited", "SKILL.md"), "edited by a person\n");
  writeFileSync(join(skills, "broken", ".dirf-materialized.json"), "{");

  const result = removeMaterializedSkills({ worktree: main, host: "claude" });
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.kept.map(({ skill }) => skill).sort(), ["broken", "edited"]);
  assert.equal(readFileSync(join(skills, "replaced", "SKILL.md"), "utf8"), "user version\n");
  assert.equal(readFileSync(join(skills, "edited", "SKILL.md"), "utf8"), "edited by a person\n");
  assert.ok(existsSync(join(skills, "broken")));
});

test("a subfolder resolves to the top of the checkout", () => {
  const { root, main } = repo();
  mkdirSync(join(main, "pkg"));
  assert.deepEqual(materializeSkills({ worktree: join(main, "pkg"), host: "claude", bindings: [source(root, "top")] }).copied, ["top"]);
  assert.ok(existsSync(join(main, ".claude", "skills", "top", "SKILL.md")));
  assert.ok(!existsSync(join(main, "pkg", ".claude")));
  assert.equal(git(main, "status", "--porcelain", "--untracked-files=all"), "");
  assert.deepEqual(removeMaterializedSkills({ worktree: join(main, "pkg"), host: "claude" }).removed, ["top"]);
});

test("a linked skills folder is refused", (t) => {
  const { root, main } = repo();
  const shared = join(root, "shared");
  mkdirSync(shared);
  mkdirSync(join(main, ".claude"));
  try {
    symlinkSync(shared, join(main, ".claude", "skills"), "junction");
  } catch {
    t.skip("links unavailable on this system");
    return;
  }
  assert.throws(() => materializeSkills({ worktree: main, host: "claude", bindings: [source(root, "x")] }), /is a link/);
  assert.throws(() => removeMaterializedSkills({ worktree: main, host: "claude" }), /is a link/);
});

test("one failed copy does not stop the others", () => {
  const { root, main } = repo();
  const dir = join(root, "source", "bad");
  mkdirSync(join(dir, "SKILL.md"), { recursive: true });
  const result = materializeSkills({
    worktree: main, host: "claude",
    bindings: [
      { skill: "bad", provider: "claude", status: "installed", entry: join(dir, "SKILL.md"), fingerprint: "abc" },
      source(root, "good"),
    ],
  });
  assert.deepEqual(result.copied, ["good"]);
  assert.match(result.skipped[0].reason, /copy failed/);
  assert.deepEqual(readdirNames(join(main, ".claude")), ["skills"], "no staging folder is left behind");
  assert.equal(git(main, "status", "--porcelain", "--untracked-files=all"), "");
});

test("a linked entry file is refused", (t) => {
  const { root, main } = repo();
  const binding = source(root, "entry-link");
  const dir = join(root, "source", "entry-link");
  writeFileSync(join(dir, "README.md"), "real readme\n");
  rmSync(binding.entry);
  try {
    symlinkSync(join(root, "elsewhere.md"), binding.entry);
  } catch {
    t.skip("symlinks unavailable on this system");
    return;
  }
  writeFileSync(join(root, "elsewhere.md"), "other\n");
  const result = materializeSkills({ worktree: main, host: "claude", bindings: [{ ...binding, fingerprint: null }] });
  assert.deepEqual(result.copied, []);
  assert.match(result.skipped[0].reason, /is a link/);
});

test("a skill stored in the repository is taken from this checkout", () => {
  const { root, main } = repo();
  const local = join(main, "skills", "in-repo");
  mkdirSync(local, { recursive: true });
  writeFileSync(join(local, "README.md"), "---\nname: in-repo\n---\nlocal version\n");
  const entry = join(root, "gone", "skills", "in-repo", "README.md");
  const result = materializeSkills({
    worktree: main, host: "claude",
    bindings: [{ skill: "in-repo", status: "installed", entry, relative_entry: "skills/in-repo/README.md", fingerprint: fileHash(join(local, "README.md")) }],
  });
  assert.deepEqual(result.copied, ["in-repo"]);
  assert.match(readFileSync(join(main, ".claude", "skills", "in-repo", "SKILL.md"), "utf8"), /local version/);
});

test("skill discovery ignores copies when the path sends it to the recursive scan", () => {
  const { root, main } = repo("dirf-cache-");
  materializeSkills({ worktree: main, host: "claude", bindings: [source(root, "zz-cached-copy")] });
  assert.equal(discover(main)["zz-cached-copy"], undefined);
});

test("refreshing a binding keeps the real source instead of a disposable copy", () => {
  const { root, main } = repo();
  const worktree = join(root, "wt");
  git(main, "worktree", "add", "-q", worktree, "-b", "wt");
  const bound = source(root, "main-only");
  materializeSkills({ worktree, host: "claude", bindings: [bound] });
  const saved = { ...bound, provider: "project", relative_entry: ".claude/skills/main-only/SKILL.md" };
  const plan = { skill_flow: { steps: [{ skill: "main-only", provider: "project" }] } };
  assert.deepEqual(refreshSkillBindings(plan, [saved], worktree), [saved]);
});

test("a tracked skill is real even with a marker in it", () => {
  const { root, main } = repo();
  materializeSkills({ worktree: main, host: "claude", bindings: [source(root, "zz-tracked")] });
  git(main, "add", "-f", ".claude/skills/zz-tracked");
  git(main, "commit", "-q", "-m", "track it");
  assert.ok(discover(main)["zz-tracked"], "discovery sees it");
  const again = materializeSkills({ worktree: main, host: "claude", bindings: [source(root, "zz-tracked")] });
  assert.match(again.skipped[0].reason, /already there/);
  const cleaned = removeMaterializedSkills({ worktree: main, host: "claude" });
  assert.deepEqual(cleaned.removed, []);
  assert.equal(git(main, "status", "--porcelain"), "", "no tracked file was deleted");
});

test("cleanup keeps a renamed copy and notices any change", () => {
  const { root, main } = repo();
  const skills = join(main, ".claude", "skills");
  materializeSkills({ worktree: main, host: "claude", bindings: [source(root, "ren"), source(root, "ign"), source(root, "emp")] });
  renameSync(join(skills, "ren"), join(skills, "my-fork"));
  writeFileSync(join(skills, "ign", ".gitignore"), "*.log\n");
  mkdirSync(join(skills, "emp", "added"));
  const result = removeMaterializedSkills({ worktree: main, host: "claude" });
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.kept.map(({ skill }) => skill).sort(), ["emp", "ign", "my-fork"]);
});

test("cleanup removes host folders it emptied and keeps others", () => {
  const { root, main } = repo();
  materializeSkills({ worktree: main, host: "codex", bindings: [source(root, "only")] });
  removeMaterializedSkills({ worktree: main, host: "codex" });
  assert.ok(!existsSync(join(main, ".codex")));
  mkdirSync(join(main, ".claude"));
  writeFileSync(join(main, ".claude", "settings.json"), "{}\n");
  materializeSkills({ worktree: main, host: "claude", bindings: [source(root, "only2")] });
  removeMaterializedSkills({ worktree: main, host: "claude" });
  assert.ok(existsSync(join(main, ".claude", "settings.json")));
});

test("skill discovery ignores materialized copies", () => {
  const { root, main } = repo();
  materializeSkills({ worktree: main, host: "claude", bindings: [source(root, "zz-copied-skill")] });
  const own = join(main, ".claude", "skills", "zz-own-skill");
  mkdirSync(own);
  writeFileSync(join(own, "SKILL.md"), "---\nname: zz-own-skill\ndescription: Mine\n---\nBody\n");
  const index = discover(main);
  assert.equal(index["zz-copied-skill"], undefined);
  assert.ok(index["zz-own-skill"]);
});

test("dirf skills materialize copies an attempt's skills and a named DIRF default", () => {
  const { root, main } = repo();
  const env = { ...process.env, DIRF_HOME: join(root, "home") };
  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: main, encoding: "utf8", env, timeout: 60_000 });
  assert.equal(cli("setup", main).status, 0);
  const built = cli("build", "demo", "fix a small bug", "--path", main, "--json");
  assert.equal(built.status, 0, built.stderr);
  const attempt = JSON.parse(built.stdout).attempt.id;

  const noHost = cli("skills", "materialize", "--attempt", attempt);
  assert.notEqual(noHost.status, 0);
  assert.match(noHost.stderr, /--host/);

  const result = cli("skills", "materialize", "--attempt", attempt, "--host", "claude", "--include", "ste100,not-a-real-skill", "--json");
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.ok(output.copied.includes("ste100"), result.stdout);
  assert.ok(output.skipped.some(({ skill }) => skill === "not-a-real-skill"));
  assert.match(readFileSync(join(main, ".claude", "skills", "ste100", "SKILL.md"), "utf8"), /name: ste100/);
  assert.doesNotMatch(git(main, "status", "--porcelain", "--untracked-files=all"), /.claude/);

  mkdirSync(join(main, "pkg"));
  mkdirSync(join(main, "skills", "only-project"), { recursive: true });
  writeFileSync(join(main, "skills", "only-project", "README.md"), "---\nname: only-project\ndescription: Project skill\n---\nBody\n");
  const fromSubfolder = spawnSync(process.execPath, [CLI, "skills", "materialize", "--attempt", attempt, "--host", "claude", "--include", "only-project", "--json"], {
    cwd: join(main, "pkg"), encoding: "utf8", env, timeout: 60_000,
  });
  assert.equal(fromSubfolder.status, 0, fromSubfolder.stderr);
  assert.ok(JSON.parse(fromSubfolder.stdout).copied.includes("only-project"), fromSubfolder.stdout);

  const clean = cli("skills", "clean", "--host", "claude");
  assert.equal(clean.status, 0, clean.stderr);
  assert.ok(!existsSync(join(main, ".claude", "skills", "ste100")));
});
