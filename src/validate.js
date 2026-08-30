// Registry, workflow, and folder-contract validation.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { AGENTS_DIR, REGISTRY, ROOT, SKILLS, PLAYBOOKS, PLAYBOOK_DIR, POLICY, loadJson } from "./paths.js";
import { reconcile, validateAgentContracts, validateWorkflowGates } from "./flow.js";
import { loadPlaybookFolders, resolveGraph } from "./folders.js";
import { bundledSkills, lintSkillMetadata } from "./skills.js";
import { ISSUE_POLICY_SCHEMA_VERSION } from "./issue-governance.js";
import { validatePublicationBoundary } from "./publication-boundary.js";

const FM_RE = /^([A-Za-z0-9_-]+):\s*(.*)$/;

const REQUIRED_PLAN_KEYS = {
  schema_version: "number",
  name: "string", task: "string", playbook: "string", playbook_description: "string",
  agents: "array", baseline_skills: "array", questions: "array", skill_flow: "object", policy: "string",
};

function hasType(value, type) {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === type;
}

export function validateSnapshot(data, label = "workflow") {
  const errors = [];
  for (const [key, type] of Object.entries(REQUIRED_PLAN_KEYS)) {
    if (!(key in data)) errors.push(`${label}: missing required key ${key}`);
    else if (!hasType(data[key], type)) errors.push(`${label}: key ${key} must be ${type}`);
  }
  if (![2, 3, 4, 5].includes(data.schema_version)) errors.push(`${label}: unsupported schema_version`);
  if (data.continuation !== undefined) {
    if (!data.continuation || typeof data.continuation !== "object" || Array.isArray(data.continuation)) {
      errors.push(`${label}: continuation must be an object`);
    } else {
      for (const field of ["playbook", "description"]) {
        if (typeof data.continuation[field] !== "string" || !data.continuation[field].trim()) {
          errors.push(`${label}: continuation.${field} must be a non-empty string`);
        }
      }
    }
  }
  if (data.issue_policy !== undefined) {
    const policy = data.issue_policy;
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
      errors.push(`${label}: issue_policy must be an object`);
    } else {
      if (policy.schemaVersion !== ISSUE_POLICY_SCHEMA_VERSION) errors.push(`${label}: issue_policy.schemaVersion must be ${ISSUE_POLICY_SCHEMA_VERSION}`);
      if (policy.mode !== "local_only") errors.push(`${label}: issue_policy.mode must be local_only`);
      if (policy.externalCreation !== "project_policy_required") errors.push(`${label}: issue_policy.externalCreation must be project_policy_required`);
    }
  }
  if (data.model_advice !== undefined) {
    const advice = data.model_advice;
    if (!advice || typeof advice !== "object" || Array.isArray(advice)) {
      errors.push(`${label}: model_advice must be an object`);
    } else {
      if (advice.advisory_only !== true) errors.push(`${label}: model_advice.advisory_only must be true`);
      for (const field of ["invoked_models", "live_monitoring", "pricing_lookup"]) {
        if (advice[field] !== false) errors.push(`${label}: model_advice.${field} must be false`);
      }
      if (!["recommended", "partial", "unavailable"].includes(advice.status)) {
        errors.push(`${label}: model_advice.status must be recommended, partial, or unavailable`);
      }
      if (!Array.isArray(advice.recommendations)) {
        errors.push(`${label}: model_advice.recommendations must be an array`);
      } else {
        for (const [index, recommendation] of advice.recommendations.entries()) {
          for (const field of ["model", "cost_tier", "rationale"]) {
            if (typeof recommendation?.[field] !== "string" || !recommendation[field].trim()) {
              errors.push(`${label}: model_advice recommendation ${index + 1} ${field} must be a non-empty string`);
            }
          }
          if (!["low", "medium", "high"].includes(recommendation?.cost_tier)) {
            errors.push(`${label}: model_advice recommendation ${index + 1} cost_tier must be low, medium, or high`);
          }
          for (const field of ["capabilities", "stages"]) {
            if (!Array.isArray(recommendation?.[field]) || !recommendation[field].length || recommendation[field].some((value) => typeof value !== "string" || !value.trim())) {
              errors.push(`${label}: model_advice recommendation ${index + 1} ${field} must be an array of non-empty strings`);
            }
          }
        }
      }
      if (!Array.isArray(advice.uncovered_capabilities) || advice.uncovered_capabilities.some((value) => typeof value !== "string" || !value.trim())) {
        errors.push(`${label}: model_advice.uncovered_capabilities must be an array of non-empty strings`);
      }
      if (typeof advice.catalog_source !== "string" || !advice.catalog_source.trim()) {
        errors.push(`${label}: model_advice.catalog_source must be a non-empty string`);
      }
      if (advice.catalog_sha256 !== undefined && !/^[a-f0-9]{64}$/.test(advice.catalog_sha256)) {
        errors.push(`${label}: model_advice.catalog_sha256 must be a lowercase SHA-256 digest`);
      }
      const recommendationCount = Array.isArray(advice.recommendations) ? advice.recommendations.length : null;
      const uncoveredCount = Array.isArray(advice.uncovered_capabilities) ? advice.uncovered_capabilities.length : null;
      if (advice.status === "recommended" && recommendationCount !== null && recommendationCount === 0) {
        errors.push(`${label}: model_advice.status recommended requires at least one recommendation`);
      }
      if (advice.status === "recommended" && uncoveredCount !== null && uncoveredCount > 0) {
        errors.push(`${label}: model_advice.status recommended requires no uncovered capabilities`);
      }
      if (advice.status === "partial" && recommendationCount !== null && recommendationCount === 0) {
        errors.push(`${label}: model_advice.status partial requires at least one recommendation`);
      }
      if (advice.status === "partial" && uncoveredCount !== null && uncoveredCount === 0) {
        errors.push(`${label}: model_advice.status partial requires at least one uncovered capability`);
      }
      if (advice.status === "unavailable" && recommendationCount !== null && recommendationCount > 0) {
        errors.push(`${label}: model_advice.status unavailable requires no recommendations`);
      }
      const hasHostCatalogProvenance = advice.catalog_source === "host-provided file" &&
        /^[a-f0-9]{64}$/.test(advice.catalog_sha256 || "");
      if (["recommended", "partial"].includes(advice.status) &&
          !hasHostCatalogProvenance) {
        errors.push(`${label}: model_advice.status ${advice.status} requires host catalog provenance`);
      }
      if (advice.status === "unavailable" && advice.catalog_source !== "not provided" &&
          !hasHostCatalogProvenance) {
        errors.push(`${label}: model_advice unavailable advice from a host catalog requires catalog provenance`);
      }
      if (typeof advice.rationale !== "string" || !advice.rationale.trim()) {
        errors.push(`${label}: model_advice.rationale must be a non-empty string`);
      }
    }
  }

  // Optional per-phase gates on the persisted workflow (playbook
  // config.workflow.gates flattened at selection time). Absent is fine — old
  // snapshots stay gate-free. Present but malformed is an error so a stale
  // snapshot never silently misleads a host about its gates.
  if (data.workflow) {
    errors.push(...validateWorkflowGates(data.workflow, label));
    const agentNames = Array.isArray(data.agents) ? data.agents.map((agent) => agent?.name) : [];
    errors.push(...validateAgentContracts(data.workflow, agentNames, label));
  }

  const resolvedSkillError = (skill, where, nameKey = "name") => {
    if (!skill || typeof skill !== "object" || typeof skill[nameKey] !== "string" || !skill[nameKey]) {
      errors.push(`${label}: ${where} must be a resolved skill object`);
      return;
    }
    if (!new Set(["installed", "recommended", "fallback"]).has(skill.status)) {
      errors.push(`${label}: ${where} status must be installed, recommended, or fallback`);
    } else if (data.schema_version < 4 && skill.status === "installed" && typeof skill.path !== "string") {
      errors.push(`${label}: ${where} installed skill must include path`);
    } else if (data.schema_version >= 4 && skill.status === "installed" && typeof skill.provider !== "string") {
      errors.push(`${label}: ${where} installed skill must include provider`);
    } else if (data.schema_version >= 4 && "path" in skill) {
      errors.push(`${label}: ${where} must not persist a runtime path`);
    }
  };

  for (const [index, skill] of (Array.isArray(data.baseline_skills) ? data.baseline_skills : []).entries()) {
    resolvedSkillError(skill, `baseline skill ${index + 1}`);
  }
  for (const [agentIndex, agent] of (Array.isArray(data.agents) ? data.agents : []).entries()) {
    if ("status" in (agent || {}) && !["installed", "fallback"].includes(agent.status)) {
      errors.push(`${label}: agent ${agentIndex + 1} status must be installed or fallback`);
    }
    for (const key of ["source_path", "path"]) {
      if (agent && key in agent) errors.push(`${label}: agent ${agentIndex + 1} must not persist a runtime ${key}`);
    }
    if (!Array.isArray(agent?.skills)) {
      errors.push(`${label}: agent ${agentIndex + 1} skills must be an array`);
      continue;
    }
    for (const [skillIndex, skill] of agent.skills.entries()) {
      resolvedSkillError(skill, `agent ${agentIndex + 1} skill ${skillIndex + 1}`);
    }
  }
  if (typeof data.skill_flow?.label !== "string" || !data.skill_flow.label) {
    errors.push(`${label}: skill_flow.label must be a non-empty string`);
  }
  if (!Array.isArray(data.skill_flow?.steps)) {
    errors.push(`${label}: skill_flow.steps must be an array`);
  } else {
    for (const [index, step] of data.skill_flow.steps.entries()) {
      resolvedSkillError(step, `skill_flow step ${index + 1}`, "skill");
      for (const field of ["stage", "reason"]) {
        if (typeof step?.[field] !== "string" || !step[field]) {
          errors.push(`${label}: skill_flow step ${index + 1} ${field} must be a non-empty string`);
        }
      }
      // Optional per-step output contract (terse checkpoint string). When
      // present it must read as a non-empty string so the rendered checkpoint
      // is meaningful; absent is fine (agnostic/optional).
      if (step?.output !== undefined && (typeof step.output !== "string" || !step.output.trim())) {
        errors.push(`${label}: skill_flow step ${index + 1} output must be a non-empty string`);
      }
    }
  }
  if (data.schema_version >= 3 && !Array.isArray(data.capability_gaps)) {
    errors.push(`${label}: capability_gaps must be an array`);
  } else if (Array.isArray(data.capability_gaps)) {
    for (const gap of data.capability_gaps) {
      if (gap?.blocking === true) {
        errors.push(`${label}: blocking capability gap: ${gap.question || gap.code || "unresolved reference"}`);
      }
    }
  }
  // Optional compaction directive (verbatim-line selection under context
  // pressure). Absent is fine — the renderer applies defaults. Present but
  // malformed is an error so a stale snapshot does not silently mislead a host.
  if (data.compaction !== undefined) {
    const c = data.compaction;
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      errors.push(`${label}: compaction must be an object`);
    } else {
      if (c.method !== "verbatim-line") errors.push(`${label}: compaction.method must be "verbatim-line"`);
      if (!Number.isInteger(c.preserve_recent) || c.preserve_recent < 0) errors.push(`${label}: compaction.preserve_recent must be a non-negative integer`);
      if (typeof c.compression_ratio !== "number" || c.compression_ratio < 0.1 || c.compression_ratio > 0.9) errors.push(`${label}: compaction.compression_ratio must be a number from 0.1 to 0.9`);
      if (!Array.isArray(c.protected) || c.protected.some((s) => typeof s !== "string" || !s)) errors.push(`${label}: compaction.protected must be an array of non-empty strings`);
    }
  }
  if (data.schema_version >= 4 && "path" in data) {
    errors.push(`${label}: must not persist target repository path`);
  }
  if (data.schema_version >= 5) {
    if (!data.attempt || typeof data.attempt.id !== "string" || typeof data.attempt.path !== "string") {
      errors.push(`${label}: attempt must include id and target-relative path`);
    } else if (/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/.test(data.attempt.path)) {
      errors.push(`${label}: attempt path must be target-relative`);
    }
    for (const stage of ["clarify", "prototype", "split", "implement", "review"]) {
      if (typeof data.lifecycle?.[stage] !== "string" || !data.lifecycle[stage]) errors.push(`${label}: lifecycle.${stage} must be a non-empty string`);
    }
  }
  return errors;
}

