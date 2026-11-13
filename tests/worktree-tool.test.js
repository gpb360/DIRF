import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectWorktreeTool, worktrunkCommand } from "../src/worktree-tool.js";

function bin(dir, name) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), "");
  return dir;
}

function repo({ config }) {
  const root = mkdtempSync(join(tmpdir(), "dirf-wt-"));
  if (config) {
    mkdirSync(join(root, ".config"));
    writeFileSync(join(root, ".config", "wt.toml"), "");
  }
  return root;
}

const win = (dirs) => ({ platform: "win32", env: { PATH: dirs.join(";"), PATHEXT: ".EXE;.CMD" } });

test("Worktrunk is chosen only when the repo config and the command both exist", () => {
  const tools = bin(mkdtempSync(join(tmpdir(), "dirf-bin-")), "git-wt.exe");
  const withConfig = repo({ config: true });
  const withoutConfig = repo({ config: false });

  assert.deepEqual(detectWorktreeTool(withConfig, win([tools])), {
    tool: "worktrunk", configured: true, command: "git-wt", reason: ".config/wt.toml present and git-wt on PATH",
  });
  assert.equal(detectWorktreeTool(withoutConfig, win([tools])).tool, "git");
  const missing = detectWorktreeTool(withConfig, win([]));
  assert.equal(missing.tool, "git");
  assert.equal(missing.reason, ".config/wt.toml present but Worktrunk is not installed");
});

test("on Windows the WindowsApps wt alias is Windows Terminal, not Worktrunk", () => {
  const base = mkdtempSync(join(tmpdir(), "dirf-bin-"));
  const terminal = bin(join(base, "Microsoft", "WindowsApps"), "wt.exe");
  assert.equal(worktrunkCommand(win([terminal])), null);
  const worktrunk = bin(join(base, "cargo", "bin"), "wt.exe");
  assert.equal(worktrunkCommand(win([terminal, worktrunk])), "wt");
});

test("on POSIX wt is preferred, then git-wt", { skip: process.platform === "win32" }, () => {
  const a = bin(mkdtempSync(join(tmpdir(), "dirf-bin-")), "git-wt");
  const b = bin(mkdtempSync(join(tmpdir(), "dirf-bin-")), "wt");
  assert.equal(worktrunkCommand({ platform: "linux", env: { PATH: a } }), "git-wt");
  assert.equal(worktrunkCommand({ platform: "linux", env: { PATH: `${a}:${b}` } }), "wt");
});
