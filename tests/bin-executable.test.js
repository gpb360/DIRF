import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function insideGitCheckout() {
  try {
    return git(["rev-parse", "--is-inside-work-tree"]) === "true";
  } catch {
    return false;
  }
}

// npm link symlinks the bin target as-is. A non-executable tracked mode makes
// the dirf command fail with "Permission denied" on Linux and macOS after a pull.
test("every package.json bin target is tracked as executable", (t) => {
  if (!insideGitCheckout()) {
    t.skip("not running inside a git checkout");
    return;
  }
  const bins = typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : pkg.bin || {};
  for (const [name, target] of Object.entries(bins)) {
    const file = target.replace(/^\.\//, "");
    const mode = git(["ls-files", "-s", "--", file]).split(/\s+/)[0] || null;
    assert.ok(mode, `bin "${name}" (${target}) is not tracked by git`);
    assert.equal(mode, "100755", `bin "${name}" (${target}) must be tracked as 100755`);
  }
});
