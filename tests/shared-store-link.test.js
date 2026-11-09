import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(process.cwd(), "src", "cli.js");

function dirf(args, home, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: "utf8", timeout: 30_000, env: { ...process.env, DIRF_HOME: home },
  });
}

function ok(args, home, cwd) {
  const result = dirf(args, home, cwd);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function repo(root, name) {
  const path = join(root, name);
  execFileSync("git", ["init", "-q", path]);
  execFileSync("git", ["-C", path, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]);
  return path;
}

function slugOf(output) {
  return output.match(/([a-z0-9.-]+-[0-9a-f]{8})/)[1];
}

// Two machines sharing a store: the first machine's checkout is absent on the second.
function twoMachines() {
  const root = mkdtempSync(join(tmpdir(), "dirf-link-"));
  const home = join(root, "store");
  const first = repo(root, "first-machine");
  const second = repo(root, "second-machine");
  const slug = slugOf(ok(["state", "register", "--path", first], home, first));
  renameSync(first, join(root, "elsewhere"));
  return { root, home, second, slug };
}

test("a linked checkout resolves to the shared project and its handoff", () => {
  const { root, home, second, slug } = twoMachines();
  const handoffFile = join(root, "handoff.md");
  execFileSync(process.execPath, ["-e", `require("fs").writeFileSync(${JSON.stringify(handoffFile)}, "# shared handoff\\n")`]);
  ok(["state", "write-handoff", "--file", handoffFile, "--slug", slug], home, second);

  assert.match(ok(["state", "link", "--slug", slug], home, second), /Linked:/);
  assert.equal(slugOf(ok(["state", "which"], home, second)), slug);
  assert.match(ok(["state", "read-handoff"], home, second), /shared handoff/);
  assert.match(ok(["state", "link", "--slug", slug], home, second), /Already linked/);
});

test("an unlinked clone keeps its own slug", () => {
  const { root, home, slug } = twoMachines();
  const other = repo(root, "other-clone");
  assert.notEqual(slugOf(ok(["state", "register", "--path", other], home, other)), slug);
});

test("git commands run in this machine's checkout after linking", () => {
  const { home, second, slug } = twoMachines();
  ok(["state", "link", "--slug", slug], home, second);
  const result = dirf(["worktree", "list", "--slug", slug], home, second);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.replaceAll("\\", "/"), /second-machine/);
});

test("link refuses unknown projects, owned paths and a second local checkout", () => {
  const { root, home, second, slug } = twoMachines();
  assert.match(dirf(["state", "link", "--slug", "nope-00000000"], home, second).stderr, /Unknown DIRF project/);
  assert.notEqual(dirf(["state", "link"], home, second).status, 0);

  const owned = repo(root, "owned");
  const ownedSlug = slugOf(ok(["state", "register", "--path", owned], home, owned));
  assert.match(dirf(["state", "link", "--slug", slug, "--path", owned], home, owned).stderr, /already belongs/);

  ok(["state", "link", "--slug", slug], home, second);
  const third = repo(root, "third");
  assert.match(dirf(["state", "link", "--slug", slug, "--path", third], home, third).stderr, /already has a checkout/);
  assert.equal(slugOf(ok(["state", "which"], home, owned)), ownedSlug);
});
