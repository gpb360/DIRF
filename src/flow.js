// Assemble an already-selected Playbook's ordered skill flow.
// Selection happens in router.js; this module never classifies a task.
import { bundledSkills } from "./skills.js";

export const KNOWN_BRANCHES = new Set(["ui", "react", "security", "multi-session"]);

export function reconcile(playbooks, knownBranches = KNOWN_BRANCHES) {
  const errors = [];
  if (!Object.hasOwn(playbooks || {}, "triage")) errors.push("triage: missing coherent playbook definition");
  for (const [name, playbook] of Object.entries(playbooks || {})) {
    if (!playbook || typeof playbook !== "object" || Array.isArray(playbook)) {
      errors.push(`playbook ${name}: definition must be an object`);
      continue;
    }
    if (typeof playbook.description !== "string" || !playbook.description) errors.push(`playbook ${name}: missing description`);
    if (!Array.isArray(playbook.keywords)) errors.push(`playbook ${name}: keywords must be an array`);
    if (!Array.isArray(playbook.agents)) errors.push(`playbook ${name}: agents must be an array`);
    if (!playbook.workflow || typeof playbook.workflow !== "object" || Array.isArray(playbook.workflow)) {
      errors.push(`playbook ${name}: workflow must be an object`);
    } else {
      if (!Array.isArray(playbook.workflow.phases) || playbook.workflow.phases.length === 0) {
        errors.push(`playbook ${name}: workflow.phases must be a non-empty array`);
      }
      for (const field of ["output", "validation", "recovery"]) {
        if (typeof playbook.workflow[field] !== "string" || !playbook.workflow[field]) {
          errors.push(`playbook ${name}: workflow.${field} must be a non-empty string`);
        }
      }
    }
    const flow = playbook.skill_flow;
    if (!flow) {
      errors.push(`playbook ${name}: missing skill_flow`);
      continue;
    }
    if (typeof flow.label !== "string" || !flow.label) errors.push(`playbook ${name}: skill_flow.label must be a non-empty string`);
    if (!Array.isArray(flow.steps) || flow.steps.length === 0) {
      errors.push(`playbook ${name}: skill_flow.steps must be a non-empty array`);
      continue;
    }
    flow.steps.forEach((step, index) => {
      if (!step || typeof step !== "object" || Array.isArray(step)) {
        errors.push(`playbook ${name}: step ${index + 1} must be an object`);
        return;
      }
      for (const field of ["stage", "reason"]) {
        if (!step[field]) errors.push(`playbook ${name}: step ${index + 1} missing ${field}`);
      }
      // Optional per-step output contract (humanlayer F4: a step's output is
      // checkable, not just invoked). When present it must be a non-empty
      // string so the rendered checkpoint is meaningful.
      if (step.output !== undefined && (typeof step.output !== "string" || !step.output.trim())) {
        errors.push(`playbook ${name}: step ${index + 1} output must be a non-empty string`);
      }
      if (!step.capability && !step.skill) errors.push(`playbook ${name}: step ${index + 1} missing capability`);
      if (step.branch && !knownBranches.has(step.branch)) {
        errors.push(`playbook ${name}: step ${index + 1} references unknown branch ${step.branch}`);
      }
    });
  }
  return errors;
}

function branchesFor(task, playbookAgents) {
  const branches = new Set();
  const text = (task || "").toLowerCase();
  if (/\b(ui|page|component|landing|frontend|interface|button|form|screen)\b/.test(text)) branches.add("ui");
  if (/\b(react|hook|jsx|component)\b/.test(text)) branches.add("react");
  if (/\b(security|auth(?:enticated|entication|orization)?|privacy|permission|secret|credential|no[- ]spend|token spend|billing|kie|generation)\b/.test(text)) {
    branches.add("security");
  }
  if (/\b(multi[- ]session|spec(?:ification)?|tickets?|roadmap|large feature|large project)\b/.test(text)) {
    branches.add("multi-session");
  }
  if (playbookAgents?.some((agent) => ["frontend-developer", "ui-designer", "ux-researcher"].includes(agent))) {
    branches.add("ui");
  }
  return branches;
}

const STOP_WORDS = new Set(["and", "the", "for", "with", "from", "into", "before", "after", "when", "this", "that", "task", "skill", "use", "apply"]);

function stem(word) {
  // Light suffix stripping so morphological variants of the same capability
  // word match whatever the local install calls it (copywriting/copywriter,
  // testing/tests). Only strip when a solid stem remains.
  const stripped = word.replace(/(?:ing|ers|ies|es|ed|er|s)$/, "");
  return stripped.length >= 3 ? stripped : word;
}