function parseFrontmatter(path) {
  const text = readFileSync(path, "utf-8");
  if (!text.startsWith("---\n")) throw new Error("missing opening frontmatter fence");
  const end = text.indexOf("\n---", 4);
  if (end === -1) throw new Error("missing closing frontmatter fence");
  const fields = {};
  for (const line of text.slice(4, end).split(/\r?\n/)) {
    const m = FM_RE.exec(line);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

export function main() {
  const errors = [];
  const warnings = [];

  // --- agents ---
  const agentsReg = loadJson(REGISTRY);
  const seenMd = {};

  let mdFiles = [];
  try { mdFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".md")).sort(); } catch { /* none */ }
  for (const md of mdFiles) {
    try {
      const fm = parseFrontmatter(join(AGENTS_DIR, md));
      for (const key of ["name", "description", "tools"]) {
        if (!(key in fm)) errors.push(`${md}: missing frontmatter field ${key}`);
      }
      seenMd[fm.name || md.replace(/\.md$/, "")] = md;
    } catch (exc) {
      errors.push(`${md}: ${exc.message}`);
    }
  }

  const registryNames = new Set();
  for (const a of (agentsReg.agents || [])) {
    registryNames.add(a.name);
    const fp = a.file || "";
    const base = fp.split("/").pop();
    if (!fp || !fp.endsWith(".md")) errors.push(`agent ${a.name}: file must be markdown, got ${JSON.stringify(fp)}`);
    if (!existsSync(join(AGENTS_DIR, base))) errors.push(`agent ${a.name}: markdown missing at ${fp}`);
    if (!("skills" in a)) warnings.push(`agent ${a.name}: no skills field`);
  }

  // --- skills ---
  const skillsReg = loadJson(SKILLS);
  const skillNames = new Set((skillsReg.skills || []).map((s) => s.name));
  for (const s of (skillsReg.skills || [])) {
    for (const key of ["name", "category", "applies_to", "summary"]) {
      if (!(key in s)) warnings.push(`skill ${s.name || "?"}: missing ${key}`);
    }
  }

  // --- playbooks ---
  let playbooks;
  try { playbooks = Object.keys(loadPlaybookFolders(PLAYBOOK_DIR)).length ? loadPlaybookFolders(PLAYBOOK_DIR) : loadJson(PLAYBOOKS); }
  catch (error) { errors.push(error.message); playbooks = {}; }
  for (const [name, pb] of Object.entries(playbooks)) {
    for (const key of ["description", "keywords", "agents", "workflow"]) {
      if (!pb[key]) errors.push(`playbook ${name}: missing ${key}`);
    }
    const conditionalAgents = Array.isArray(pb.workflow?.conditional_contract?.agents)
      ? pb.workflow.conditional_contract.agents
      : [];
    for (const an of new Set([...(Array.isArray(pb.agents) ? pb.agents : []), ...conditionalAgents])) {
      if (!registryNames.has(an)) errors.push(`playbook ${name}: references unknown agent ${an}`);
    }
  }
  errors.push(...reconcile(playbooks));

  // --- folder-native units ---
  for (const base of [PLAYBOOK_DIR, join(ROOT, "skills"), join(ROOT, "tools"), join(ROOT, "workflows")]) {
    let folders = [];
    try { folders = readdirSync(base, { withFileTypes: true }).filter((entry) => entry.isDirectory() && entry.name !== "instructions" && existsSync(join(base, entry.name, "README.md"))); }
    catch { /* optional root */ }
    for (const folder of folders) {
      try { resolveGraph(join(base, folder.name), { allowedRoots: [ROOT, base] }); }
      catch (error) { errors.push(error.message); }
    }
  }

  // --- bundled skill metadata (dogfoods the authoring guidance) ---
  // Spec-level lint over the kit's own skills/ — deterministic and
  // host-independent, so the kit itself stays clean forever.
  for (const [name, skill] of Object.entries(bundledSkills())) {
    for (const warning of lintSkillMetadata({ name, path: skill.path, description: skill.description, body_lines: skill.body_lines })) {
      warnings.push(`skill ${name}: ${warning}`);
    }
  }

  if (!existsSync(POLICY)) errors.push("policies/workflow-policy.md missing");
  errors.push(...validatePublicationBoundary(ROOT));

  if (errors.length) {
    console.log("Validation failed:");
    for (const e of errors) console.log(`  - ${e}`);
    process.exit(1);
  }
  if (warnings.length) {
    console.log("Validation warnings:");
    for (const w of warnings) console.log(`  - ${w}`);
  }
  console.log(`Validation passed: ${registryNames.size} agents, ${Object.keys(playbooks).length} playbooks, ${skillNames.size} skills`);
}

import { pathToFileURL } from "node:url";
if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
