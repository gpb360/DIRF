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
// Stack-aware affinity: when the detected app is a software app and the task is
// software work, a playbook whose declared content builds software for that
// kind of app gets this bonus. Kept below KEYWORD_WEIGHT (3) so a genuine
// keyword match still outranks a mere stack alignment — "produce a campaign
// video" in a React repo must still route to video-campaign, not fullstack-feature.
export const STACK_AFFINITY_BONUS = 2;
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

// Software-change intent beyond the few build verbs above — the vocabulary of
// code structure. The Storytellers bug ("gate modules on content… shared
// predicate for the desktop rail") carries none of the IMPLEMENTATION_INTENT
// verbs, so intent alone couldn't save it. These terms signal that the task is
// about code, which (a) qualifies a stack-affinity boost and (b) is the trigger
// for demoting a lone medium-noun keyword win.
const CODE_STRUCTURE_INTENT = /\b(predicate|route|router|module|modules|component|components|hook|hooks|store|prop|props|handler|callback|reducer|selector|gate|gating|gated|rail|nav|sidebar|menu|tab|dialog|modal|form|state|effect|render|fetch|query|mutation|cache|persist|deserialize|serialize|refactor|migrate|migration)\b/;
// Medium nouns that are ALSO common module/asset names. A single hit on one of
// these should not carry a content-production playbook to a win when the task
// is clearly about code.
const MEDIUM_NOUNS = new Set(["video", "audio", "image", "images", "animation", "animations"]);
// Playbooks whose declared purpose is media/content PRODUCTION (not software).
// Detected from each playbook's own capabilities — see contentProductionPlaybook.


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

// ─── Stack-aware affinity (derived, agnostic) ────────────────────────────────
// A playbook is a "content-production" playbook when its declared capabilities
// describe producing media/copy (video, motion, brand copy, youtube seo). These
// are read straight off the playbook's own skill_flow.capability / reason text —
// no playbook is annotated as such; the router derives it. Such playbooks are
// the ones a stray module-name noun ("video") can falsely trigger.
function contentProductionPlaybook(pb) {
  const flow = pb.skill_flow || {};
  const text = [...(flow.steps || []).map((s) => `${s.capability || ""} ${s.reason || ""}`), pb.description || ""].join(" ").toLowerCase();
  return /\b(video creation|motion design|video rendering|youtube seo|copywriting|brand system|campaign|render)\b/.test(text);
}

// A playbook builds software for a kind of app when its declared content reads
// as feature/system work (api, data, logic, tests) rather than as a content or
// page surface (landing page, hero, cta, marketing copy). Derived purely from
// each playbook's own text — no playbook is annotated. Used to award the
// stack-affinity bonus only to genuinely software-building playbooks.
const FEATURE_SIGNALS = /\b(feature|api|data|logic|endpoint|service|store|state|hook|component|slice|ticket|specification|domain|migration|test|tests|backend|server|database|persistence|route|router|handler)\b/;
const PAGE_SURFACE_SIGNALS = /\b(landing page|hero|cta|marketing|sales page|homepage|website|copy|seo keyword|brand)\b/;
const ELECTRON_SIGNALS_TEXT = /\b(electron|main process|renderer|ipc|preload|browserwindow|cross-platform desktop)\b/;
// Review/audit playbooks analyze existing code ("Review…", "Validate…",
// "inspect diff", "report findings") — they don't BUILD software, so the
// stack-affinity floor (a signal that we're building software for this app)
// must not apply to them. Derived from the playbook's own verbs/output.
const REVIEW_AUDIT_SIGNALS = /\b(review|audit|validate|inspect|rank risks|report (?:findings|gaps)|findings ordered|remediation)\b/;

