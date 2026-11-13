// @ts-check
// Detects whether a repository opts in to Worktrunk for worktree creation.
// DIRF never installs or runs it: detection only reads the repo config file and
// searches PATH, so no foreign binary executes. Without both, agents use git.
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

export const WORKTRUNK_CONFIG = ".config/wt.toml";

/**
 * Find an executable on PATH without running it.
 * @param {string} name
 * @param {{ env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [options]
 * @returns {string | null}
 */
export function findOnPath(name, { env = process.env, platform = process.platform } = {}) {
  const dirs = pathDirs(env, platform);
  const exts = platform === "win32" ? String(env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean) : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext.toLowerCase());
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch { /* keep searching */ }
    }
  }
  return null;
}

/**
 * PATH entries, unquoted. A plain env object may spell the key `Path` (Windows).
 * @param {NodeJS.ProcessEnv} env
 * @param {NodeJS.Platform} platform
 * @returns {string[]}
 */
function pathDirs(env, platform) {
  const raw = env.PATH || env.Path || "";
  return raw.split(platform === "win32" ? ";" : ":").map((dir) => dir.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
}

/**
 * Resolve the Worktrunk command. On Windows `wt` is normally the Windows
 * Terminal app alias (under WindowsApps), so Worktrunk installs as `git-wt`.
 * @param {{ env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [options]
 * @returns {string | null}
 */
export function worktrunkCommand(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    if (findOnPath("git-wt", options)) return "git-wt";
    const env = options.env ?? process.env;
    const path = pathDirs(env, platform).filter((dir) => !/[\\/]WindowsApps[\\/]?$/i.test(dir)).join(";");
    return findOnPath("wt", { platform, env: { ...env, PATH: path } }) ? "wt" : null;
  }
  if (findOnPath("wt", options)) return "wt";
  return findOnPath("git-wt", options) ? "git-wt" : null;
}

/**
 * @param {string} root repository root
 * @param {{ env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [options]
 * @returns {{ tool: "worktrunk" | "git", configured: boolean, command: string | null, reason: string }}
 */
export function detectWorktreeTool(root, options = {}) {
  const configured = existsSync(join(root, WORKTRUNK_CONFIG));
  const command = configured ? worktrunkCommand(options) : null;
  if (configured && command) {
    return { tool: "worktrunk", configured, command, reason: `${WORKTRUNK_CONFIG} present and ${command} on PATH` };
  }
  return {
    tool: "git",
    configured,
    command: null,
    reason: configured ? `${WORKTRUNK_CONFIG} present but Worktrunk is not installed` : `no ${WORKTRUNK_CONFIG}`,
  };
}
