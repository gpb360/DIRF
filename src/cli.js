#!/usr/bin/env node
// amf-dirf — Agent Spec Kit (Do It Right First). Unified CLI. Node built-ins only.
//
//   dirf setup [path] [--reserve-percent N]              configure a target repository
//   dirf build  <name> "<task>" [--path DIR] [--open] [--no-focused-output]
//   dirf plan   <name> "<task>" [--path DIR] [--research] create a lifecycle planning attempt
//   dirf create <name> "<task>" [--path DIR]             route -> attempt workflow JSON only
//   dirf render <name-or-id> [--path DIR] [--open]       render the latest matching attempt
//   dirf list [--path DIR]                               list saved attempts
//   dirf status [--path DIR]                             show project and repository state
//   dirf resume <name-or-id> [--path DIR]                load the workflow handoff
//   dirf validate                                        validate registries + workflows
//   dirf skills scan [--path DIR]                        scan host, print installed skills + resolved refs
//   dirf validate|graph|run|render <folder>               operate an Eve-style folder DAG
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, isAbsolute, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { ROOT, REGISTRY, SKILLS, PLAYBOOKS, PLAYBOOK_DIR, POLICY, fileHash, folderHash, loadJson } from "./paths.js";
import { collectRoutingFacts, loadPlaybooks, recommend } from "./router.js";
import { discover, discoverAgents, enrichDiscovered, loadRegistry, loadTrustedSources, providerForPath, resolveAgentSkills } from "./skills.js";
import { FOCUSED_OUTPUT_RULES, buildInstructions, buildHtml } from "./renderer.js";
import { main as validateMain } from "./validate.js";
import { inspect, detectStackProfile } from "./inspect.js";
import { buildFlow, findCapabilityGaps, reconcile } from "./flow.js";
import { graphLines, renderFolderHtml, resolveGraph } from "./folders.js";
import { createAttempt, findAttempt, listAttempts, loadProjectConfig, projectRoot, repositoryIdentity, setupProject } from "./project.js";
import { resolveProject, listProjects, registerProject, readHandoff, writeHandoff, listAttempts as listAttemptsState, getAttempt as getAttemptState, storeProjectDir, importHandoff, migrateCleanup, appendObservation, listObservations, promoteObservation, startTrackingAttempt, updateAttemptLifecycle, attemptPhases, attemptNextAction, readSettings, writeSettings, linkAttemptWorktree, inspectProjectWorktrees, archiveWorktree, remindArchivedWorktree, removeArchivedWorktree } from "./state.js";
import { updateProgressSection } from "./handoff-update.js";

const LIFECYCLE = {
  clarify: "Use the best installed interview capability before implementation.",
  prototype: "Prototype only when a question needs a runnable answer.",
  split: "Keep small work in one context; publish a spec and dependency-ordered tickets for multi-session work.",
  implement: "Execute one ticket per fresh context.",
  review: "Review independently against both the specification and repository standards.",
};

function enrichAgents(agentNames) {
  // Resolve playbook agent names into full entries (file, tags, skills) from the registry.
  const registry = {};
  for (const a of loadJson(REGISTRY).agents) registry[a.name] = a;
  return agentNames.map((name) => {
    const a = registry[name];
    return a || { name, file: `agents/${name}.md`, tags: [], skills: [], missing: true };
  });
}

// Two-letter words are kept because this domain leans on them (ui, ux, ai, qa,
// db) — only genuine English filler is dropped.
const SHORT_FILLER = new Set(["a", "an", "as", "at", "by", "do", "go", "if", "in", "is", "it", "my", "no", "of", "on", "or", "so", "to", "up", "we"]);

function identityTokens(text) {
  return String(text || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !SHORT_FILLER.has(w));
}

function castAgents(agents, hostAgents) {
  // Cast each playbook role against agents actually installed on the host —
  // same agnostic contract as skills. Exact name match wins; otherwise a host
  // agent qualifies only when EVERY token of the role's name appears in its
  // name + description (precision over recall: a wrong cast silently misroutes
  // work, while a fallback is labeled and user-confirmable). Among qualifying
  // hosts, the widest overlap with the role's tags wins; ties break by name.
  // No match -> the kit's bundled default fills the role, labeled "fallback"
  // so it is never passed off as the user's own agent.
  const hosts = Object.values(hostAgents);
  return agents.map((agent) => {
    const exact = hostAgents[agent.name];
    let matched = exact || null;
    let score = 0;
    if (!matched) {
      const nameTokens = identityTokens(agent.name);
      const tagTokens = new Set((agent.tags || []).flatMap((tag) => identityTokens(tag)));
      for (const host of hosts) {
        const hostText = new Set(identityTokens(`${host.name} ${host.description}`));
        if (!nameTokens.length || !nameTokens.every((w) => hostText.has(w))) continue;
        const overlap = nameTokens.length + [...tagTokens].filter((w) => hostText.has(w)).length;
        if (overlap > score || (overlap === score && matched && host.name < matched.name)) {
          matched = host;
          score = overlap;
        }
      }
    }
    if (matched) return {
      ...agent,
      status: "installed",
      matched: matched.name,
      matched_description: matched.description || "",
      provider: matched.provider,
      source_path: matched.path,
      selection_reason: exact ? "installed agent with the same name" : `installed agent "${matched.name}" overlaps this role (${score})`,
    };
    return {
      ...agent,
      status: "fallback",
      selection_reason: "DIRF bundled default — no matching agent installed on this host",
    };
  });
}

