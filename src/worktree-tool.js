// @ts-check
// Detects whether a repository opts in to Worktrunk for worktree creation.
// DIRF never installs or runs it: detection only reads the repo config file and
// searches PATH, so no foreign binary executes. Without both, agents use git.
import { accessSync, constants, existsSync, lstatSync, statSync } from "node:fs";
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
      if (isExecutable(candidate, platform)) return candidate;
    }
  }
  return null;
}

/**
 * @param {string} file
 * @param {NodeJS.Platform} platform
 */
function isExecutable(file, platform) {
  try {
    // App execution aliases (WindowsApps) refuse stat with EACCES; lstat sees them.
    if (platform === "win32") return !lstatSync(file).isDirectory();
    // The shell skips a file without the execute bit.
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
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
    // The shell runs the first `wt` on PATH; if that is the Terminal alias,
    // `wt` never reaches Worktrunk. Known limit: a Windows Terminal installed
    // elsewhere (Scoop, portable) looks like Worktrunk here, because telling
    // them apart would mean running the binary, which DIRF never does.
    const wt = findOnPath("wt", options);
    return wt && !/[\\/]WindowsApps[\\/][^\\/]+$/i.test(wt) ? "wt" : null;
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
