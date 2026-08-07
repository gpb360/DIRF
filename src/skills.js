// Agnostic skill discovery + resolver. Node built-ins only.
//
// The kit never hardcodes skills. This module scans the host environment for
// installed skill folders (there can be several), builds an index of what's
// actually present, and resolves the curated registry references against it.
//
// A referenced skill that isn't installed is flagged "recommended" — never fatal.
//
// Discovery is broadened to fix blind spots from the parent repo:
//   - read SKILL.md first, fall back to skill.json then README.md frontmatter
//     (catches skills like ui-ux-pro-max that ship no SKILL.md)
//   - scan ~/.zcode/.../skills roots too (catches skills like superpowers)
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadJson, SKILLS, ROOT } from "./paths.js";
import { loadUnit } from "./folders.js";

// Home roots (resolved at call time). The zcode cache holds versioned plugin
// dirs whose skills live under nested subfolders, so we recurse into it.
const HOME_ROOT_NAMES = [
  ".agents/skills",
  ".codex/skills",
  ".claude/skills",
  ".zcode/cli/plugins/cache",
];
const PROJECT_ROOT_NAMES = [".agents/skills", ".codex/skills", ".claude/skills", "skills"];

// Candidate files inside a skill folder, in priority order.
const SKILL_FILES = ["SKILL.md", "skill.json", "README.md"];
const FM_RE = /^([A-Za-z0-9_-]+):\s*(.*)$/;

// The kit ships zero installed skills. Anything under the kit's own skills/
// folder is a bundled fallback — never part of the host's installed index.
const BUNDLED_DIR = join(ROOT, "skills");

// Same contract for agents: the kit's agents/ folder is a bundled fallback
// roster, never part of the host's installed index.
const BUNDLED_AGENTS_DIR = join(ROOT, "agents");
const AGENT_ROOT_NAMES = [".agents/agents", ".codex/agents", ".claude/agents"];

function skillRoots(projectRoot) {
  // Return all skill scan roots that exist on disk.
  // projectRoot null/undefined defaults to ROOT (the kit's own roots).
  if (!projectRoot) projectRoot = ROOT;
  const roots = [];
  const home = homedir();
  for (const name of HOME_ROOT_NAMES) {
    const candidate = join(home, name);
    if (isDir(candidate)) roots.push(candidate);
  }
  for (const name of PROJECT_ROOT_NAMES) {
    const candidate = join(projectRoot, name);
    if (samePath(candidate, BUNDLED_DIR)) continue;
    if (isDir(candidate)) roots.push(candidate);
  }
  return roots;
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function samePath(a, b) {
  // Path identity that survives Windows drive-letter case and separator
  // differences — a raw string compare would let the kit's own bundled
  // folders slip into the installed index when --path is spelled differently.
  const norm = (p) => {
    const n = String(p).replace(/\\/g, "/");
    return process.platform === "win32" ? n.toLowerCase() : n;
  };
  return norm(a) === norm(b);
}

function parseFrontmatter(text) {
  // Tolerant YAML-ish frontmatter parser (no dependency).
  const fields = {};
  if (!text.startsWith("---")) return fields;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return fields;
  for (const line of text.slice(4, end).split(/\r?\n/)) {
    const m = FM_RE.exec(line);
    if (!m) continue;
    const value = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
    // A bare YAML block-scalar marker ("|", ">-", ...) carries no text on this
    // line and its indented continuation lines are dropped by this parser —
    // treat as empty rather than storing the literal marker.
    fields[m[1]] = /^[|>][+-]?$/.test(value) ? "" : value;
  }
  return fields;
}

function readSkillFile(path) {
  // Read a skill definition file. Returns [name, fieldsObj, lineCount].
  let text;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return ["", {}, 0];
  }
  const lines = text.split(/\r?\n/).length;
  if (path.endsWith(".json")) {
    try {
      const data = JSON.parse(text);
      if (data && typeof data === "object") return [String(data.name || basenameDir(path)), data, lines];
    } catch {
      /* fall through */
    }
    return ["", {}, 0];
  }
  const fm = parseFrontmatter(text);
  return [fm.name || basenameDir(path), fm, lines];
}

// Tolerant boolean for frontmatter flags (yes/no/on/off/1/0/true/false — the
// Claude Code convention). Returns undefined when absent or unparseable.
function parseBool(value) {
  if (value === undefined || value === null) return undefined;
  const v = String(value).trim().toLowerCase();
  if (["yes", "on", "1", "true"].includes(v)) return true;
  if (["no", "off", "0", "false"].includes(v)) return false;
  return undefined;
}