function buildPlan(name, task, path, reservePercent = 5, compaction = null, focusedOutput = true, routing = {}) {
  const { selection, skillFlow, discovered, hostAgents, facts } = assembleTaskRouting(task, path, routing);
  const agents = castAgents(enrichAgents(selection.agents), hostAgents).map((agent) => ({
    ...agent,
    skills: resolveAgentSkills(agent.name, agent.skills, [], discovered).filter((skill) => skill.status === "installed"),
  }));
  const questions = [...(selection.questions || [])];
  if (agents.length && !Object.keys(hostAgents).length) {
    questions.unshift("No installed agents were found on this host. Use DIRF's bundled default agents for this workflow, or point DIRF at your own agents folder and re-run?");
  }
  const now = new Date().toISOString();
  return {
    schema_version: 5,
    name,
    task,
    playbook: selection.playbook,
    playbook_description: selection.playbook_description,
    score: selection.score,
    matched_keywords: selection.matched_keywords,
    alternates: selection.alternates,
    repository: repositoryIdentity(path),
    workflow: selection.workflow,
    routing_facts: facts,
    skill_flow: skillFlow,
    capability_gaps: skillFlow.gaps,
    agents,
    baseline_skills: [],
    questions,
    policy: "policies/workflow-policy.md",
    state: { status: "created", starts: 0 },
    created_at: now,
    source_hashes: {
      agents_registry: fileHash(REGISTRY),
      skills: fileHash(SKILLS),
      playbooks: folderHash(PLAYBOOK_DIR),
      policy: fileHash(POLICY),
    },
    lifecycle: LIFECYCLE,
    context_reserve_percent: reservePercent,
    compaction,
    focused_output: focusedOutput,
  };
}

function portableReference(value) {
  if (!value || typeof value !== "object") return value;
  const out = { ...value };
  if (!out.provider && (out.path || out.configured_in)) out.provider = providerForPath(out.path || out.configured_in);
  delete out.path;
  delete out.configured_in;
  return out;
}

function portablePlan(plan) {
  const out = structuredClone(plan);
  out.schema_version = 5;
  delete out.path;
  out.baseline_skills = (out.baseline_skills || []).map(portableReference);
  out.agents = (out.agents || []).map((agent) => {
    const portable = { ...agent, skills: (agent.skills || []).map(portableReference) };
    delete portable.source_path;
    return portable;
  });
  out.skill_flow.steps = (out.skill_flow.steps || []).map(portableReference);
  out.skill_flow.gaps = (out.skill_flow.gaps || []).map((gap) => ({
    ...gap,
    trusted_candidates: (gap.trusted_candidates || []).map(portableReference),
  }));
  out.capability_gaps = out.skill_flow.gaps;
  return out;
}

