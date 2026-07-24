#!/usr/bin/env node
// amf-dirf — Agent Spec Kit (Do It Right First). Unified CLI. Node built-ins only.
//
//   dirf setup [path] [--reserve-percent N]              configure a target repository
//   dirf build  <name> "<task>" [--path DIR] [--open] [--no-focused-output]
//   dirf create <name> "<task>" [--path DIR]             route -> attempt workflow JSON only
//   dirf render <name-or-id> [--path DIR] [--open]       render the latest matching attempt
//   dirf list [--path DIR]                               list saved attempts
//   dirf resume <name-or-id> [--path DIR]                load the workflow handoff
//   dirf validate                                        validate registries + workflows
//   dirf skills scan [--path DIR]                        scan host, print installed skills + resolved refs
//   dirf validate|graph|run|render <folder>               operate an Eve-style folder DAG
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, isAbsolute, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { ROOT, REGISTRY, SKILLS, PLAYBOOKS, PLAYBOOK_DIR, POLICY, fileHash, folderHash, loadJson } from "./paths.js";
import { collectRoutingFacts, loadPlaybooks, recommend } from "./router.js";
import { discover, discoverAgents, enrichDiscovered, loadRegistry, loadTrustedSources, providerForPath, resolveAgentSkills } from "./skills.js";
import { FOCUSED_OUTPUT_RULES, buildInstructions, buildHtml } from "./renderer.js";
import { main as validateMain } from "./validate.js";
import { inspect } from "./inspect.js";
import { buildFlow, findCapabilityGaps, reconcile } from "./flow.js";
import { graphLines, renderFolderHtml, resolveGraph } from "./folders.js";
import { createAttempt, findAttempt, listAttempts, loadProjectConfig, projectRoot, repositoryIdentity, setupProject } from "./project.js";

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

function buildPlan(name, task, path, reservePercent = 5, focusedOutput = true) {
  const { selection, skillFlow, discovered, hostAgents, facts } = assembleTaskRouting(task, path);
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

function assembleTaskRouting(task, path) {
  const playbooks = loadPlaybooks();
  const errors = reconcile(playbooks);
  if (errors.length) throw new Error(`Task Routing reconciliation failed:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  const targetRoot = path ? (isAbsolute(path) ? path : resolve(process.cwd(), path)) : null;
  const facts = collectRoutingFacts(targetRoot);
  const selection = recommend(task, facts, playbooks);
  const discovered = enrichDiscovered(discover(targetRoot));
  const hostAgents = discoverAgents(targetRoot);
  const trustedSources = loadTrustedSources(targetRoot);
  return { selection, discovered, hostAgents, facts, skillFlow: buildFlow(selection, { task, trustedSources }, discovered) };
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

function renderPlan(planPath, openBrowser = false) {
  const plan = JSON.parse(readFileSync(planPath, "utf-8"));
  const outDir = dirname(planPath);
  const written = buildInstructions(plan, outDir);
  const htmlPath = join(outDir, "instructions.html");
  writeFileSync(htmlPath, buildHtml(plan), "utf-8");
  written.push(htmlPath);
  console.log(`Spec kit rendered: ${htmlPath}`);
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
  const plan = buildPlan(args.name, args.task, target, config.context.reserve_percent, args.focusedOutput !== false);
  const attempt = createAttempt(target, args.name);
  const planPath = savePlan(plan, attempt);
  console.log(`Attempt saved: ${attempt.id}`);
  renderPlan(planPath, args.open);
}

function cmdCreate(args) {
  const target = projectRoot(args.path);
  const config = loadProjectConfig(target);
  const plan = buildPlan(args.name, args.task, target, config.context.reserve_percent);
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

function cmdList(args) {
  const attempts = listAttempts(projectRoot(args.path));
  if (!attempts.length) { console.log("(no attempts saved)"); return; }
  console.log("Saved attempts:");
  for (const attempt of attempts) console.log(`  - ${attempt.id}  ${attempt.name}`);
}

function cmdResume(args) {
  const attempt = findAttempt(projectRoot(args.path), args.name);
  const readme = join(attempt.folder, "README.md");
  const workflow = existsSync(readme) ? readme : join(attempt.folder, "workflow.json");
  const handoff = join(attempt.folder, "HANDOFF.md");
  if (!existsSync(handoff)) throw new Error(`Attempt ${attempt.id} has no HANDOFF.md; rebuild it before resuming.`);
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
    if (a === "--no-focused-output") { out.focusedOutput = false; continue; }
    if (a === "--help" || a === "-h") { out.help = true; continue; }
    out._.push(a);
  }
  return { cmd, args: out };
}

const HELP = `amf-dirf — Agent Spec Kit (Do It Right First)

Usage:
  dirf setup [path] [--tracker local] [--context single|multi] [--reserve-percent 5]
  dirf build  <name> "<task>" [--path DIR] [--open] [--no-focused-output]
  dirf create <name> "<task>" [--path DIR]             JSON only
  dirf render <name-or-id> [--path DIR] [--open]       re-render an attempt
  dirf validate <folder>                              validate a folder DAG
  dirf graph <folder>                                 print ordered folder DAG
  dirf run <folder> [--no-focused-output]             print deterministic execution handoff
  dirf list [--path DIR]                               list saved attempts
  dirf resume <name-or-id> [--path DIR]                load the workflow handoff
  dirf migrate [<name>]                                remove runtime paths from saved snapshots
  dirf validate                                        validate registries
  dirf skills scan [--path DIR]                        show installed skills
  dirf export playbooks                                regenerate legacy playbooks JSON
  dirf inspect [<path>]                                detect a project's optimization stack + suggest gaps
  dirf flow "<task>" [--path DIR]                      show the ordered skill flow for a task (ask-matt style)
`;

function cmdFlow(args) {
  const task = args._.join(" ");
  if (!task) { console.error("usage: dirf flow \"<task>\" [--path DIR]"); process.exit(2); }
  const { skillFlow: flow } = assembleTaskRouting(task, args.path || null);
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

function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === "--help" || argv[0] === "-h") { console.log(HELP); return; }
  const { cmd, args } = parse(argv);
  if (args.help) { console.log(HELP); return; }

  if (cmd === "setup") cmdSetup(args);
  else if (cmd === "build") { args.name = args._[0]; args.task = args._.slice(1).join(" "); cmdBuild(args); }
  else if (cmd === "create") { args.name = args._[0]; args.task = args._.slice(1).join(" "); cmdCreate(args); }
  else if (cmd === "render") {
    const target = args._[0];
    const explicitFolder = target && !args.path && (isAbsolute(target) || target.startsWith(".") || /[\\/]/.test(target));
    if (explicitFolder && existsSync(resolve(target))) cmdFolderRender(target);
    else { args.name = target; cmdRender(args); }
  }
  else if (cmd === "list") cmdList(args);
  else if (cmd === "resume") { args.name = args._[0]; cmdResume(args); }
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
  else { console.error(`unknown command: ${cmd}\n\n${HELP}`); process.exit(2); }
}

try { main(); }
catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
