import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

function trackedMode(file) {
  try {
    const out = execFileSync("git", ["ls-files", "-s", "--", file], { cwd: ROOT, encoding: "utf8" });
    return out.trim().split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

// npm link symlinks the bin target as-is. A non-executable tracked mode makes
// the dirf command fail with "Permission denied" on Linux and macOS after a pull.
test("every package.json bin target is tracked as executable", (t) => {
  const bins = typeof pkg.bin === "string" ? { [pkg.name]: pkg.bin } : pkg.bin || {};
  for (const [name, target] of Object.entries(bins)) {
    const mode = trackedMode(target.replace(/^\.\//, ""));
    if (mode === null) {
      t.skip("not running inside a git checkout");
      return;
    }
    assert.equal(mode, "100755", `bin "${name}" (${target}) must be tracked as 100755`);
  }
});