function assembleTaskRouting(task, path, options = {}) {
  const playbooks = loadPlaybooks();
  const errors = reconcile(playbooks);
  if (errors.length) throw new Error(`Task Routing reconciliation failed:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  const targetRoot = path ? (isAbsolute(path) ? path : resolve(process.cwd(), path)) : null;
  const facts = collectRoutingFacts(targetRoot);
  // Profile the target's stack so the router can prefer playbooks that build
  // software for the kind of app that's actually installed (web vs Electron vs
  // node). Null targetRoot or a non-Node repo yields an "unknown" profile and
  // routing degrades to today's keyword+facts behavior. Mirrors the
  // collectRoutingFacts null-guard above.
  const stack = detectStackProfile(targetRoot);
  let selection = recommend(task, facts, playbooks, stack);
  if (options.playbook) {
    const playbook = playbooks[options.playbook];
    if (!playbook) throw new Error(`Unknown playbook ${options.playbook}`);
    selection = {
      ...selection,
      playbook: options.playbook,
      playbook_description: playbook.description,
      workflow: playbook.workflow,
      skill_flow: playbook.skill_flow,
      agents: playbook.agents,
      questions: playbook.questions,
    };
  }
  if (options.planningOnly) {
    selection.workflow = {
      phases: [
        "resolve load-bearing decisions",
        "model domain language and durable decisions",
        ...(options.branches?.includes("research") ? ["research unresolved decisions against primary sources"] : []),
        "write the approved specification",
        "split the specification into dependency-ordered tickets",
        "write the execution handoff",
      ],
      output: "approved context, justified ADRs, a build-ready specification, dependency-ordered tickets, and an execution handoff",
      validation: "every ticket traces to the approved specification and every durable decision traces to context, an ADR, or cited research",
      recovery: "if a load-bearing decision remains unresolved, stop in discovery and record the blocker instead of producing speculative tickets",
    };
  }
  const discovered = enrichDiscovered(discover(targetRoot));
  const hostAgents = discoverAgents(targetRoot);
  const trustedSources = loadTrustedSources(targetRoot);
  const skillFlow = buildFlow(selection, { task, trustedSources, branches: options.branches }, discovered);
  if (options.planningOnly) {
    const planningStages = new Set(["discover", "model", "research", "specify", "slice", "handoff"]);
    skillFlow.steps = skillFlow.steps.filter((step) => planningStages.has(step.stage));
    skillFlow.gaps = skillFlow.gaps.filter((gap) => planningStages.has(gap.stage));
  }
  return { selection, discovered, hostAgents, facts, skillFlow };
}

function savePlan(plan, attempt) {
  const path = join(attempt.folder, "workflow.json");
  plan.attempt = { id: attempt.id, path: attempt.relativePath };
  writeFileSync(path, JSON.stringify(portablePlan(plan), null, 2), "utf-8");
  const handoff = join(attempt.folder, "HANDOFF.md");
  if (!existsSync(handoff)) writeFileSync(handoff, [
    "# DIRF Handoff", "",
    ...(plan.focused_output !== false ? [`> ${FOCUSED_OUTPUT_RULES.join(" ")}`, ""] : []),
    "## Objective", "", plan.task, "", "## Current phase", "", "_(not started)_", "",
    "## Completed", "", "- _(none yet)_", "", "## Decisions and assumptions", "", "- _(none yet)_", "",
    "## Changed files", "", "- _(none yet)_", "", "## Validation", "", "- _(not run)_", "",
    "## Blockers", "", "- _(none)_", "", "## Exact next action", "", "_(start the first workflow phase)_", "",
  ].join("\n"), "utf-8");
  return path;
}

function renderPlan(planPath, openBrowser = false, quiet = false) {
  const plan = JSON.parse(readFileSync(planPath, "utf-8"));
  const outDir = dirname(planPath);
  const written = buildInstructions(plan, outDir);
  const htmlPath = join(outDir, "instructions.html");
  writeFileSync(htmlPath, buildHtml(plan), "utf-8");
  written.push(htmlPath);
  if (!quiet) console.log(`Spec kit rendered: ${htmlPath}`);
  if (openBrowser) openBrowserAt(htmlPath);
  return htmlPath;
}

function openBrowserAt(filePath) {
  // Zero-dep cross-platform open. Uses the platform's native handler.
  const url = `file://${filePath.replace(/\\/g, "/")}`;
  const cmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
  console.log(`Opened: ${url}`);
}

function cmdBuild(args) {
  const target = projectRoot(args.path);
  const config = loadProjectConfig(target);
  const plan = buildPlan(args.name, args.task, target, config.context.reserve_percent, config.compaction, args.focusedOutput !== false);
  const attempt = createAttempt(target, args.name);
  const planPath = savePlan(plan, attempt);
  if (!args.json) console.log(`Attempt saved: ${attempt.id}`);
  renderPlan(planPath, args.open, args.json);
  if (args.json) console.log(JSON.stringify({ attempt: publicAttemptForSlug(resolveProject(target).slug, attempt), workflow: planPath }, null, 2));
}

function cmdPlan(args) {
  if (!args.name || !args.task) throw new Error('usage: dirf plan <name> "<task>" [--path DIR] [--research]');
  const target = projectRoot(args.path);
  const config = loadProjectConfig(target);
  const branches = ["multi-session", ...(args.research ? ["research"] : [])];
  const plan = buildPlan(args.name, args.task, target, config.context.reserve_percent, config.compaction, args.focusedOutput !== false, {
    playbook: "fullstack-feature",
    branches,
    planningOnly: true,
  });
  const attempt = createAttempt(target, args.name);
  const planPath = savePlan(plan, attempt);
  console.log(`Plan saved: ${attempt.id}`);
  console.log(`Lifecycle: ${plan.skill_flow.steps.map((step) => step.stage).join(" -> ")}`);
  renderPlan(planPath, args.open);
}

function cmdCreate(args) {
  const target = projectRoot(args.path);
  const config = loadProjectConfig(target);
  const plan = buildPlan(args.name, args.task, target, config.context.reserve_percent, config.compaction);
  const attempt = createAttempt(target, args.name);
  savePlan(plan, attempt);
  console.log(`Attempt saved: ${attempt.id}`);
  console.log(`Routed to playbook: ${plan.playbook} (score ${plan.score})`);
  const installed = (plan.agents || []).filter((agent) => agent.status === "installed");
  const fallback = (plan.agents || []).filter((agent) => agent.status === "fallback");
  if (installed.length) console.log(`Agents (installed): ${installed.map((agent) => agent.matched || agent.name).join(", ")}`);
  if (fallback.length) {
    console.log(`Agents (bundled defaults — no installed match for these roles): ${fallback.map((agent) => agent.name).join(", ")}`);
    if ((plan.questions || []).some((q) => q.startsWith("No installed agents were found"))) {
      console.log("No agents found on this host. DIRF will offer its bundled defaults as a backup — see the questions in the rendered workflow.");
    }
  }
}

function cmdRender(args) {
  const attempt = findAttempt(projectRoot(args.path), args.name);
  const planPath = join(attempt.folder, "workflow.json");
  if (!existsSync(planPath)) {
    console.error(`Attempt ${attempt.id} has no workflow.json`);
    process.exit(2);
  }
  renderPlan(planPath, args.open);
}

function publicAttemptForSlug(slug, attempt) {
  return {
    id: attempt.id,
    name: attempt.name,
    created_at: attempt.created_at,
    updated_at: attempt.updated_at || attempt.created_at,
    status: attempt.status || "historical",
    tracked: Boolean(attempt.tracked),
    current_phase: attempt.current_phase || null,
    phases: attemptPhases(slug, attempt.id),
    worker: attempt.worker || null,
    blocker: attempt.blocker || null,
    worktree_path: attempt.worktree_path || null,
    next_action: attemptNextAction(slug, attempt.id),
  };
}

function cmdList(args) {
  const attempts = listAttempts(projectRoot(args.path));
  const slug = resolveProject(projectRoot(args.path)).slug;
  if (args.json) { console.log(JSON.stringify(attempts.map((attempt) => publicAttemptForSlug(slug, attempt)), null, 2)); return; }
  if (!attempts.length) { console.log("(no attempts saved)"); return; }
  console.log("Saved attempts:");
  for (const attempt of attempts) console.log(`  - ${attempt.id}  ${attempt.name}`);
}

function gitOutput(target, args) {
  try {
    return execFileSync("git", ["-C", target, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function cmdStatus(args) {
  const target = projectRoot(args.path);
  let attempts = [];
  let configured = true;
  try { loadProjectConfig(target); attempts = listAttempts(target); }
  catch { configured = false; }

  const branch = gitOutput(target, ["branch", "--show-current"]);
  const changes = gitOutput(target, ["status", "--porcelain"]).split(/\r?\n/).filter(Boolean);
  const aheadBehind = gitOutput(target, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]).split(/\s+/).map(Number);

  console.log("DIRF status");
  console.log(`Target: ${target}`);
  console.log(`Configured: ${configured ? "yes" : "no"}`);
  console.log(`Attempts: ${attempts.length}`);
  if (attempts.length) console.log(`Latest: ${attempts.at(-1).id}`);
  if (!branch) {
    console.log("Repository: not a Git repository");
    return;
  }
  console.log(`Repository: ${branch} (${changes.length ? `${changes.length} changed path(s)` : "clean"})`);
  if (aheadBehind.length === 2 && aheadBehind.every(Number.isFinite)) {
    console.log(`Upstream: ${aheadBehind[0]} ahead, ${aheadBehind[1]} behind`);
  }
}

function cmdResume(args) {
  const attempt = findAttempt(projectRoot(args.path), args.name);
  const project = resolveProject(projectRoot(args.path));
  const readme = join(attempt.folder, "README.md");
  const workflow = existsSync(readme) ? readme : join(attempt.folder, "workflow.json");
  const handoff = join(attempt.folder, "HANDOFF.md");
  if (!existsSync(handoff)) throw new Error(`Attempt ${attempt.id} has no HANDOFF.md; rebuild it before resuming.`);
  if (args.json) {
    const prompt = `Resume DIRF attempt "${attempt.id}" for "${project?.slug || "project"}" at "${args.path || projectRoot(args.path)}".\nFirst load the canonical project handoff, then load this attempt's workflow and handoff.\nCanonical project state takes precedence if they conflict.\nContinue from the exact next action; do not restart completed work.`;
    console.log(JSON.stringify({ attempt: publicAttemptForSlug(project.slug, attempt), workflow_path: workflow, attempt_handoff: readFileSync(handoff, "utf8"), project_handoff: readHandoff(project.slug), resume_prompt: prompt }, null, 2));
    return;
  }
  console.log(`Resume attempt: ${attempt.id}`);
  console.log(`Load workflow: ${workflow}`);
  console.log(`Load handoff: ${handoff}\n`);
  console.log(readFileSync(handoff, "utf-8"));
}

function cmdMigrate(name, target) {
  const root = projectRoot(target);
  const attempts = name ? [findAttempt(root, name)] : listAttempts(root);
  const snapshots = attempts.map((attempt) => ({ attempt, path: join(attempt.folder, "workflow.json") })).filter(({ path }) => existsSync(path));
  let migrated = 0;
  for (const { attempt, path } of snapshots) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8"));
      parsed.attempt ??= { id: attempt.id, path: attempt.relativePath };
      parsed.lifecycle ??= LIFECYCLE;
      const plan = portablePlan(parsed);
      writeFileSync(path, JSON.stringify(plan, null, 2), "utf-8");
      if (existsSync(join(dirname(path), "README.md"))) renderPlan(path);
      migrated += 1;
    } catch (error) {
      console.error(`Failed to migrate ${attempt.id}: ${error.message}`);
    }
  }
  console.log(`Migrated ${migrated} workflow snapshot(s) to portable schema version 5.`);
}

function cmdSetup(args) {
  const target = args._[0] || args.path || ".";
  const result = setupProject(target, { tracker: args.tracker, context: args.context, reservePercent: args.reservePercent });
  console.log(`DIRF configured: ${result.root}`);
  console.log(result.created.length ? `Created: ${result.created.join(", ")}` : "Already configured; no files changed.");
  const discovered = enrichDiscovered(discover(result.root));
  const gaps = findCapabilityGaps(loadPlaybooks(), discovered);
  console.log(`Detected ${Object.keys(discovered).length} installed skills; no skills were installed.`);
  if (gaps.length) console.log(`Capability gaps: ${gaps.map((gap) => gap.capability).join(", ")}`);
  else console.log("Capability gaps: none.");
}

function cmdValidate() {
  validateMain();
}

function folderGraph(target) {
  const absolute = resolve(target);
  return resolveGraph(absolute, { allowedRoots: [ROOT, dirname(absolute)] });
}

function cmdFolderValidate(target) {
  const units = folderGraph(target);
  console.log(`Folder validation passed: ${units.length} unit(s)`);
}

function cmdGraph(target) {
  console.log(graphLines(folderGraph(target)).join("\n"));
}

function cmdRun(target, focusedOutput = true) {
  const units = folderGraph(target);
  console.log("Execution order:");
  console.log(graphLines(units).join("\n"));
  console.log("\nExecution handoff:");
  for (const unit of units) console.log(`Read ${join(unit.folder, "README.md")}.`);
  console.log(`Execute ${join(resolve(target), "README.md")} as the root operating workflow.`);
  if (focusedOutput) console.log(`Focused output: ${FOCUSED_OUTPUT_RULES.join(" ")}`);
}

function cmdFolderRender(target) {
  const units = folderGraph(target);
  const output = join(resolve(target), "instructions.html");
  writeFileSync(output, renderFolderHtml(units), "utf-8");
  console.log(`Folder rendered: ${output}`);
}

function cmdSkillsScan(args) {
  const scanRoot = args.path ? (isAbsolute(args.path) ? args.path : resolve(process.cwd(), args.path)) : null;
  const idx = discover(scanRoot);
  console.log(`Discovered ${Object.keys(idx).length} installed skills across scanned roots.`);
  const agentIdx = discoverAgents(scanRoot);
  const agentNames = Object.keys(agentIdx);
  console.log(`Discovered ${agentNames.length} installed agents${agentNames.length ? `: ${agentNames.slice(0, 12).join(", ")}${agentNames.length > 12 ? ", …" : ""}` : " — DIRF will offer its bundled defaults as a backup."}`);
  console.log("\nRegistry references resolved:");
  for (const ref of loadRegistry().skills || []) {
    const hit = idx[ref.name];
    const status = hit ? "installed" : "recommended (not installed)";
    const loc = hit ? ` -> ${hit.path}` : "";
    console.log(`  ${ref.name.padEnd(24)} ${status}${loc}`);
  }
}

function cmdExportPlaybooks() {
  writeFileSync(PLAYBOOKS, JSON.stringify(loadPlaybooks(), null, 2) + "\n", "utf-8");
  console.log(`Compatibility playbook JSON exported: ${PLAYBOOKS}`);
}

function resolveStateSlug(args) {
  if (args.slug) return args.slug;
  const target = projectRoot(args.path || ".");
  const resolved = resolveProject(target);
  if (!resolved) {
    throw new Error(`DIRF has no project registered for ${target}. Run: dirf setup "${target}"`);
  }
  return resolved.slug;
}

function cmdStateWhich(args) {
  const target = projectRoot(args.path || ".");
  const resolved = resolveProject(target);
  if (!resolved) { console.log(`(no project registered for ${target})`); return; }
  console.log(`${resolved.slug}  ->  ${storeProjectDir(resolved.slug)}`);
}

function cmdStateList(args = {}) {
  const projects = listProjects();
  if (args.json) { console.log(JSON.stringify(projects, null, 2)); return; }
  if (!projects.length) { console.log("(no projects registered)"); return; }
  console.log("Registered projects:");
  for (const p of projects) console.log(`  ${p.slug}   last_seen ${p.last_seen}   ${p.name}`);
}

function cmdStateRegister(args) {
  const target = projectRoot(args.path || args._[0] || ".");
  const { slug, isNew } = registerProject(target);
  console.log(isNew ? `Registered: ${slug}` : `Already registered: ${slug}`);
  console.log(`  ${storeProjectDir(slug)}`);
}

function cmdStateReadHandoff(args) {
  const slug = resolveStateSlug(args);
  const md = readHandoff(slug);
  if (md === null) { console.error(`No HANDOFF.md for ${slug}`); process.exitCode = 1; return; }
  process.stdout.write(md);
}

function cmdStateWriteHandoff(args) {
  const slug = resolveStateSlug(args);
  let md;
  if (args.file === "-") {
    md = readFileSync(0, "utf8"); // stdin
  } else if (args.file) {
    md = readFileSync(args.file, "utf8");
  } else {
    console.error("usage: dirf state write-handoff [--path DIR|--slug S] --file FILE|-");
    process.exitCode = 2; return;
  }
  writeHandoff(slug, md);
  console.log(`Wrote canonical handoff for ${slug}`);
}

function cmdStateListAttempts(args) {
  const slug = resolveStateSlug(args);
  const attempts = listAttemptsState(slug);
  if (args.json) { console.log(JSON.stringify(attempts.map((attempt) => publicAttemptForSlug(slug, attempt)), null, 2)); return; }
  if (!attempts.length) { console.log("(no attempts saved)"); return; }
  console.log("Saved attempts:");
  for (const a of attempts) console.log(`  - ${a.id}  ${a.name}`);
}

function cmdStateGetAttempt(args) {
  const slug = resolveStateSlug(args);
  const id = args._[0];
  if (!id) { console.error("usage: dirf state get-attempt <id> [--path DIR|--slug S]"); process.exitCode = 2; return; }
  const a = getAttemptState(slug, id);
  if (args.json) { console.log(JSON.stringify(publicAttemptForSlug(slug, a), null, 2)); return; }
  console.log(`id: ${a.id}`);
  console.log(`name: ${a.name}`);
  console.log(`created_at: ${a.created_at}`);
  console.log(`folder: ${a.folder}`);
}

function cmdAttempt(args) {
  const slug = resolveStateSlug(args);
  const action = args._[0];
  const id = args._[1];
  if (!action || !id) throw new Error("usage: dirf attempt <start-tracking|start|assign|advance|block|reopen|complete|link> <id> [options]");
  let result;
  if (action === "start-tracking") result = startTrackingAttempt(slug, id);
  else if (action === "link") result = linkAttemptWorktree(slug, id, args.worktree);
  else result = updateAttemptLifecycle(slug, id, action, { worker: args.worker, reason: args.reason || args._[2], confirm: args.confirm });
  console.log(args.json ? JSON.stringify(publicAttemptForSlug(slug, result), null, 2) : `Updated ${result.id}: ${result.status}`);
}

function cmdSettings(args) {
  if (args._[0] === "get") { console.log(JSON.stringify(readSettings(), null, 2)); return; }
  if (args._[0] !== "set") throw new Error("usage: dirf settings <get|set> [options]");
  const patch = {};
  if (args.staleDays !== undefined) patch.stale_worktree_days = args.staleDays;
  if (args.archiveReminderDays !== undefined) patch.archive_reminder_days = args.archiveReminderDays;
  if (args.dirfCliPath !== undefined) patch.dirf_cli_path = args.dirfCliPath;
  console.log(JSON.stringify(writeSettings(patch), null, 2));
}

function cmdWorktree(args) {
  const slug = resolveStateSlug(args);
  const action = args._[0];
  const path = args.worktree || args._[1];
  let result;
  if (action === "list") result = inspectProjectWorktrees(slug);
  else if (action === "archive") result = archiveWorktree(slug, path);
  else if (action === "remind") result = remindArchivedWorktree(slug, path);
  else if (action === "remove") result = removeArchivedWorktree(slug, path, { approved: args.approved });
  else throw new Error("usage: dirf worktree <list|archive|remind|remove> [path]");
  console.log(JSON.stringify(result, null, 2));
}

function cmdStateImportHandoff(args) {
  const target = projectRoot(args.path || ".");
  // Resolve the slug WITHOUT tripping the newer-local-HANDOFF conflict check that
  // resolveProject would surface — import-handoff is the RESOLUTION of that
  // conflict, so it must reach the promotion step even from the conflict state.
  // registerProject is idempotent and never throws on handoff conflicts.
  const slug = args.slug || registerProject(target).slug;
  if (!slug) throw new Error(`DIRF has no project registered for ${target}. Run: dirf setup "${target}"`);
  if (!args.force) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`Promote local HANDOFF.md into the store for ${slug}? [y/N] `, (answer) => {
      rl.close();
      if (!/^y/i.test(answer.trim())) { console.log("aborted"); return; }
      importHandoff(target, slug, { force: true });
      console.log(`Promoted local HANDOFF.md for ${slug}`);
    });
  } else {
    importHandoff(target, slug, { force: true });
    console.log(`Promoted local HANDOFF.md for ${slug}`);
  }
}