function collectDisclosures(folder, indexFile) {
  // Progressive disclosure: co-located files one level deep next to a skill's
  // index file (tests.md, mocking.md, scripts/, templates/) are loaded on
  // demand. Index them so rendered sets can point at them lazily — unread
  // files cost zero tokens. Excludes the index file itself.
  let entries;
  try {
    entries = readdirSync(folder, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.name !== indexFile)
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort();
}

function basenameDir(path) {
  // parent folder name fallback for skill identity.
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 2] || "skill";
}

export function discover(projectRoot) {
  // Scan all roots and return an index: { skillName: { path, file, ... } }.
  // projectRoot null/undefined defaults to ROOT. Scans:
  //   1. the standard home + project roots (skillRoots)
  //   2. any directory named `skills` under the project root (auto-detect, so
  //      projects with non-standard layouts like `audit-runtime/skills/` are
  //      found without configuration — the agnostic principle)
  const index = {};
  for (const root of skillRoots(projectRoot)) {
    if (root.includes("cache")) {
      scanRecursive(root, index);
    } else {
      scanFlat(root, index);
    }
  }
  if (projectRoot) {
    for (const root of findSkillFolders(projectRoot)) {
      scanFlat(root, index);
    }
  }
  return index;
}

function findSkillFolders(projectRoot) {
  // Auto-detect any directory named `skills` under the project root (one level
  // of parent nesting: <root>/X/skills and <root>/skills). Returns absolute
  // paths. Skips node_modules, .git, and the standard roots already scanned.
  const out = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
  let top;
  try {
    top = readdirSync(projectRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  // <root>/skills
  const rootSkills = join(projectRoot, "skills");
  if (!samePath(rootSkills, BUNDLED_DIR) && isDir(rootSkills)) out.push(rootSkills);
  // <root>/<dir>/skills
  for (const entry of top) {
    if (!entry.isDirectory() || skip.has(entry.name)) continue;
    const skillsDir = join(projectRoot, entry.name, "skills");
    if (!samePath(skillsDir, BUNDLED_DIR) && isDir(skillsDir)) out.push(skillsDir);
  }
  return out;
}

function scanFlat(root, index) {
  // non-recursive: each immediate subdir is a skill folder.
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  for (const child of entries.sort()) {
    const dir = join(root, child);
    if (!isDir(dir)) continue;
    for (const fname of SKILL_FILES) {
      const target = join(dir, fname);
      if (existsSync(target)) {
        indexOne(target, index);
        break;
      }
    }
  }
}

function scanRecursive(root, index) {
  // recursive: find any SKILL.md / skill.json / README.md under the cache.
  const seen = new Set();
  const hit = (path) => {
    if (seen.has(path)) return;
    seen.add(path);
    indexOne(path, index);
  };
  for (const path of walkFiles(root)) {
    const base = path.replace(/\\/g, "/").split("/").pop();
    if (base === "SKILL.md" || base === "skill.json") hit(path);
    else if (base === "README.md") hit(path);
  }
}

function walkFiles(dir, out = []) {
  // recursive file list (built-in readdirSync recursive is {recursive:true} on Node 20+).
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walkFiles(full, out);
      else if (e.isFile()) out.push(full);
    }
  } catch {
    /* permission errors etc — skip */
  }
  return out;
}

function indexOne(path, index) {
  const [name, fm, lineCount] = readSkillFile(path);
  if (!name) return;
  const desc = typeof fm === "object" ? fm.description || "" : "";
  // First found wins (SKILL.md priority order), but keep richer descriptions.
  const existing = index[name];
  if (existing && !desc) return;
  const normalized = path.replace(/\\/g, "/");
  const folder = normalized.replace(/\/[^/]+$/, "");
  const file = normalized.split("/").pop();
  // Invocation class (the ecosystem's master routing attribute). A skill that
  // declares `disable-model-invocation` is user-invoked: its description is
  // written for a person, NOT a routing hint — flow.js must not score it.
  // Absent flag ⇒ model-invoked (the default). DIRF only reads the skill's
  // own declaration; it never imposes one.
  const invocation = parseBool(typeof fm === "object" ? fm["disable-model-invocation"] : undefined) === true ? "user" : "model";
  index[name] = {
    name,
    path: folder,
    file,
    description: desc,
    provider: providerForPath(normalized),
    invocation,
    disclosures: collectDisclosures(folder, file),
    body_lines: lineCount,
  };
}

