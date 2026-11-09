// Copy the skills an attempt is bound to into a checkout, so that agents started
// there can use them. DIRF installs nothing: each copy carries a marker with a
// content hash, hides itself from Git, and is removed by removeMaterializedSkills
// only while it still matches that hash.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileHash, MATERIALIZED_MARKER } from "./paths.js";

export const HOST_SKILL_DIRS = { claude: ".claude/skills", codex: ".codex/skills", agents: ".agents/skills" };

const GITIGNORE = ".gitignore";
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FOLDER_ENTRIES = new Set(["SKILL.md", "README.md"]);
const NEVER_COPY = new Set([".git", "node_modules"]);

function hostDir(host) {
  const dir = Object.hasOwn(HOST_SKILL_DIRS, host) ? HOST_SKILL_DIRS[host] : null;
  if (!dir) throw new Error(`Unknown host "${host}". Use one of: ${Object.keys(HOST_SKILL_DIRS).join(", ")}.`);
  return dir;
}

// Hosts look for skills at the top of the checkout, so a subfolder is never the target.
function checkoutRoot(path) {
  try {
    return resolve(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: path, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch {
    return resolve(path);
  }
}

// A linked folder would send the copies outside this checkout.
function assertPlainFolder(root, relativeRoot) {
  let current = root;
  for (const segment of relativeRoot.split("/")) {
    current = join(current, segment);
    let stats;
    try {
      stats = lstatSync(current);
    } catch {
      return;
    }
    if (stats.isSymbolicLink()) throw new Error(`${current} is a link. DIRF copies skills only into a real folder in this checkout.`);
  }
}

function treeHash(dir) {
  const hash = createHash("sha256");
  const walk = (current, prefix) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      if (!prefix && (entry.name === MATERIALIZED_MARKER || entry.name === GITIGNORE)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(current, entry.name), relative);
      else hash.update(relative).update("\0").update(entry.isFile() ? readFileSync(join(current, entry.name)) : "not-a-file").update("\0");
    }
  };
  walk(dir, "");
  return hash.digest("hex");
}

function skipReason(binding, entry, dest) {
  if (!SAFE_NAME.test(binding.skill || "")) return "the skill name is not a safe folder name";
  if (binding.status !== "installed" || !entry) return `the skill is ${binding.status || "missing"}`;
  if (existsSync(dest)) return existsSync(join(dest, MATERIALIZED_MARKER)) ? "already copied" : "a skill with this name is already there";
  if (!existsSync(entry)) return "the source file is gone";
  if (lstatSync(entry).isSymbolicLink()) return "the source entry file is a link";
  if (basename(entry) === "skill.json") return "the source entry is skill.json, which hosts do not read";
  if (binding.fingerprint && fileHash(entry) !== binding.fingerprint) return "the source changed after the workflow was built";
  if (FOLDER_ENTRIES.has(basename(entry)) && existsSync(join(dirname(entry), ".git"))) return "the source folder is a whole repository";
  return null;
}

// Build the copy beside the skills folder and rename it in, because a host can
// pick up a new skill folder while a session runs and must never see half of one.
function copySkill(binding, entry, skillsRoot, dest) {
  const staging = join(dirname(skillsRoot), `.dirf-staging-${process.pid}-${binding.skill}`);
  let omittedLinks = 0;
  rmSync(staging, { recursive: true, force: true });
  try {
    if (FOLDER_ENTRIES.has(basename(entry))) {
      const source = realpathSync(dirname(entry));
      cpSync(source, staging, {
        recursive: true,
        filter: (path) => {
          if (path === source) return true;
          if (NEVER_COPY.has(basename(path))) return false;
          if (!lstatSync(path).isSymbolicLink()) return true;
          omittedLinks += 1;
          return false;
        },
      });
      if (!existsSync(join(staging, "SKILL.md"))) renameSync(join(staging, "README.md"), join(staging, "SKILL.md"));
    } else {
      mkdirSync(staging, { recursive: true });
      copyFileSync(entry, join(staging, "SKILL.md"));
    }
    writeFileSync(join(staging, MATERIALIZED_MARKER), `${JSON.stringify({
      schema_version: 1,
      skill: binding.skill,
      provider: binding.provider || null,
      hash: treeHash(staging),
    }, null, 2)}\n`);
    // Ignoring from inside the copy needs no shared Git state and changes no user file.
    writeFileSync(join(staging, GITIGNORE), "*\n");
    renameSync(staging, dest);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return omittedLinks;
}

export function materializeSkills({ worktree, host, bindings }) {
  const relativeRoot = hostDir(host);
  const root = checkoutRoot(worktree);
  assertPlainFolder(root, relativeRoot);
  const skillsRoot = join(root, relativeRoot);
  const copied = [];
  const skipped = [];
  const warnings = [];
  for (const binding of bindings) {
    try {
      const dest = SAFE_NAME.test(binding.skill || "") ? join(skillsRoot, binding.skill) : null;
      // A skill stored in the repository comes from this checkout, not the one that built the attempt.
      const local = binding.relative_entry ? join(root, binding.relative_entry) : null;
      const entry = local && existsSync(local) ? local : binding.entry;
      const reason = skipReason(binding, entry, dest);
      if (reason) {
        skipped.push({ skill: binding.skill, reason });
        continue;
      }
      mkdirSync(skillsRoot, { recursive: true });
      const omittedLinks = copySkill(binding, entry, skillsRoot, dest);
      copied.push(binding.skill);
      if (omittedLinks) warnings.push({ skill: binding.skill, warning: `${omittedLinks} linked item(s) were not copied` });
    } catch (error) {
      skipped.push({ skill: binding.skill, reason: `the copy failed: ${error.message}` });
    }
  }
  return { host, directory: relativeRoot, copied, skipped, warnings };
}

export function removeMaterializedSkills({ worktree, host }) {
  const relativeRoot = hostDir(host);
  const root = checkoutRoot(worktree);
  assertPlainFolder(root, relativeRoot);
  const skillsRoot = join(root, relativeRoot);
  const removed = [];
  const kept = [];
  const entries = existsSync(skillsRoot) ? readdirSync(skillsRoot, { withFileTypes: true }) : [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(skillsRoot, entry.name);
    const markerPath = join(dir, MATERIALIZED_MARKER);
    if (!existsSync(markerPath)) continue;
    let hash = null;
    try {
      hash = JSON.parse(readFileSync(markerPath, "utf8")).hash;
    } catch {
      // A damaged marker cannot prove that DIRF made this folder.
    }
    if (!hash || hash !== treeHash(dir)) {
      kept.push({ skill: entry.name, reason: "the copy changed after DIRF made it" });
      continue;
    }
    rmSync(dir, { recursive: true, force: true });
    removed.push(entry.name);
  }
  return { host, directory: relativeRoot, removed, kept };
}