function cmdStateMigrateCleanup(args) {
  const target = projectRoot(args.path || ".");
  const { removed } = migrateCleanup(target);
  console.log(removed ? `Removed ${removed} migration backup(s) under ${target}` : "No migration backups to remove.");
}

// `dirf notice` — a non-derailing side-observation channel. Park anything NOT
// the current task (a side bug, a doc staleness, a "fix later") without acting
// on it or polluting HANDOFF.md. Default target: the current attempt.
function resolveNoticeSlug(args) {
  // Resolve slug for a notice op. Reuses the state slug-resolution path.
  if (args.slug) return args.slug;
  const target = projectRoot(args.path || ".");
  const resolved = resolveProject(target);
  if (!resolved) throw new Error(`DIRF has no project registered for ${target}. Run: dirf setup "${target}"`);
  return resolved.slug;
}

function cmdNoticeAppend(args, text) {
  const slug = resolveNoticeSlug(args);
  const opts = {};
  if (args.project) opts.project = true;
  if (args.attempt) opts.attemptId = args.attempt;
  const { n, ts, file } = appendObservation(slug, text, opts);
  const scope = args.project ? "project" : (args.attempt || "current attempt");
  console.log(`Noted #${n} (${scope}) at ${ts}`);
  console.log(`  ${text}`);
}

