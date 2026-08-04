// Project inspection: detect a project's AI-work optimization stack.
// Node built-ins only. Deterministic — same project always yields the same result.
//
// Detects: framework/stack, memory systems, knowledge graphs, task tracking,
// planning methodology, AI agent hosts, context-reducer skills, deployment,
// MCP servers, and git-worktree usage. Then produces deterministic suggestions
// for what's missing that would complement the detected setup.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// --------------------------------------------------------------------------- //
// Helpers
// --------------------------------------------------------------------------- //
function isDir(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}
function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}
function has(p) { return existsSync(p); }
function dirNames(p) {
  try { return new Set(readdirSync(p).filter((f) => isDir(join(p, f)))); } catch { return new Set(); }
}
function readJson(path) {
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
}

// --------------------------------------------------------------------------- //
// Detection rules — each returns a list of findings: { category, item, path, detail? }
// --------------------------------------------------------------------------- //

// Item names that mark a target as a web/frontend app (used to derive appKind
// for stack-aware routing). Kept as a set of the human-readable signal names so
// the profile derivation stays in one place.
const WEB_SIGNALS = new Set([
  "React", "Vue", "Next.js", "Angular", "Svelte", "Vite",
  "Tailwind CSS", "TanStack Query", "Zustand", "Framer Motion",
  "Clerk Auth", "Payload CMS",
]);

export function detectStack(root) {
  // Framework / tech stack from package.json (+ pnpm workspace recursion).
  const out = [];
  const collect = (pkgPath, label) => {
    const pkg = readJson(pkgPath);
    if (!pkg) return;
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const signals = [
      ["next", "Next.js"], ["react", "React"], ["vue", "Vue"],
      ["@angular/core", "Angular"], ["vite", "Vite"], ["svelte", "Svelte"],
      ["@supabase/supabase-js", "Supabase"], ["express", "Express"],
      ["fastify", "Fastify"], ["tailwindcss", "Tailwind CSS"],
      ["framer-motion", "Framer Motion"], ["@tanstack/react-query", "TanStack Query"],
      ["zustand", "Zustand"], ["@clerk/clerk-react", "Clerk Auth"],
      ["@playwright/test", "Playwright"], ["playwright", "Playwright"],
      ["@payloadcms/db-postgres", "Payload CMS"],
      // Electron runtime + its two common packagers. A desktop Electron app
      // sets `electron` as a real (often dev) dependency; the builder/forge
      // keys catch a hoisted-monorepo install where `electron` lives in a
      // parent package. These are app-kind signals, not optimization advice.
      ["electron", "Electron"], ["electron-builder", "Electron"],
      ["electron-forge", "Electron"],
    ];
    for (const [key, name] of signals) {
      if (key in deps) out.push({ category: "stack", item: name, path: pkgPath, detail: deps[key] });
    }
  };
  collect(join(root, "package.json"), "root");
  // pnpm workspace: recurse into packages/*
  const ws = readJson(join(root, "pnpm-workspace.yaml"));
  if (isFile(join(root, "pnpm-workspace.yaml"))) {
    for (const sub of dirNames(root)) {
      if (sub === "node_modules" || sub.startsWith(".")) continue;
      const pkgPath = join(root, sub, "package.json");
      if (isFile(pkgPath)) collect(pkgPath, sub);
    }
  }
  // Conventional Electron app folder. A dir check is the in-module idiom (the
  // sibling detect* helpers all work this way) and disambiguates the rare case
  // where deps are hoisted out of the root package. Recorded as a finding only
  // when no dependency signal already named Electron, so we never double-count.
  if (isDir(join(root, "electron")) && !out.some((f) => f.item === "Electron")) {
    out.push({ category: "stack", item: "Electron", path: "electron/" });
  }
  return out;
}

// A flat stack profile for routing: which framework signals were detected, and
// the derived "app kind" — electron > web > node > unknown. This is the shape
// the router consumes; detectStack() above remains the raw findings source that
// `dirf inspect` renders. Pure derivation, no new filesystem reads beyond the
// detectStack it calls. Null/missing root => empty profile (routing degrades to
// today's keyword-only behavior).
export function detectStackProfile(root) {
  if (!root || !isDir(root)) return { frameworks: [], appKind: "unknown" };
  const findings = detectStack(root);
  // de-dup item names (pnpm workspace recursion can repeat React/Vite across
  // packages) while keeping the order of first detection for stable output.
  const frameworks = [...new Set(findings.map((f) => f.item))];
  const has = (name) => frameworks.includes(name);
  let appKind = "unknown";
  if (has("Electron")) appKind = "electron";
  else if (frameworks.some((name) => WEB_SIGNALS.has(name))) appKind = "web";
  else if (frameworks.length) appKind = "node"; // express/fastify/supabase/payload — backend runtime, not browser UI
  return { frameworks, appKind };
}

