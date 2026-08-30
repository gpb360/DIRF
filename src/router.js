// Task -> playbook matching. Node built-ins only.
//
// Two signals, both data-driven from the registry — nothing routes by name:
//   1. keyword phrases (curated per playbook): each matched word * 3 — the
//      strong signal, so an exact phrase outranks one broad noun
//   2. content overlap with what the playbook DOES (description, workflow
//      phases/output, agent roster): capped at +2 so it can discriminate ties
//      and catch keyword-less tasks, but never outvote a keyword match
// Ties break by keyword count, then raw content overlap, then insertion order.
// A task that matches neither signal falls back to triage — match or move on.
import { loadJson, PLAYBOOKS, PLAYBOOK_DIR } from "./paths.js";
import { loadPlaybookFolders } from "./folders.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

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
const IMPLEMENTATION_INTENT = /\b(add|adding|build|building|change|changing|create|creating|fix|fixing|implement|implementing|modify|modifying|update|updating|write|writing)\b/;
const DOCUMENTATION_TARGET = /\b(docs?|documentation|readme|changelog|manual)\b/;
const CONTINUATION_ACTION_WORDS = "add|adding|audit|auditing|build|building|change|changing|coding|create|creating|deploy|deploying|fix|fixing|implement|implementing|migrate|migrating|modify|modifying|redesign|redesigning|refactor|refactoring|review|reviewing|ship|shipping|test|testing|update|updating|verify|verifying|write|writing";
const CONTINUATION_ACTION_INTENT = new RegExp(`\\b(?:${CONTINUATION_ACTION_WORDS})\\b`);
const NEGATED_ROUTING_CLAUSE = new RegExp(
  `(?:\\b(?:but|and(?:\\s+then)?|then)\\s+)?` +
  `\\b(?:(?:i\\s+)?(?:do\\s+not|don't|dont)\\s+(?:want\\s+(?:you\\s+)?to\\s+)?|never\\s+|without\\s+|not\\s+)` +
  `(?:you\\s+)?(?:grill(?:\\s+me)?|interview\\s+me|question\\s+me|${CONTINUATION_ACTION_WORDS})\\b` +
  `[^,.;!?]*?(?=\\s+\\b(?:but|and\\s+then|then)\\b|[,.;!?]|$)`,
  "g",
);
const INTERVIEW_FIRST_TARGET = new RegExp(
  `(?:${CONTINUATION_ACTION_INTENT.source}|implementation|execution|delivery|coding|changes?)`,
);
const EXPLICIT_SECURITY_AUDIT = /\bsecurity audit\b/;
const EXPLICIT_UI_REVIEW = /\b(ui\s*(?:\/|\s)\s*ux|visual acceptance|visual regression|frontend design|design(?: |-)?system review)\b/;

// Software-change intent beyond the few build verbs above — the vocabulary of
// code structure. A prior regression ("gate modules on content… shared
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
  // Match complete words and phrases. Single-word keywords tolerate a trailing
  // "s" so plurals ("bugs", "prs") still count without matching inflections.
  return (playbook.keywords || []).filter((kw) => {
    const k = kw.toLowerCase();
    return matchesCue(haystack, k) || (/^[a-z0-9]+$/.test(k) && matchesCue(haystack, `${k}s`));
  });
}

function scorePlaybook(haystack, taskTokens, playbook) {
  const matched = matchedKeywords(haystack, playbook);
  const context = [...taskTokens].filter((t) => contentTokens(playbook).has(t)).sort();
  const keywordScore = matched.reduce((total, keyword) =>
    total + Math.max(1, wordTokens(keyword).length) * KEYWORD_WEIGHT, 0);
  const score = keywordScore + Math.min(context.length, CONTEXT_CAP);
  return { score, count: matched.length, context };
}

function explicitlyRequestsInterview(taskText, playbook) {
  const hasInterviewStep = (playbook.skill_flow?.steps || [])
    .some((step) => step.capability === "plan interview");
  if (!hasInterviewStep) return false;
  return matchedKeywords(taskText, playbook)
    .some((keyword) => /\b(?:grill|interview|question)\b/.test(keyword.replaceAll("-", " ")));
}