function cmdNoticeList(args) {
  const slug = resolveNoticeSlug(args);
  const opts = {};
  if (args.project) opts.project = true;
  if (args.attempt) opts.attemptId = args.attempt;
  const entries = listObservations(slug, opts);
  const scope = args.project ? "project" : (args.attempt || "current attempt");
  if (!entries.length) { console.log(`(no observations for ${scope})`); return; }
  console.log(`Observations (${scope}):`);
  for (const e of entries) console.log(`  ${e.n}. ${e.ts} — ${e.text}`);
}

function cmdNoticePromote(args, entryN) {
  const slug = resolveNoticeSlug(args);
  const opts = {};
  if (args.attempt) opts.attemptId = args.attempt;
  const n = Number(entryN);
  if (!Number.isInteger(n) || n < 1) { console.error("usage: dirf notice promote <N> [--attempt ID]"); process.exitCode = 2; return; }
  const { promoted, from, text } = promoteObservation(slug, n, opts);
  console.log(`Promoted #${promoted} from ${from} to project-level.`);
  console.log(`  ${text}`);
}

function cmdRecordProgress(args) {
  const message = args._.join(" ") || "Progress made";
  const target = projectRoot(args.path);

  try {
    const project = resolveProject(target);
    if (!project) {
      throw new Error(`DIRF is not configured for ${target}. Run: dirf setup "${target}"`);
    }

    // Read current handoff
    const currentHandoff = readHandoff(project.slug);
    if (currentHandoff === null) {
      console.log("Note: No existing handoff - creating initial handoff with progress");
    }

    // Build update
    const timestamp = args.timestamp || new Date().toISOString();
    const updateData = {
      message,
      timestamp,
      phase: args.phase || null,
      next: args.next || "Continue work",
      files: args.files ? args.files.split(",") : []
    };

    // Apply update
    const updatedHandoff = updateProgressSection(currentHandoff || "# DIRF Handoff\n\n## Objective\n\n(Work in progress)\n", updateData);

    // Write back atomically
    writeHandoff(project.slug, updatedHandoff);

    console.log("✅ Progress recorded:");
    console.log(`   ${message}`);
    if (updateData.phase) console.log(`   Phase: ${updateData.phase}`);
    console.log(`   Next: ${updateData.next}`);

  } catch (error) {
    console.error(`Failed to record progress: ${error.message}`);
    process.exitCode = 1;
  }
}

