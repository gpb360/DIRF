import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { fileHash } from "./paths.js";
import { SKILL_STATUS, bundledSkills, discover, enrichDiscovered, inspectSkillReadiness, skillIsIncomplete } from "./skills.js";

const ENTRY_FILES = ["SKILL.md", "skill.json", "README.md"];

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
  const readiness = entry ? inspectSkillReadiness(entry) : {};
  const relativeEntry = entry && projectRoot
    ? relative(projectRoot, entry)
    : null;
  return {
    skill: step.skill,
    provider: step.provider || "project",
    status: !entry ? SKILL_STATUS.missing : skillIsIncomplete(readiness) ? SKILL_STATUS.incomplete : SKILL_STATUS.installed,
    entry: entry ? entry.replaceAll("\\", "/") : null,
    relative_entry: relativeEntry && !relativeEntry.startsWith("..") && !isAbsolute(relativeEntry)
      ? relativeEntry.replaceAll("\\", "/")
      : null,
    fingerprint: entry ? fileHash(entry) : null,
    ...readiness,
  };
}

export function bindingsFromPlan(plan, projectRoot) {
  return (plan.skill_flow?.steps || []).map((step) => binding(step, step.path, projectRoot));
}

export function refreshSkillBindings(plan, previous, projectRoot, options = {}) {
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
  return bindings;
}