function detectMemory(root) {
  const out = [];
  const checks = [
    ["memory-bank", "memory-bank (custom memory system)"],
    ["memory-bolts", "memory-bolts"],
    [".memories", "memories store"],
    [".claude-mem", "claude-mem"],
    ["MEMORY.md", "MEMORY.md", true],
    [".gsd/KNOWLEDGE.md", "GSD knowledge base", true],
  ];
  for (const [rel, name, isFileFlag] of checks) {
    const p = join(root, rel);
    if (isFileFlag ? isFile(p) : isDir(p))
      out.push({ category: "memory", item: name, path: rel });
  }
  return out;
}

function detectGraph(root) {
  const out = [];
  if (isDir(join(root, "graphify-out")))
    out.push({ category: "knowledge-graph", item: "graphify (code knowledge graph)", path: "graphify-out/" });
  if (isFile(join(root, "graphify-out", "GRAPH_REPORT.md")))
    out.push({ category: "knowledge-graph", item: "graphify report", path: "graphify-out/GRAPH_REPORT.md" });
  return out;
}

function detectTracking(root) {
  const out = [];
  if (isDir(join(root, ".beads"))) out.push({ category: "task-tracking", item: "Beads (Dolt-backed issue tracker)", path: ".beads/" });
  if (isDir(join(root, ".gsd"))) out.push({ category: "task-tracking", item: "GSD (planning + milestones)", path: ".gsd/" });
  if (isFile(join(root, "BACKLOG.md"))) out.push({ category: "task-tracking", item: "BACKLOG.md", path: "BACKLOG.md" });
  if (isDir(join(root, ".github"))) out.push({ category: "task-tracking", item: "GitHub config (issues/CI)", path: ".github/" });
  return out;
}

function detectPlanning(root) {
  const out = [];
  if (isDir(join(root, ".planning"))) out.push({ category: "planning", item: ".planning/ roadmap", path: ".planning/" });
  if (isDir(join(root, "plans"))) out.push({ category: "planning", item: "plans/ directory", path: "plans/" });
  if (isDir(join(root, ".orchestrator"))) out.push({ category: "planning", item: "Ralph-loop orchestrator", path: ".orchestrator/" });
  if (isDir(join(root, ".ralph-loop"))) out.push({ category: "planning", item: "Ralph-loop validation logs", path: ".ralph-loop/" });
  return out;
}

function detectHosts(root) {
  const out = [];
  const hosts = [
    [".claude", "Claude Code"], [".codex", "Codex (OpenAI)"],
    [".cursor", "Cursor"], [".cursorrules", "Cursor rules", true],
    [".windsurf", "Windsurf"], [".zcode", "ZCode"],
    [".archon", "Archon (multi-agent workflows)"],
    [".aegis", "Aegis (security review)"],
    [".gstack", "gstack"],
    [".claude-flow", "Claude-Flow (swarm orchestration)"],
  ];
  for (const [rel, name, isFileFlag] of hosts) {
    const p = join(root, rel);
    if (isFileFlag ? isFile(p) : isDir(p))
      out.push({ category: "ai-host", item: name, path: rel });
  }
  // root-level universal instruction files
  for (const f of ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "codex.md"]) {
    if (isFile(join(root, f))) out.push({ category: "ai-host", item: `${f} (universal agent instructions)`, path: f });
  }
  // subagent sophistication
  if (isDir(join(root, ".claude", "agents")))
    out.push({ category: "ai-host", item: "Claude subagents (multi-agent definitions)", path: ".claude/agents/" });
  return out;
}

function detectDeployment(root) {
  const out = [];
  if (isDir(join(root, ".vercel"))) out.push({ category: "deployment", item: "Vercel", path: ".vercel/" });
  if (isFile(join(root, "railway.toml"))) out.push({ category: "deployment", item: "Railway", path: "railway.toml" });
  if (isFile(join(root, "docker-compose.yml"))) out.push({ category: "deployment", item: "Docker Compose", path: "docker-compose.yml" });
  if (isFile(join(root, "Dockerfile"))) out.push({ category: "deployment", item: "Dockerfile", path: "Dockerfile" });
  if (isDir(join(root, "supabase"))) out.push({ category: "deployment", item: "Supabase project (migrations/config)", path: "supabase/" });
  return out;
}

function detectMcp(root) {
  const out = [];
  const mcp = readJson(join(root, ".mcp.json"));
  if (mcp && mcp.mcpServers) {
    const names = Object.keys(mcp.mcpServers);
    for (const n of names)
      out.push({ category: "mcp", item: `MCP server: ${n}`, path: ".mcp.json" });
  }
  return out;
}