function parse(argv) {
  const [cmd, ...rest] = argv;
  const out = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--path") { out.path = rest[++i]; continue; }
    if (a === "--tracker") { out.tracker = rest[++i]; continue; }
    if (a === "--context") { out.context = rest[++i]; continue; }
    if (a === "--reserve-percent") { out.reservePercent = Number(rest[++i]); continue; }
    if (a === "--open") { out.open = true; continue; }
    if (a === "--file") { out.file = rest[++i]; continue; }
    if (a === "--force") { out.force = true; continue; }
    if (a === "--project") { out.project = true; continue; }
    if (a === "--slug") { out.slug = rest[++i]; continue; }
    if (a === "--attempt") { out.attempt = rest[++i]; continue; }
    if (a === "--worker") { out.worker = rest[++i]; continue; }
    if (a === "--reason") { out.reason = rest[++i]; continue; }
    if (a === "--worktree") { out.worktree = rest[++i]; continue; }
    if (a === "--stale-days") { out.staleDays = Number(rest[++i]); continue; }
    if (a === "--archive-reminder-days") { out.archiveReminderDays = Number(rest[++i]); continue; }
    if (a === "--dirf-cli") { out.dirfCliPath = rest[++i]; continue; }
    if (a === "--confirm") { out.confirm = true; continue; }
    if (a === "--approved") { out.approved = true; continue; }
    if (a === "--json") { out.json = true; continue; }
    if (a === "--research") { out.research = true; continue; }
    if (a === "--no-focused-output") { out.focusedOutput = false; continue; }
    if (a === "--phase") { out.phase = rest[++i]; continue; }
    if (a === "--next") { out.next = rest[++i]; continue; }
    if (a === "--files") { out.files = rest[++i]; continue; }
    if (a === "--timestamp") { out.timestamp = rest[++i]; continue; }
    if (a === "--help" || a === "-h") { out.help = true; continue; }
    out._.push(a);
  }
  return { cmd, args: out };
}

