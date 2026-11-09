// Shared repository paths and file helpers.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..");

export const AGENTS_DIR = join(ROOT, "agents");
export const REGISTRY = join(ROOT, "registry", "agents.json");
export const SKILLS = join(ROOT, "registry", "skills.json");
export const PLAYBOOKS = join(ROOT, "registry", "playbooks.json");
export const PLAYBOOK_DIR = join(ROOT, "playbooks");
export const POLICY = join(ROOT, "policies", "workflow-policy.md");

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

// Marks a skill folder as a disposable copy made by dirf skills materialize.
export const MATERIALIZED_MARKER = ".dirf-materialized.json";

// True only for an untouched DIRF copy: a readable marker naming this folder,
// with nothing in it tracked by Git. A tracked skill is real, whatever files it holds.
export function isMaterializedCopy(dir) {
  const markerPath = join(dir, MATERIALIZED_MARKER);
  if (!existsSync(markerPath)) return false;
  let skill;
  try {
    skill = JSON.parse(readFileSync(markerPath, "utf8")).skill;
  } catch {
    return false;
  }
  if (skill !== basename(dir)) return false;
  try {
    return execFileSync("git", ["-C", dir, "ls-files", "--", "."], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, LC_ALL: "C" },
    }).trim() === "";
  } catch (error) {
    // Only a folder outside any repository can be called untracked. Any other
    // Git failure leaves the answer unknown, so the folder is treated as real.
    if (!/not a git repository/i.test(String(error.stderr))) return false;
    // A damaged repository reports the same error, but it still has a .git entry.
    for (let current = dir, parent = dirname(dir); ; current = parent, parent = dirname(parent)) {
      if (existsSync(join(current, ".git"))) return false;
      if (parent === current) return true;
    }
  }
}

export function fileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
}

export function folderHash(path) {
  const hash = createHash("sha256");
  for (const entry of readdirSync(path, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = `${entry.name}/README.md`;
    let content;
    try {
      content = readFileSync(join(path, relative));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    hash.update(relative).update("\0").update(content).update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}