export function discoverAgents(projectRoot) {
  // Scan the host for installed agent definitions, same contract as skill
  // discovery: home + project roots, first found wins, the kit's own bundled
  // agents/ folder is never part of the index.
  // Agent convention (Claude subagents et al.): flat *.md files with
  // name/description frontmatter directly under an agents root.
  if (!projectRoot) projectRoot = ROOT;
  const index = {};
  const home = homedir();
  const roots = [];
  for (const name of AGENT_ROOT_NAMES) roots.push(join(home, name));
  for (const name of AGENT_ROOT_NAMES) roots.push(join(projectRoot, name));
  const projectAgents = join(projectRoot, "agents");
  if (!samePath(projectAgents, BUNDLED_AGENTS_DIR)) roots.push(projectAgents);
  for (const root of roots) {
    if (!isDir(root)) continue;
    let entries;
    try { entries = readdirSync(root); } catch { continue; }
    for (const child of entries.sort()) {
      if (!child.endsWith(".md")) continue;
      // Documentation files inside an agents folder are not agents; without
      // this a doc-only agents/ dir yields phantom installed agents and
      // silently suppresses the "no agents on this host" question.
      if (/^(readme|index|agents|contributing|changelog)\.md$/i.test(child)) continue;
      const path = join(root, child).replace(/\\/g, "/");
      let fm;
      try { fm = parseFrontmatter(readFileSync(join(root, child), "utf-8")); } catch { continue; }
      if (!fm.name && !fm.description) continue;
      const name = fm.name || child.replace(/\.md$/, "");
      if (index[name]) continue;
      index[name] = { name, path, description: fm.description || "", tools: fm.tools || "", provider: providerForPath(path) };
    }
  }
  return index;
}

export function providerForPath(path) {
  const normalized = String(path || "").replace(/\\/g, "/");
  const markers = [["/.agents/", "agents"], ["/.claude/", "claude"], ["/.codex/", "codex"], ["/.zcode/", "zcode"]];
  return markers.reduce((best, [marker, provider]) => {
    const index = normalized.lastIndexOf(marker);
    return index > best.index ? { index, provider } : best;
  }, { index: -1, provider: "project" }).provider;
}

export function bundledSkills() {
  // The kit's own skills/ folder, exposed ONLY as fallbacks for capabilities
  // the local install cannot cover. Folder units parsed via the DAG contract
  // so declared capabilities come through as real arrays.
  const index = {};
  if (!existsSync(BUNDLED_DIR)) return index;
  let entries;
  try { entries = readdirSync(BUNDLED_DIR, { withFileTypes: true }); } catch { return index; }
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      const unit = loadUnit(join(BUNDLED_DIR, entry.name));
      if (unit.meta.kind !== "skill") continue;
      index[unit.meta.name] = {
        name: unit.meta.name,
        path: unit.folder,
        description: unit.meta.description || "",
        capabilities: unit.meta.capabilities || [],
        provider: "dirf",
      };
    } catch { /* a malformed bundled unit is validate's problem, not discovery's */ }
  }
  return index;
}

export function loadRegistry() {
  return loadJson(SKILLS);
}

export function enrichDiscovered(discovered) {
  const registry = Object.fromEntries((loadRegistry().skills || []).map((skill) => [skill.name, skill]));
  return Object.fromEntries(Object.entries(discovered || {}).map(([name, item]) => [name, { ...registry[name], ...item }]));
}

export function loadTrustedSources(projectRoot) {
  const files = [{ path: join(homedir(), ".dirf", "trusted-sources.json"), provider: "host" }];
  if (projectRoot) files.push({ path: join(projectRoot, ".dirf", "trusted-sources.json"), provider: "project" });
  const sources = [];
  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(file.path, "utf-8"));
      for (const source of data.sources || []) sources.push({ ...source, provider: file.provider });
    } catch { /* absent or invalid user configuration contributes nothing */ }
  }
  return sources;
}

export function resolveAgentSkills(agentName, agentSkillRefs, baselineSkillRefs, discovered) {
  // Resolve one agent's skills (its own refs + baseline) against the index.
  // Returns a de-duplicated list (preserving order), each:
  //   { name, status, summary, category, path? }
  // status is "installed" | "recommended".
  if (discovered === undefined) discovered = discover();
  const registry = {};
  for (const s of loadRegistry().skills || []) registry[s.name] = s;

  const seen = new Set();
  const out = [];
  for (const ref of [...(agentSkillRefs || []), ...(baselineSkillRefs || [])]) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const entry = registry[ref] || {};
    const installed = discovered[ref];
    const item = {
      name: ref,
      status: installed ? "installed" : "recommended",
      summary: entry.summary || (installed ? installed.description || "" : ""),
      category: entry.category || "",
    };
    if (installed) item.provider = installed.provider || "project";
    out.push(item);
  }
  return out;
}