function words(value) {
  return new Set(String(value || "").toLowerCase().replaceAll("-", " ").match(/[a-z0-9]{3,}/g)?.filter((word) => !STOP_WORDS.has(word)).map(stem) || []);
}

function selectCapability(requirement, selection, context, skillIndex) {
  const capabilityWords = words(requirement.capability);
  const ranked = Object.entries(skillIndex).map(([name, item]) => {
    const candidate = words([name, item.description, item.summary, item.category, ...(item.applies_to || []), ...(item.tags || [])].join(" "));
    const declared = Array.isArray(item.capabilities) ? item.capabilities : String(item.capabilities || "").split(",").map((value) => value.trim()).filter(Boolean);
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const normalizedCapability = requirement.capability.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const directMatch = declared.includes(requirement.capability) || normalizedName === normalizedCapability;
    const overlap = [...capabilityWords].filter((word) => candidate.has(word)).length;
    // Multi-word capabilities still refuse incidental one-word overlap. A
    // single-word capability can match too — otherwise it could never resolve
    // against a local install — but must anchor in the skill's own identity
    // (name, category, tags), not a passing mention in its description.
    const identity = words([name, item.category, ...(item.tags || [])].join(" "));
    const required = Math.max(Math.min(2, capabilityWords.size), Math.ceil(capabilityWords.size / 2));
    const anchored = capabilityWords.size > 1 || [...capabilityWords].some((word) => identity.has(word));
    if (!directMatch && (overlap < required || !anchored)) return { name, item, score: 0 };
    const score = (declared.includes(requirement.capability) ? 100 : normalizedName === normalizedCapability ? 50 : 0) + overlap * 5;
    return { name, item, score };
  }).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || String(a.item.path).localeCompare(String(b.item.path)));
  const chosen = ranked[0];
  if (!chosen) return null;
  return {
    stage: requirement.stage,
    capability: requirement.capability || requirement.stage,
    skill: chosen.name,
    type: chosen.item.type || "skill",
    reason: requirement.reason,
    output: requirement.output || "",
    status: "installed",
    provider: chosen.item.provider || "project",
    selection_reason: `best installed match (${chosen.score}) for ${requirement.capability || requirement.stage}`,
    rejected_candidates: ranked.slice(1, 4).map(({ name, score }) => ({ name, score })),
  };
}

export function buildFlow(selection, context = {}, skillIndex = {}) {
  const flow = selection?.skill_flow;
  if (!flow?.steps) throw new Error(`playbook ${selection?.playbook || "?"}: missing skill_flow`);

  const branches = branchesFor(context.task, selection.agents);
  const requirements = flow.steps
    .filter((step) => !step.branch || branches.has(step.branch))
    .map(({ branch: _branch, skill: _legacySkill, ...step }) => ({ ...step, capability: step.capability || step.stage }));
  const steps = [];
  const gaps = [];
  // The kit ships zero installed skills; its bundled skills/ folder is a
  // fallback consulted ONLY when the local install has nothing for a
  // capability, and the step is labeled so — never passed off as installed.
  let bundled;
  for (const requirement of requirements) {
    const selected = selectCapability(requirement, selection, context, skillIndex);
    const fallback = selected ? null : selectCapability(
      requirement, selection, context, (bundled ??= context.bundledIndex || bundledSkills()));
    if (selected) steps.push(selected);
    else if (fallback) steps.push({
      ...fallback,
      status: "fallback",
      selection_reason: `bundled fallback for ${requirement.capability || requirement.stage} — no matching skill in the local install`,
    });
    else gaps.push({
      stage: requirement.stage,
      capability: requirement.capability,
      question: `No installed capability covers ${requirement.capability}. Would you like DIRF to suggest a trusted skill or derive a repo-local pattern?`,
      reason: requirement.reason,
      requires_approval: true,
      trusted_candidates: (context.trustedSources || []).filter((source) =>
        (source.capabilities || []).includes(requirement.capability)),
    });
  }

  return {
    playbook: selection.playbook,
    label: flow.label,
    steps,
    gaps,
    branches: [...branches],
  };
}

export function findCapabilityGaps(playbooks, skillIndex, context = {}) {
  const gaps = new Map();
  for (const [name, playbook] of Object.entries(playbooks || {})) {
    const flow = buildFlow({ playbook: name, agents: playbook.agents, skill_flow: playbook.skill_flow }, { ...context, task: playbook.description }, skillIndex);
    for (const gap of flow.gaps) gaps.set(gap.capability, gap);
  }
  return [...gaps.values()].sort((a, b) => a.capability.localeCompare(b.capability));
}