const HELP = `amf-dirf — Agent Spec Kit (Do It Right First)

Usage:
  dirf setup [path] [--tracker local] [--context single|multi] [--reserve-percent 5]
  dirf build  <name> "<task>" [--path DIR] [--open] [--no-focused-output]
  dirf plan   <name> "<task>" [--path DIR] [--research] [--open] [--no-focused-output]
  dirf create <name> "<task>" [--path DIR]             JSON only
  dirf render <name-or-id> [--path DIR] [--open]       re-render an attempt
  dirf validate <folder>                              validate a folder DAG
  dirf graph <folder>                                 print ordered folder DAG
  dirf run <folder> [--no-focused-output]             print deterministic execution handoff
  dirf list [--path DIR]                               list saved attempts
  dirf status [--path DIR]                             show project and repository state
  dirf resume <name-or-id> [--path DIR]                load the workflow handoff
  dirf record-progress "<message>" [--path DIR] [--phase PHASE] [--next ACTION] [--files FILES]
                                                      record workflow progress and update HANDOFF.md
  dirf attempt <action> <id> [--path DIR]              update lifecycle state
  dirf worktree <list|archive|remind|remove> [path]   inspect or clean worktrees
  dirf settings <get|set>                              read or update cleanup settings
  dirf migrate [<name>]                                remove runtime paths from saved snapshots
  dirf validate                                        validate registries
  dirf skills scan [--path DIR]                        show installed skills
  dirf export playbooks                                regenerate legacy playbooks JSON
  dirf inspect [<path>]                                detect a project's optimization stack + suggest gaps
  dirf flow "<task>" [--path DIR]                      show the ordered skill flow for a task (ask-matt style)
  dirf state which [--path DIR]                       what project am I in? (slug + store path)
  dirf state list                                      list all registered projects
  dirf state register [--path DIR]                    register a project explicitly
  dirf state read-handoff [--path DIR|--slug S]       print the canonical handoff
  dirf state write-handoff --file FILE|- [...]        write the canonical handoff
  dirf state list-attempts [--path DIR|--slug S]      list attempts for a project
  dirf state get-attempt <id> [...]                   show one attempt
  dirf state import-handoff [--path DIR] [--force]    promote a local HANDOFF.md into the store
  dirf state migrate-cleanup [--path DIR]            remove migration backup(s) after confirming the store works

Side observations (park non-task notes without derailing):
  dirf notice "<text>"                                log an observation to the current attempt
  dirf notice "<text>" --attempt <id|name>           log to a specific attempt
  dirf notice "<text>" --project                      log to the project-level list (survives sessions)
  dirf notice list [--project|--attempt <id>]         read observations back
  dirf notice promote <N>                             copy entry N from current attempt to project-level

Plain language (natural-English aliases for the same commands):
  dirf where am i                                     → state which
  dirf show me the projects                           → state list
  dirf show me the handoff                            → state read-handoff
  dirf show me the attempts                           → state list-attempts
  dirf save the handoff --file FILE                   → state write-handoff --file FILE
  dirf start work on "<task>"                         → build <auto-name> "<task>"
  (dirf plan is a real lifecycle command, not an alias — use 'dirf flow' to preview)
  dirf what can i do                                  → this help
`;

function cmdFlow(args) {
  const task = args._.join(" ");
  if (!task) { console.error("usage: dirf flow \"<task>\" [--path DIR]"); process.exit(2); }
  const { skillFlow: flow } = assembleTaskRouting(task, projectRoot(args.path));
  console.log(`Flow: ${flow.label}`);
  console.log(`Playbook: ${flow.playbook}${flow.branches.length ? ` (branches: ${flow.branches.join(", ")})` : ""}\n`);
  let lastStage = "";
  for (const s of flow.steps) {
    if (s.stage !== lastStage) { console.log(`\n[${s.stage}]`); lastStage = s.stage; }
    const mark = s.status === "installed" ? "✅" : "⚠️";
    const note = s.status === "installed" ? "" : " (recommended — not installed)";
    console.log(`  ${mark} ${s.skill}${note}`);
    console.log(`      ${s.reason}`);
  }
}

function cmdInspect(args) {
  const target = args._[0] || args.path || ".";
  const { findings, suggestions, summary } = inspect(target);
  console.log(`Inspected: ${target}`);
  console.log(`Summary: ${summary}\n`);

  // group findings by category
  const byCat = {};
  for (const f of findings) (byCat[f.category] ||= []).push(f);
  for (const [cat, items] of Object.entries(byCat)) {
    console.log(`[${cat}]`);
    for (const f of items) console.log(`  ✅ ${f.item} — ${f.path}`);
    console.log("");
  }

  if (suggestions.length) {
    console.log("Suggestions (deterministic — based on detected gaps):");
    for (const s of suggestions) {
      console.log(`\n  [${s.priority}] ${s.gap}`);
      console.log(`      → ${s.suggestion}`);
    }
  } else {
    console.log("No gaps detected — the optimization stack looks complete.");
  }
}

