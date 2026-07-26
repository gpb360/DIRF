// Task -> playbook matching. Node built-ins only.
//
// Two signals, both data-driven from the registry — nothing routes by name:
//   1. keyword phrases (curated per playbook): matched * 3 — the strong signal
//   2. content overlap with what the playbook DOES (description, workflow
//      phases/output, agent roster): capped at +2 so it can discriminate ties
//      and catch keyword-less tasks, but never outvote a keyword match
// Ties break by keyword count, then raw content overlap, then insertion order.
// A task that matches neither signal falls back to triage — match or move on.
import { loadJson, PLAYBOOKS, PLAYBOOK_DIR } from "./paths.js";
import { loadPlaybookFolders } from "./folders.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const FALLBACK_PLAYBOOK = "triage";
export const KEYWORD_WEIGHT = 3;
export const CONTEXT_CAP = 2;
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "over", "your",
  "our", "are", "was", "has", "have", "had", "will", "can", "not", "its",
  "all", "any", "out", "get", "use", "using", "when", "where", "how", "why",
  "what", "which", "who", "them", "they", "their", "then", "than", "also",
  "but", "you", "per", "via", "each", "one", "two", "new", "own", "off",
  "should", "would", "could", "does", "before", "after", "make",
]);

function wordTokens(text) {
  return String(text || "").toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function contentTokens(pb) {
  // Everything the registry says the playbook DOES: description, workflow
  // phases and output, and who does the work (agent names, hyphen-split).
  const wf = pb.workflow || {};
  const parts = [pb.description, ...(wf.phases || []), wf.output, ...(pb.agents || [])];
  return new Set(wordTokens(parts.filter(Boolean).join(" ")));
}
const IMPLEMENTATION_INTENT = /\b(add|build|create|fix|implement)\b/;
const EXPLICIT_SECURITY_AUDIT = /\bsecurity audit\b/;
const EXPLICIT_UI_REVIEW = /\b(ui\s*(?:\/|\s)\s*ux|visual acceptance|visual regression|frontend design|design(?: |-)?system review)\b/;

export function collectRoutingFacts(projectRoot) {
  if (!projectRoot) return [];
  const git = (args) => {
    try {
      return execFileSync("git", ["-C", projectRoot, ...args], { encoding: "utf-8", windowsHide: true }).trimEnd();
    } catch {
      return "";
    }
  };
  const facts = [];
  const branch = git(["branch", "--show-current"]);
  if (branch) facts.push(`branch: ${branch}`);
  for (const line of git(["status", "--short"]).split(/\r?\n/).filter(Boolean)) {
    facts.push(`changed: ${line.slice(3)}`);
  }
  for (const relative of [join(".gsd", "STATE.md"), join(".planning", "STATE.md")]) {
    const path = join(projectRoot, relative);
    if (!existsSync(path)) continue;
    const active = readFileSync(path, "utf-8").slice(0, 4096).split(/\r?\n/)
      .find((line) => /active (milestone|phase)/i.test(line));
    if (active) facts.push(`plan: ${active.replaceAll("**", "").trim()}`);
  }
  return facts;
}

function matchedKeywords(haystack, playbook) {
  // Long keywords and phrases match as substrings. Short ones ("pr", "api",
  // "bug") must appear as whole words — else "pr" hits inside "reproduce" and
  // the playbook wins by name, not by what the task asks for. A trailing "s"
  // is tolerated so plurals ("bugs", "prs") still count.
  return (playbook.keywords || []).filter((kw) => {
    const k = kw.toLowerCase();
    if (k.length > 3) return haystack.includes(k);
    return new RegExp(`\\b${k.replace(/[^a-z0-9]/g, "\\$&")}(?:s\\b|\\b)`).test(haystack);
  });
}

function scorePlaybook(haystack, taskTokens, playbook) {
  const matched = matchedKeywords(haystack, playbook);
  const context = [...taskTokens].filter((t) => contentTokens(playbook).has(t)).sort();
  const score = matched.length * KEYWORD_WEIGHT + Math.min(context.length, CONTEXT_CAP);
  return { score, count: matched.length, context };
}

function matchesCue(text, cue) {
  const escaped = String(cue).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`).test(text);
}

function resolveWorkflow(taskText, workflow = {}) {
  const { conditional_contract: contract, ...base } = workflow;
  if (!contract) return base;

  const matches = (cue) => matchesCue(taskText, cue);
  const allMatch = (contract.when_all || []).every(matches);
  const anyMatch = !(contract.when_any || []).length || contract.when_any.some(matches);
  if (!allMatch || !anyMatch) return base;

  return {
    ...base,
    phases: contract.phases || base.phases,
    output: contract.output || base.output,
    validation: contract.validation || base.validation,
    recovery: contract.recovery || base.recovery,
    requirements: contract.requirements || [],
  };
}

export function loadPlaybooks() {
  const folders = loadPlaybookFolders(PLAYBOOK_DIR);
  return Object.keys(folders).length ? folders : loadJson(PLAYBOOKS);
}

export function recommend(task, facts, playbooks = loadPlaybooks()) {
  // Pick the best playbook for a task. Returns a recommendation object.
  const taskText = (task || "").toLowerCase();
  let haystack = taskText;
  const taskHasRoutingCue = Object.entries(playbooks).some(([name, playbook]) =>
    name !== FALLBACK_PLAYBOOK && matchedKeywords(taskText, playbook).length > 0,
  );
  if (!taskHasRoutingCue && facts && facts.length) haystack += " " + facts.join(" ").toLowerCase();
  const affirmativeTaskText = taskText.replace(/\b(?:do not|don't|dont|without)\s+(?:add|build|create|fix|implement)\b/g, "");
  const isImplementation = IMPLEMENTATION_INTENT.test(affirmativeTaskText);
  const isExplicitSecurityAudit = EXPLICIT_SECURITY_AUDIT.test(taskText);
  const isExplicitUiReview = EXPLICIT_UI_REVIEW.test(taskText);
  if (isImplementation) haystack += " feature";

  const taskTokens = new Set(wordTokens(haystack));
  const ranked = [];
  let index = 0;
  for (const [name, pb] of Object.entries(playbooks)) {
    if (name === FALLBACK_PLAYBOOK) continue;
    const reviewConflictsWithImplementation = isImplementation && (
      name === "pr-review" || (name === "security-review" && !isExplicitSecurityAudit)
    );
    const { score, count, context } = reviewConflictsWithImplementation
      ? { score: 0, count: 0, context: [] }
      : scorePlaybook(haystack, taskTokens, pb);
    ranked.push({ score, count, context, index: -index, name, pb });
    index += 1;
  }

  // stable: highest score, then most matched keywords, then deepest content
  // overlap (what the playbook does), then earliest playbook
  ranked.sort((a, b) =>
    b.score - a.score || b.count - a.count || b.context.length - a.context.length || b.index - a.index);
  if (isExplicitUiReview && !isExplicitSecurityAudit) {
    const uiIndex = ranked.findIndex(({ name }) => name === "ui-ux-review");
    if (uiIndex >= 0) {
      ranked[uiIndex].score = Math.max(ranked[uiIndex].score, 1);
      if (uiIndex > 0) ranked.unshift(ranked.splice(uiIndex, 1)[0]);
    }
  }

  let name, pb, score, context;
  if (!ranked.length || ranked[0].score === 0) {
    name = FALLBACK_PLAYBOOK;
    pb = playbooks[FALLBACK_PLAYBOOK];
    score = 0;
    context = [];
  } else {
    ({ name, pb, score, context } = ranked[0]);
  }

  const matched = score === 0 ? [] : matchedKeywords(haystack, pb);
  const alternates = ranked.slice(1, 3)
    .filter((r) => r.score > 0)
    .map((r) => ({ playbook: r.name, score: r.score, description: (r.pb.description || "") }));

  return {
    playbook: name,
    playbook_description: pb.description || "",
    score,
    matched_keywords: matched,
    matched_context: context,
    alternates,
    workflow: resolveWorkflow(taskText, pb.workflow),
    skill_flow: pb.skill_flow,
    agents: pb.agents || [],
    questions: pb.questions || [],
    baseline_skills: [],
  };
}