function detectWorktrees(root) {
  const out = [];
  const patterns = [".worktrees", ".claude/worktrees", ".gsd/worktrees"];
  for (const rel of patterns) {
    if (isDir(join(root, rel)))
      out.push({ category: "workflow", item: "git worktrees (parallel agent branches)", path: rel });
  }
  // named worktree dirs like cardoorx.worktrees
  for (const entry of dirNames(root)) {
    if (entry.endsWith(".worktrees"))
      out.push({ category: "workflow", item: "git worktrees (parallel agent branches)", path: entry });
  }
  return out;
}

// --------------------------------------------------------------------------- //
// Main inspect function
// --------------------------------------------------------------------------- //
export function inspect(root) {
  if (!root || !isDir(root)) return { findings: [], suggestions: [], summary: "path not found" };
  const findings = [
    ...detectStack(root),
    ...detectMemory(root),
    ...detectGraph(root),
    ...detectTracking(root),
    ...detectPlanning(root),
    ...detectHosts(root),
    ...detectDeployment(root),
    ...detectMcp(root),
    ...detectWorktrees(root),
  ];

  const suggestions = generateSuggestions(findings);
  return { findings, suggestions, summary: summarize(findings) };
}

// --------------------------------------------------------------------------- //
// Deterministic suggestions — based on what's detected vs missing
// --------------------------------------------------------------------------- //
function generateSuggestions(findings) {
  const has = (cat, itemPart) =>
    findings.some((f) => f.category === cat && f.item.toLowerCase().includes(itemPart.toLowerCase()));
  const hasCat = (cat) => findings.some((f) => f.category === cat);

  const out = [];

  // Memory gaps
  if (!hasCat("memory") && !hasCat("knowledge-graph") && !has("task-tracking", "KNOWLEDGE")) {
    out.push({
      gap: "No memory / context-persistence layer detected",
      suggestion: "Add a memory system so agents retain decisions across sessions. Options: graphify (code knowledge graph), a memory-bank, or claude-mem. This prevents repeated re-discovery of the same codebase facts.",
      priority: "high",
    });
  }
  // Knowledge graph gap
  if (!hasCat("knowledge-graph")) {
    out.push({
      gap: "No knowledge graph detected",
      suggestion: "Run graphify to build a code knowledge graph. It gives agents structural understanding (god nodes, communities, cross-file paths) without reading every file — major token savings on large codebases.",
      priority: "medium",
    });
  }
  // Task tracking gap
  if (!hasCat("task-tracking")) {
    out.push({
      gap: "No task/issue tracking detected",
      suggestion: "Add Beads (git-based, Dolt-backed) or GSD milestones so agent work is tracked durably. Untracked work gets lost or duplicated across sessions.",
      priority: "high",
    });
  }
  // Complement: has GSD but no Beads
  if (has("task-tracking", "GSD") && !has("task-tracking", "Beads")) {
    out.push({
      gap: "GSD detected but no Beads",
      suggestion: "Beads complements GSD by adding git-based ticket tracking with priorities and handoff notes. GSD = roadmap, Beads = executable tickets.",
      priority: "low",
    });
  }
  // Planning + orchestration
  if (has("planning", "Ralph-loop") && !hasCat("knowledge-graph")) {
    out.push({
      gap: "Ralph-loop orchestrator detected without a knowledge graph",
      suggestion: "A self-validating loop is more effective when backed by a code knowledge graph — graphify gives the validator structural facts instead of re-reading source.",
      priority: "low",
    });
  }
  // Host-specific
  if (has("ai-host", "Claude Code") && !has("ai-host", "subagents")) {
    out.push({
      gap: "Claude Code detected but no subagents defined",
      suggestion: "Define .claude/agents/ subagents to split work by role (researcher, coder, reviewer). Reduces context bleed and lets agents specialize.",
      priority: "low",
    });
  }
  // Security
  if (has("mcp", "MCP") && !has("ai-host", "Aegis")) {
    out.push({
      gap: "MCP servers configured without security review tooling",
      suggestion: "Consider Aegis or a security-review pass — MCP configs can expose secrets (check .mcp.json for plaintext tokens).",
      priority: "medium",
    });
  }
  // Universal: no AGENTS.md
  if (!has("ai-host", "AGENTS.md")) {
    out.push({
      gap: "No AGENTS.md (universal agent instructions)",
      suggestion: "Add an AGENTS.md at root — it's the one file every AI agent host reads. Document build commands, conventions, and guardrails once.",
      priority: "medium",
    });
  }
  return out;
}

function summarize(findings) {
  const cats = {};
  for (const f of findings) cats[f.category] = (cats[f.category] || 0) + 1;
  return Object.entries(cats).map(([k, v]) => `${k}: ${v}`).join(", ") || "nothing detected";
}