// Natural-language aliases — plain-English entry points that rewrite to the
// canonical command form. Pure sugar over the existing surface: no new logic,
// no parallel handlers. Keep phrases unambiguous and don't collide with the
// real command verbs (setup/build/state/...). Anything unrecognized falls
// through to normal dispatch (and errors there if truly unknown).
function plainName(task) {
  // Short, filesystem-safe name from a task sentence, for `start work on`.
  return String(task || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "task";
}

function translatePlainLanguage(argv) {
  if (!argv.length) return argv;
  const joined = argv.join(" ");
  // Each phrase: match the leading words, return a rewritten canonical argv.
  // Order longest-first where prefixes could overlap.
  if (joined.startsWith("where am i")) return ["state", "which", ...argv.slice(3)];
  if (joined.startsWith("show me the projects")) return ["state", "list", ...argv.slice(4)];
  if (joined.startsWith("show me the handoff")) return ["state", "read-handoff", ...argv.slice(4)];
  if (joined.startsWith("show me the attempts")) return ["state", "list-attempts", ...argv.slice(4)];
  if (joined.startsWith("save the handoff")) return ["state", "write-handoff", ...argv.slice(3)];
  // NOTE: a plain-language `plan` alias is intentionally omitted — `dirf plan`
  // is a real lifecycle command (create a planning attempt with --research).
  // Use `dirf flow "<task>"` to preview the routed skill flow.
  if (joined.startsWith("start work on ")) {
    // Auto-generate a name from the task so the user doesn't have to.
    const task = argv.slice(3).join(" ");
    return ["build", plainName(task), task];
  }
  if (joined.startsWith("what can i do") || joined === "help me") return ["--help"];
  return argv;
}

function main() {
  const argv = translatePlainLanguage(process.argv.slice(2));
  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") { console.log(HELP); return; }
  const { cmd, args } = parse(argv);
  if (args.help) { console.log(HELP); return; }

  if (cmd === "setup") cmdSetup(args);
  else if (cmd === "build") { args.name = args._[0]; args.task = args._.slice(1).join(" "); cmdBuild(args); }
  else if (cmd === "plan") { args.name = args._[0]; args.task = args._.slice(1).join(" "); cmdPlan(args); }
  else if (cmd === "create") { args.name = args._[0]; args.task = args._.slice(1).join(" "); cmdCreate(args); }
  else if (cmd === "render") {
    const target = args._[0];
    const explicitFolder = target && !args.path && (isAbsolute(target) || target.startsWith(".") || /[\\/]/.test(target));
    if (explicitFolder && existsSync(resolve(target))) cmdFolderRender(target);
    else { args.name = target; cmdRender(args); }
  }
  else if (cmd === "list") cmdList(args);
  else if (cmd === "status") cmdStatus(args);
  else if (cmd === "resume") { args.name = args._[0]; cmdResume(args); }
  else if (cmd === "record-progress") { cmdRecordProgress(args); }
  else if (cmd === "migrate") cmdMigrate(args._[0], args.path);
  else if (cmd === "validate") args._[0] ? cmdFolderValidate(args._[0]) : cmdValidate();
  else if (cmd === "graph") cmdGraph(args._[0]);
  else if (cmd === "run") cmdRun(args._[0], args.focusedOutput !== false);
  else if (cmd === "skills") {
    const sub = args._[0];
    if (sub === "scan") cmdSkillsScan(args);
    else { console.log("usage: dirf skills scan [--path DIR]"); process.exit(2); }
  }
  else if (cmd === "export" && args._[0] === "playbooks") cmdExportPlaybooks();
  else if (cmd === "inspect") { args._ = args._.length ? args._ : [args.path]; cmdInspect(args); }
  else if (cmd === "flow") { cmdFlow(args); }
  else if (cmd === "state") {
    const sub = args._[0];
    const subArgs = { ...args, _: args._.slice(1) };
    if (sub === "which") cmdStateWhich(subArgs);
    else if (sub === "list") cmdStateList(subArgs);
    else if (sub === "register") cmdStateRegister(subArgs);
    else if (sub === "read-handoff") cmdStateReadHandoff(subArgs);
    else if (sub === "write-handoff") cmdStateWriteHandoff(subArgs);
    else if (sub === "list-attempts") cmdStateListAttempts(subArgs);
    else if (sub === "get-attempt") cmdStateGetAttempt(subArgs);
    else if (sub === "import-handoff") cmdStateImportHandoff(subArgs);
    else if (sub === "migrate-cleanup") cmdStateMigrateCleanup(subArgs);
    else { console.error(`unknown state subcommand: ${sub}\n\n${HELP}`); process.exit(2); }
  }
  else if (cmd === "notice") {
    // dirf notice "<text>"            -> append to current attempt
    // dirf notice list [--project]    -> list observations
    // dirf notice promote <N>         -> lift entry N to project level
    const sub = args._[0];
    if (sub === "list") cmdNoticeList(args);
    else if (sub === "promote") {
      const entryN = args._[1];
      if (!entryN) { console.error("usage: dirf notice promote <N> [--attempt ID]"); process.exit(2); }
      cmdNoticePromote(args, entryN);
    }
    else {
      // Everything else is the observation text (so multi-word notes work
      // without quotes: `dirf notice Sidebar still uses text-white`).
      const text = args._.join(" ");
      if (!text) { console.error('usage: dirf notice "<text>" [--attempt ID | --project]'); process.exit(2); }
      cmdNoticeAppend(args, text);
    }
  }
  else if (cmd === "attempt") cmdAttempt(args);
  else if (cmd === "settings") cmdSettings(args);
  else if (cmd === "worktree") cmdWorktree(args);
  else { console.error(`unknown command: ${cmd}\n\n${HELP}`); process.exit(2); }
}

try { main(); }
catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
