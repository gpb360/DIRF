import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { fileHash } from "./paths.js";
import { bundledSkills, discover, enrichDiscovered } from "./skills.js";

const ENTRY_FILES = ["SKILL.md", "skill.json", "README.md"];
export const SKILL_BINDINGS_FILE = "skill-bindings.json";

function entryFile(path) {
  if (!path) return null;
  try {
    if (statSync(path).isFile()) return path;
  } catch {
    return null;
  }
  for (const name of ENTRY_FILES) {
    const candidate = join(path, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function binding(step, path, projectRoot) {
  const entry = entryFile(path);
  const relativeEntry = entry && projectRoot
    ? relative(projectRoot, entry)
    : null;
  return {
    skill: step.skill,
    provider: step.provider || "project",
    status: entry ? "installed" : "missing",
    entry: entry ? entry.replaceAll("\\", "/") : null,
    relative_entry: relativeEntry && !relativeEntry.startsWith("..") && !isAbsolute(relativeEntry)
      ? relativeEntry.replaceAll("\\", "/")
      : null,
    fingerprint: entry ? fileHash(entry) : null,
  };
}

export function bindingsFromPlan(plan, projectRoot) {
  return (plan.skill_flow?.steps || []).map((step) => binding(step, step.path, projectRoot));
}

export function readSkillBindings(folder) {
  try {
    const value = JSON.parse(readFileSync(join(folder, SKILL_BINDINGS_FILE), "utf8"));
    return Array.isArray(value.bindings) ? value.bindings : [];
  } catch {
    return [];
  }
}

export function writeSkillBindings(folder, bindings) {
  writeFileSync(join(folder, SKILL_BINDINGS_FILE), JSON.stringify({ schema_version: 1, bindings }, null, 2) + "\n", "utf8");
}

export function refreshSkillBindings(plan, folder, projectRoot, options = {}) {
  const previous = readSkillBindings(folder);
  let installed;
  let bundled;
  const bindings = (plan.skill_flow?.steps || []).map((step, index) => {
    const saved = previous[index];
    const provider = step.provider || "project";
    const sameSkill = saved?.skill === step.skill && saved.provider === provider;
    if (sameSkill && saved.relative_entry) {
      const localEntry = join(projectRoot, saved.relative_entry);
      if (existsSync(localEntry)) return binding(step, localEntry, projectRoot);
    }
    if (sameSkill && !saved.relative_entry && saved.entry && isAbsolute(saved.entry) && existsSync(saved.entry)) {
      return binding(step, saved.entry, projectRoot);
    }
    const current = provider === "dirf"
      ? (bundled ??= (options.bundledSkills || bundledSkills)())[step.skill]
      : (installed ??= (options.discoverSkills || (() => enrichDiscovered(discover(projectRoot))))())[step.skill];
    return current && current.provider === provider
      ? binding(step, current.path, projectRoot)
      : binding(step, null, projectRoot);
  });
  writeSkillBindings(folder, bindings);
  return bindings;
}