function softwarePlaybookFor(appKind, pb) {
  if (contentProductionPlaybook(pb)) return false;
  const text = [pb.description || "", ...((pb.workflow || {}).phases || []), (pb.workflow || {}).output || ""].join(" ").toLowerCase();
  // Review/audit playbooks never get the build-affinity floor, regardless of
  // whether they mention feature/test/api words incidentally.
  if (REVIEW_AUDIT_SIGNALS.test(text)) return false;
  const isElectronPlaybook = /\belectron\b/.test(text) || ELECTRON_SIGNALS_TEXT.test(text);
  if (appKind === "electron") {
    // For a detected Electron app, an Electron-oriented playbook qualifies, as
    // do general feature playbooks (Electron apps also build features).
    return isElectronPlaybook || (FEATURE_SIGNALS.test(text) && !PAGE_SURFACE_SIGNALS.test(text));
  }
  // web or node: a general feature playbook qualifies, but a playbook whose
  // content is Electron-specific does NOT — it builds for a different runtime
  // than the one detected. Page/content surfaces never qualify.
  if (isElectronPlaybook) return false;
  return FEATURE_SIGNALS.test(text) && !PAGE_SURFACE_SIGNALS.test(text);
}

// The lone-medium-noun demotion (Part 3b). Fires when a content-production
// playbook is winning on a SINGLE keyword, that keyword names a medium that is
// also a common module/asset label, AND the task text carries code-structure
// intent. This is the direct fix for "gate modules on content… the video rail"
// routing to video-campaign: "video" is a module name here, not a production
// request. Stack-agnostic by design — it corrects a misread of the TASK, not of
// the repo, so it helps even for repos DIRF can't profile.
function shouldDemoteLoneMediumNoun(taskText, matchedKws, pb) {
  if (!contentProductionPlaybook(pb)) return false;
  if (matchedKws.length !== 1) return false;
  if (!MEDIUM_NOUNS.has(matchedKws[0].toLowerCase())) return false;
  return CODE_STRUCTURE_INTENT.test(taskText);
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

export function recommend(task, facts, playbooks = loadPlaybooks(), stack = null) {
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
  const hasCodeStructureIntent = CODE_STRUCTURE_INTENT.test(taskText);
  if (isImplementation) haystack += " feature";

  // Stack-aware affinity is active only when we actually profiled the target
  // and it is a software app (web/electron/node). The task must also read as
  // software work — implementation verbs OR code-structure vocabulary — so a
  // media-production request ("render a campaign video") in a React repo is
  // NOT boosted toward software playbooks and can still win on its keywords.
  const appKind = stack?.appKind;
  const stackAffinityActive = !!stack && !!appKind && appKind !== "unknown" &&
    (isImplementation || hasCodeStructureIntent);

  const taskTokens = new Set(wordTokens(haystack));
  const ranked = [];
  let index = 0;
  for (const [name, pb] of Object.entries(playbooks)) {
    if (name === FALLBACK_PLAYBOOK) continue;
    const reviewConflictsWithImplementation = isImplementation && (
      name === "pr-review" || (name === "security-review" && !isExplicitSecurityAudit)
    );
    let { score, count, context } = reviewConflictsWithImplementation
      ? { score: 0, count: 0, context: [] }
      : scorePlaybook(haystack, taskTokens, pb);

    // (a) Positive stack-affinity boost for genuinely software-building
    //     playbooks when the detected app is a software app and the task is
    //     software work. This is the "DIRF knows what the application is"
    //     signal: it awards software playbooks the bonus even when the task
    //     text produced ZERO keyword/context overlap (the Storytellers case —
    //     "gate modules… predicate" hits no fullstack-feature keyword), so the
    //     bonus must be a floor, not an additive nudge on a positive score.
    //     Bounded at STACK_AFFINITY_BONUS (2, below KEYWORD_WEIGHT 3) so a
    //     genuine keyword win still outranks pure stack alignment: "render a
    //     campaign video" in a React repo scores video-campaign 3+ and still
    //     wins over a software playbook's affinity-only 2.
    if (stackAffinityActive && softwarePlaybookFor(appKind, pb) && !reviewConflictsWithImplementation) {
      score = Math.max(score, STACK_AFFINITY_BONUS);
    }

    // (b) Lone-medium-noun demotion. A content-production playbook that wins on
    //     a single medium noun ("video") while the task is about code is a
    //     false keyword match — drop its score to 0 so a real software playbook
    //     (boosted or not) wins. Stack-agnostic: corrects a misread of the task.
    const matchedKws = count > 0 ? matchedKeywords(haystack, pb) : [];
    if (score > 0 && shouldDemoteLoneMediumNoun(taskText, matchedKws, pb)) {
      score = 0;
      count = 0;
    }

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