function affirmativeRoutingText(taskText) {
  return String(taskText || "").toLowerCase()
    .replace(NEGATED_ROUTING_CLAUSE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function interviewCueIndex(taskText, interviewPlaybook) {
  const interviewKeywords = matchedKeywords(taskText, interviewPlaybook)
    .filter((keyword) => /\b(?:grill|interview|question)\b/.test(keyword.replaceAll("-", " ")));
  return interviewKeywords
    .map((keyword) => taskText.indexOf(keyword.toLowerCase()))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
}

function explicitlyInterviewFirst(taskText, interviewIndex) {
  const afterInterview = taskText.slice(interviewIndex);
  return /\bfirst\b/.test(afterInterview) ||
    new RegExp(`\\bbefore\\b[^,.;!?]{0,100}${INTERVIEW_FIRST_TARGET.source}`).test(afterInterview);
}

function requestsContinuation(taskText, interviewPlaybook) {
  const interviewIndex = interviewCueIndex(taskText, interviewPlaybook);
  if (interviewIndex === undefined) return false;
  if (CONTINUATION_ACTION_INTENT.test(taskText.slice(0, interviewIndex))) {
    return explicitlyInterviewFirst(taskText, interviewIndex);
  }
  const afterInterview = taskText.slice(interviewIndex);
  return new RegExp(
    `\\b(?:before|then|next|after(?:ward|wards| that)?|and(?: then)?)\\b[^,.;!?]{0,100}${CONTINUATION_ACTION_INTENT.source}`,
  ).test(afterInterview);
}

function requestsPostActionInterview(taskText, interviewPlaybook) {
  const interviewIndex = interviewCueIndex(taskText, interviewPlaybook);
  if (interviewIndex === undefined || explicitlyInterviewFirst(taskText, interviewIndex)) return false;
  const beforeInterview = taskText.slice(0, interviewIndex);
  return CONTINUATION_ACTION_INTENT.test(beforeInterview) &&
    /\b(?:then|after(?:ward|wards)?|and\s+then)\b[^,.;!?]*$/.test(beforeInterview);
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

function matchingConditionalContract(taskText, workflow = {}) {
  const contract = workflow.conditional_contract;
  if (!contract) return null;
  const matches = (cue) => matchesCue(taskText, cue);
  const allCues = Array.isArray(contract.when_all) ? contract.when_all : [];
  const anyCues = Array.isArray(contract.when_any) ? contract.when_any : [];
  if (!allCues.length && !anyCues.length) return null;
  const allMatch = allCues.every(matches);
  const anyMatch = !anyCues.length || anyCues.some(matches);
  return allMatch && anyMatch ? contract : null;
}

function resolveWorkflow(taskText, workflow = {}) {
  const { conditional_contract: _conditionalContract, ...base } = workflow;
  const contract = matchingConditionalContract(taskText, workflow);
  if (!contract) return base;

  return {
    ...base,
    phases: contract.phases || base.phases,
    gates: contract.gates || base.gates,
    agent_contracts: contract.agent_contracts || base.agent_contracts,
    output: contract.output || base.output,
    validation: contract.validation || base.validation,
    recovery: contract.recovery || base.recovery,
    requirements: contract.requirements || base.requirements || [],
  };
}

function resolveAgents(taskText, playbook = {}) {
  const contract = matchingConditionalContract(taskText, playbook.workflow);
  return contract?.agents || playbook.agents || [];
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function composeSequentialWorkflows(taskText, result, continuation) {
  const continuationWorkflow = resolveWorkflow(taskText, continuation.pb.workflow);
  const primaryPhases = result.workflow.phases || [];
  const usedPhases = new Set(primaryPhases);
  const phaseMap = new Map();
  const continuationPhases = (continuationWorkflow.phases || []).map((phase) => {
    let mapped = phase;
    if (usedPhases.has(mapped)) mapped = `${continuation.name}: ${phase}`;
    let suffix = 2;
    while (usedPhases.has(mapped)) mapped = `${continuation.name}: ${phase} (${suffix++})`;
    usedPhases.add(mapped);
    phaseMap.set(phase, mapped);
    return mapped;
  });
  const continuationGates = Object.fromEntries(Object.entries(continuationWorkflow.gates || {})
    .map(([phase, gate]) => [phaseMap.get(phase) || phase, gate]));
  const primaryGates = { ...(result.workflow.gates || {}) };
  const primaryLastPhase = primaryPhases.at(-1);
  if (primaryLastPhase && continuationPhases.length && !primaryGates[primaryLastPhase]) {
    primaryGates[primaryLastPhase] = { kind: "soft" };
  }
  const continuationContracts = Object.fromEntries(Object.entries(continuationWorkflow.agent_contracts || {})
    .map(([agent, contract]) => [agent, {
      ...contract,
      phases: (contract.phases || []).map((phase) => phaseMap.get(phase) || phase),
    }]));
  const continuationAgents = resolveAgents(taskText, continuation.pb);
  const fulfilledCapabilities = new Set((result.skill_flow.steps || [])
    .map((step) => step.capability)
    .filter(Boolean));
  const continuationSteps = (continuation.pb.skill_flow.steps || [])
    .filter((step) => !step.capability || !fulfilledCapabilities.has(step.capability));
  const mergedContracts = { ...(result.workflow.agent_contracts || {}) };
  for (const [agent, contract] of Object.entries(continuationContracts)) {
    const primary = mergedContracts[agent];
    mergedContracts[agent] = primary ? {
      ...primary,
      ...contract,
      phases: unique([...(primary.phases || []), ...(contract.phases || [])]),
      output: unique([primary.output, contract.output]).join("; then "),
      verification: unique([primary.verification, contract.verification]).join("; and "),
    } : contract;
  }

  return {
    ...result,
    continuation: {
      playbook: continuation.name,
      description: continuation.pb.description || "",
    },
    alternates: result.alternates.filter(({ playbook }) => playbook !== continuation.name),
    workflow: {
      ...result.workflow,
      phases: [...primaryPhases, ...continuationPhases],
      gates: { ...primaryGates, ...continuationGates },
      agent_contracts: mergedContracts,
      requirements: unique([
        ...(result.workflow.requirements || []),
        ...(continuationWorkflow.requirements || []),
      ]),
      output: `${result.workflow.output} Then continue with ${continuationWorkflow.output}.`,
      validation: `${result.workflow.validation} Then ${continuationWorkflow.validation}.`,
      recovery: `${result.workflow.recovery} After the first workflow is complete, ${continuationWorkflow.recovery}.`,
    },
    skill_flow: {
      label: `${result.skill_flow.label} -> ${continuation.pb.skill_flow.label}`,
      steps: [...(result.skill_flow.steps || []), ...continuationSteps],
    },
    agents: unique([...result.agents, ...continuationAgents]),
    questions: unique([...result.questions, ...(continuation.pb.questions || [])]),
  };
}

export function loadPlaybooks({ projectPlaybookDir } = {}) {
  const folders = loadPlaybookFolders(PLAYBOOK_DIR);
  const bundled = Object.keys(folders).length ? folders : loadJson(PLAYBOOKS);
  if (!projectPlaybookDir) return bundled;

  // Experiment: an explicitly supplied project playbook directory participates
  // in routing. No auto-discovery: absent directory, malformed playbook, and
  // same-name collisions all fail before any playbook can route.
  const projectRoot = resolve(projectPlaybookDir);
  if (!existsSync(projectRoot)) throw new Error(`Project playbook directory does not exist: ${projectRoot}`);
  const project = loadPlaybookFolders(projectRoot);
  const bundledRoot = Object.keys(folders).length ? PLAYBOOK_DIR : PLAYBOOKS;
  const annotated = {};
  for (const [name, playbook] of Object.entries(bundled)) {
    annotated[name] = { ...playbook, playbook_source: "bundled", playbook_source_path: join(bundledRoot, name) };
  }
  for (const [name, playbook] of Object.entries(project)) {
    if (Object.hasOwn(annotated, name)) {
      throw new Error(`Playbook ${name} collides: bundled at ${annotated[name].playbook_source_path}, project at ${join(projectRoot, name)}; no silent override`);
    }
    annotated[name] = { ...playbook, playbook_source: "project", playbook_source_path: join(projectRoot, name) };
  }
  return annotated;
}

export function recommend(task, facts, playbooks = loadPlaybooks(), stack = null) {
  // Pick the best playbook for a task. Returns a recommendation object.
  const taskText = (task || "").toLowerCase();
  const routingTaskText = affirmativeRoutingText(taskText);
  let haystack = routingTaskText;
  const taskHasRoutingCue = Object.entries(playbooks).some(([name, playbook]) =>
    name !== FALLBACK_PLAYBOOK && matchedKeywords(taskText, playbook).length > 0,
  );
  if (!taskHasRoutingCue && facts && facts.length) haystack += " " + facts.join(" ").toLowerCase();
  // Documentation verbs such as "update docs" must not receive the generic
  // feature boost. The documentation playbook is the more specific contract;
  // mixed work can still be stated as a separate implementation clause.
  const isImplementation = IMPLEMENTATION_INTENT.test(routingTaskText) &&
    !DOCUMENTATION_TARGET.test(routingTaskText);
  const isExplicitSecurityAudit = EXPLICIT_SECURITY_AUDIT.test(routingTaskText);
  const isExplicitUiReview = EXPLICIT_UI_REVIEW.test(routingTaskText);
  const hasCodeStructureIntent = CODE_STRUCTURE_INTENT.test(routingTaskText);
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
    //     text produced ZERO keyword/context overlap (the prior regression —
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
    if (score > 0 && shouldDemoteLoneMediumNoun(routingTaskText, matchedKws, pb)) {
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
  // An explicitly requested interview is a sequencing instruction: settle the
  // decision first, then continue the review/build task. Preserve that human
  // checkpoint even when the rest of the sentence strongly matches another
  // playbook. Derived from the playbook's declared capability and keywords,
  // not from a hardcoded playbook name.
  const interviewIndex = ranked.findIndex(({ pb: playbook }) => explicitlyRequestsInterview(routingTaskText, playbook));
  let continuation = null;
  let postActionInterview = null;
  if (interviewIndex >= 0) {
    const interviewEntry = ranked[interviewIndex];
    if (requestsPostActionInterview(routingTaskText, interviewEntry.pb)) {
      const actionEntry = ranked.find((entry, index) => index !== interviewIndex && entry.score > 0) || null;
      if (actionEntry) {
        postActionInterview = interviewEntry;
        const actionIndex = ranked.indexOf(actionEntry);
        if (actionIndex > 0) ranked.unshift(ranked.splice(actionIndex, 1)[0]);
      }
    } else {
      continuation = requestsContinuation(routingTaskText, interviewEntry.pb)
        ? ranked.find((entry, index) => index !== interviewIndex && entry.score > 0) || null
        : null;
      interviewEntry.score = Math.max(interviewEntry.score, 1);
      if (interviewIndex > 0) ranked.unshift(ranked.splice(interviewIndex, 1)[0]);
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

  let result = {
    playbook: name,
    playbook_description: pb.description || "",
    score,
    matched_keywords: matched,
    matched_context: context,
    alternates,
    workflow: resolveWorkflow(routingTaskText, pb.workflow),
    skill_flow: pb.skill_flow,
    agents: resolveAgents(routingTaskText, pb),
    questions: pb.questions || [],
    baseline_skills: [],
  };
  // Provenance appears only when loadPlaybooks was given a project directory;
  // bundled-only routing output stays byte-identical to prior versions.
  if (pb.playbook_source) {
    result.playbook_source = pb.playbook_source;
    result.playbook_source_path = pb.playbook_source_path;
  }
  if (continuation && explicitlyRequestsInterview(routingTaskText, pb)) {
    result = composeSequentialWorkflows(routingTaskText, result, continuation);
  } else if (postActionInterview && !explicitlyRequestsInterview(routingTaskText, pb)) {
    result = composeSequentialWorkflows(routingTaskText, result, postActionInterview);
  }
  return result;
}
