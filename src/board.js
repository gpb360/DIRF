// Project board and cleanup (`dirf board`, `dirf cleanup`).
//
// The board is a read model: canonical attempt state comes from state.js, and
// pull-request facts come from `gh` at read time. Nothing here writes
// canonical state directly — cleanup applies lifecycle changes only through
// state.js (`updateAttemptLifecycle`) and merges only through `gh pr merge`.
// GitHub is optional: when `gh` is missing, offline, or the checkout has no
// GitHub origin, the board still lists attempts and says why PRs are absent.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  assertReviewRoundRecorded,
  projectWorkSnapshot,
  readSettings,
  recordedReviewEntries,
  storeAttemptDir,
  updateAttemptLifecycle,
} from "./state.js";
import { blockingFindings, deriveVerdict, normalizeRepository, validateReview } from "../skills/code-review/scripts/review-report.mjs";

const DAY_MS = 86_400_000;
const OPEN_STATES = new Set(["planned", "in_progress", "blocked"]);
const GH_TIMEOUT_MS = 20_000;
const NOTICE_GH_TIMEOUT_MS = 5_000;
const PR_LIST_LIMIT = "200";
const CLOSED_PR_LIST_LIMIT = "1000";
const OPEN_PR_FIELDS = "number,title,state,url,headRefName,headRefOid,baseRefOid,createdAt,isDraft,mergeable,mergeStateStatus,statusCheckRollup,body";
const CLOSED_PR_FIELDS = "number,title,state,url,headRefName,createdAt,mergedAt,closedAt,mergeCommit";
const MAX_EXTRA_PR_LOOKUPS = 20;
const PASSING_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
const BLOCKED_MERGE_STATES = new Set(["BLOCKED", "DIRTY", "BEHIND", "DRAFT"]);
// "Done", "Complete.", "Done — merged in #12"; not the imperative "Complete the tests".
const DONE_NEXT_ACTION = /^\s*[*_`]*\s*(?:done|complete|completed)[*_`]*\s*(?:$|[.:;!—–-][*_`]*(?:\s|$))/i;

// ── gh access ────────────────────────────────────────────────────────────────

// DIRF_GH points tests (or unusual installs) at another gh executable. A .js
// or .mjs path runs through this Node binary so fixtures work on Windows too.
export function defaultGh(args, { cwd, timeout = GH_TIMEOUT_MS } = {}) {
  const override = process.env.DIRF_GH;
  const [command, prefix] = override
    ? /\.(?:c|m)?js$/i.test(override) ? [process.execPath, [override]] : [override, []]
    : ["gh", []];
  return execFileSync(command, [...prefix, ...args], {
    cwd,
    encoding: "utf8",
    timeout,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function ghFailure(error) {
  if (error?.code === "ENOENT") return "gh is not installed";
  const detail = String(error?.stderr || error?.message || error || "").trim().split(/\r?\n/)[0];
  return detail ? `gh failed: ${detail}` : "gh failed";
}

function readOrigin(checkout) {
  try {
    return execFileSync("git", ["-C", checkout, "remote", "get-url", "origin"], {
      encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function githubOrigin(checkout) {
  try {
    const origin = execFileSync("git", ["-C", checkout, "remote", "get-url", "origin"], {
      encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /github/i.test(origin) ? origin : null;
  } catch {
    return null;
  }
}

// One `gh pr list` for open PRs (with checks and mergeability) and, when
// asked, one for merged/closed PRs (light fields) so cleanup can tell shipped
// work from abandoned branches.
export function readPullRequests(checkout, { gh = defaultGh, includeClosed = true, requireOrigin = true } = {}) {
  if (requireOrigin && !githubOrigin(checkout)) {
    return { available: false, reason: "this checkout has no GitHub origin", prs: [] };
  }
  try {
    const open = JSON.parse(gh(["pr", "list", "--state", "open", "--limit", PR_LIST_LIMIT, "--json", OPEN_PR_FIELDS], { cwd: checkout }) || "[]");
    const closed = includeClosed
      ? JSON.parse(gh(["pr", "list", "--state", "all", "--limit", CLOSED_PR_LIST_LIMIT, "--json", CLOSED_PR_FIELDS], { cwd: checkout }) || "[]")
      : [];
    if (!Array.isArray(open) || !Array.isArray(closed)) throw new Error("unexpected gh output");
    const byNumber = new Map();
    for (const pr of closed) if (pr && pr.state !== "OPEN") byNumber.set(pr.number, pr);
    for (const pr of open) if (pr) byNumber.set(pr.number, pr);
    return { available: true, reason: null, prs: [...byNumber.values()] };
  } catch (error) {
    return { available: false, reason: ghFailure(error), prs: [] };
  }
}

export function checkStatus(rollup) {
  const items = Array.isArray(rollup) ? rollup : [];
  if (!items.length) return "none";
  let pending = false;
  for (const item of items) {
    if (item.__typename === "StatusContext" || (item.state && !item.status)) {
      const state = String(item.state || "").toUpperCase();
      if (state === "PENDING" || state === "EXPECTED") pending = true;
      else if (state !== "SUCCESS") return "failing";
      continue;
    }
    if (String(item.status || "").toUpperCase() !== "COMPLETED") { pending = true; continue; }
    if (!PASSING_CONCLUSIONS.has(String(item.conclusion || "").toUpperCase())) return "failing";
  }
  return pending ? "pending" : "passing";
}

// ── review artefacts ─────────────────────────────────────────────────────────

function gitCommonDir(checkout) {
  try {
    const dir = execFileSync("git", ["-C", checkout, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return dir || null;
  } catch {
    return null;
  }
}

function jsonFiles(dir) {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => join(dir, name));
  } catch {
    return [];
  }
}

// Every place `dirf review` workflows leave a review.json for one PR:
//   <checkout>/.scratch/dirf-review/pr-N/*.json       (skill-driven reviews)
//   <git-common-dir>[/worktrees/*]/dirf-review-loop/pr-N/*-step*.json  (review loop)
//   <attempt folder>/review.json                       (pr-review playbook gate)
export function reviewCandidatePaths(prNumber, { checkouts = [], attemptFolders = [] } = {}) {
  const paths = new Set();
  const commonDirs = new Set();
  for (const checkout of checkouts) {
    for (const file of jsonFiles(join(checkout, ".scratch", "dirf-review", `pr-${prNumber}`))) paths.add(file);
    const common = gitCommonDir(checkout);
    if (common) commonDirs.add(common);
  }
  for (const common of commonDirs) {
    for (const file of jsonFiles(join(common, "dirf-review-loop", `pr-${prNumber}`))) {
      if (/-step\d+\.json$/.test(file)) paths.add(file);
    }
    let worktrees = [];
    try { worktrees = readdirSync(join(common, "worktrees")); } catch { /* no linked worktrees */ }
    for (const name of worktrees) {
      for (const file of jsonFiles(join(common, "worktrees", name, "dirf-review-loop", `pr-${prNumber}`))) {
        if (/-step\d+\.json$/.test(file)) paths.add(file);
      }
    }
  }
  for (const folder of attemptFolders) {
    const file = join(folder, "review.json");
    if (existsSync(file)) paths.add(file);
  }
  return [...paths];
}

// The newest valid review for this PR, preferring one taken at the PR's
// current head. A review of an older head is reported but never qualifies.
export function latestReview(prNumber, headSha, locations, { slug = null } = {}) {
  const head = String(headSha || "").toLowerCase();
  const reviews = [];
  for (const path of reviewCandidatePaths(prNumber, locations)) {
    let review;
    try {
      review = JSON.parse(readFileSync(path, "utf8"));
      if (review?.target?.pr_number !== prNumber) continue;
      validateReview(review);
    } catch {
      continue;
    }
    let mtime;
    try { mtime = statSync(path).mtimeMs; } catch { continue; }
    reviews.push({ path, review, mtime });
  }
  if (!reviews.length) return null;
  reviews.sort((left, right) => right.mtime - left.mtime);
  const atHead = reviews.find(({ review }) => review.target.head_sha.toLowerCase() === head);
  const chosen = atHead || reviews[0];
  const blocking = blockingFindings(chosen.review);
  let ledger = null;
  let ledgerReady = false;
  if (slug) {
    try {
      ledger = recordedReviewEntries(slug, prNumber, chosen.review.target.head_sha).at(-1)?.action || null;
    } catch {
      ledger = null;
    }
    // The same round-ledger rule `dirf review ready` enforces.
    try { assertReviewRoundRecorded(slug, chosen.review); ledgerReady = true; } catch { ledgerReady = false; }
  }
  return {
    path: chosen.path,
    head_sha: chosen.review.target.head_sha.toLowerCase(),
    at_current_head: Boolean(head) && chosen.review.target.head_sha.toLowerCase() === head,
    verdict: deriveVerdict(chosen.review),
    blocking_findings: blocking.length,
    findings: chosen.review.findings.length,
    schema_version: chosen.review.schema_version,
    mode: chosen.review.target.mode,
    repository: chosen.review.target.repository,
    base_sha: chosen.review.target.base_sha.toLowerCase(),
    confidence: { quality: chosen.review.confidence.quality, evidence: chosen.review.confidence.evidence },
    ledger_action: ledger,
    ledger_ready: ledgerReady,
    reviewed_at: new Date(chosen.mtime).toISOString(),
  };
}

// ── board ────────────────────────────────────────────────────────────────────

// PR numbers an attempt names in its own handoff. Bare "#N" is noisy in
// prose, so it counts only on a line that also mentions a PR, merge, or review.
export function handoffPullRequests(markdown) {
  const numbers = new Set();
  const text = String(markdown || "");
  for (const match of text.matchAll(/\/pull\/(\d+)\b/gi)) numbers.add(Number(match[1]));
  for (const match of text.matchAll(/\bPR\s*#?\s*(\d+)\b/gi)) numbers.add(Number(match[1]));
  for (const match of text.matchAll(/\bpr:(\d+)\b/gi)) numbers.add(Number(match[1]));
  for (const match of text.matchAll(/\bpull request\s*#(\d+)\b/gi)) numbers.add(Number(match[1]));
  for (const line of text.split(/\r?\n/)) {
    if (!/\b(?:prs?|pull requests?|merge[ds]?|review(?:ed)?)\b/i.test(line)) continue;
    for (const match of line.matchAll(/(?:^|[\s(,;/-])#(\d+)\b/g)) numbers.add(Number(match[1]));
  }
  return numbers;
}

// Handoff PR numbers with link strength. "strong": only the structured
// `## Work item` line (pr:N) claims a PR as this attempt's own. Prose is never
// parsed for ownership ("opened PR #N" and "waiting on the open PR #N" read
// alike), so every other mention is "handoff": shown, but never shipped work.
export function handoffPullRequestLinks(markdown) {
  const text = String(markdown || "");
  const links = new Map([...handoffPullRequests(text)].map((number) => [number, "handoff"]));
  const workItem = text.match(/^##\s*Work item\s*\r?\n+([^\n]*)/im)?.[1] || "";
  for (const match of workItem.matchAll(/\bpr:(\d+)\b/gi)) links.set(Number(match[1]), "strong");
  return links;
}

function readText(path) {
  try { return path ? readFileSync(path, "utf8") : ""; } catch { return ""; }
}

function attemptReviewPr(folder) {
  try {
    const review = JSON.parse(readFileSync(join(folder, "review.json"), "utf8"));
    return Number.isInteger(review?.target?.pr_number) ? review.target.pr_number : null;
  } catch {
    return null;
  }
}

function lastActivity(attempt) {
  let latest = Date.parse(attempt.updated_at || attempt.created_at || 0) || 0;
  const observed = Date.parse(attempt.execution?.observed_at || 0) || 0;
  if (observed > latest) latest = observed;
  if (attempt.handoff_path) {
    try { latest = Math.max(latest, statSync(attempt.handoff_path).mtimeMs); } catch { /* removed since the snapshot */ }
  }
  return latest;
}

function staleAttemptDays() {
  const days = readSettings().stale_attempt_days;
  return Number.isInteger(days) && days > 0 ? days : 7;
}

function defaultMergeBase(checkout) {
  return (base, head) => {
    try {
      return execFileSync("git", ["-C", checkout, "merge-base", base, head], {
        encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
      }).trim().toLowerCase() || null;
    } catch {
      return null;
    }
  };
}

// The same review rules `dirf review ready` applies before a merge request:
// a schema v2 full review of this repository, at the PR head, against the
// PR's current merge base, with no findings and a PASS verdict.
function reviewMergeReasons(review, { headSha, origin, mergeBase }) {
  const reasons = [];
  if (review.head_sha !== headSha) reasons.push("review is not at the current head");
  if (review.schema_version !== 2) reasons.push("review is not schema version 2");
  if (review.mode !== "full") reasons.push(`review mode is ${review.mode}, not full`);
  if (review.blocking_findings > 0) reasons.push(`${review.blocking_findings} fix-now finding(s)`);
  else if (review.findings > 0) reasons.push(`${review.findings} open finding(s)`);
  // CONDITIONAL also covers low confidence, failed verification,
  // limitations, and unresolved threads with no findings.
  else if (review.verdict !== "PASS") reasons.push(`review ${review.verdict}`);
  if (!origin) reasons.push("repository not verified (no origin)");
  else if (normalizeRepository(review.repository) !== normalizeRepository(origin)) reasons.push("review names a different repository");
  if (!mergeBase || mergeBase !== review.base_sha) reasons.push("review base does not match the PR merge base");
  if (!review.ledger_ready) reasons.push("no clean review round recorded for this head (dirf review trigger)");
  return reasons;
}

function prView(pr, review, { origin = null, mergeBase = () => null, link = null } = {}) {
  const open = pr.state === "OPEN";
  const checks = open ? checkStatus(pr.statusCheckRollup) : null;
  const reasons = [];
  if (open) {
    if (pr.isDraft) reasons.push("draft");
    if (!review) reasons.push("no review found");
    else {
      const head = String(pr.headRefOid || "").toLowerCase();
      const base = pr.baseRefOid && head ? mergeBase(pr.baseRefOid, head) : null;
      reasons.push(...reviewMergeReasons(review, { headSha: head, origin, mergeBase: base }));
    }
    if (checks !== "passing") reasons.push(`checks ${checks}`);
    if (pr.mergeable !== "MERGEABLE") reasons.push(`mergeable ${String(pr.mergeable || "unknown").toLowerCase()}`);
    else if (BLOCKED_MERGE_STATES.has(pr.mergeStateStatus)) reasons.push(`merge state ${String(pr.mergeStateStatus).toLowerCase()}`);
  }
  return {
    number: pr.number,
    title: pr.title || "",
    url: pr.url || null,
    state: pr.state,
    branch: pr.headRefName || null,
    head_sha: pr.headRefOid ? String(pr.headRefOid).toLowerCase() : null,
    base_ref_oid: pr.baseRefOid ? String(pr.baseRefOid).toLowerCase() : null,
    link,
    draft: Boolean(pr.isDraft),
    checks,
    mergeable: open ? pr.mergeable || "UNKNOWN" : null,
    merge_state: open ? pr.mergeStateStatus || "UNKNOWN" : null,
    merged_at: pr.mergedAt || null,
    merge_commit: pr.mergeCommit?.oid || null,
    review,
    ready_to_merge: open && reasons.length === 0,
    not_ready: reasons,
  };
}

// Board for one project: every open attempt (planned, in progress, blocked)
// with its linked PRs, plus open PRs no attempt claims.
export function boardSnapshot(slug, { checkout, now = new Date(), gh = defaultGh, includeClosedPrs = true, requireOrigin = true, lookupMissing = includeClosedPrs, mergeBase } = {}) {
  const work = projectWorkSnapshot(slug, now);
  const staleDays = staleAttemptDays();
  const openAttempts = work.attempts.filter((attempt) => attempt.tracked && OPEN_STATES.has(attempt.lifecycle_status));
  const base = checkout || work.project.main_path;
  const github = base
    ? readPullRequests(base, { gh, includeClosed: includeClosedPrs, requireOrigin })
    : { available: false, reason: "no local checkout", prs: [] };
  const prsByNumber = new Map(github.prs.map((pr) => [pr.number, pr]));
  const origin = base ? readOrigin(base) : null;
  const viewContext = { origin, mergeBase: mergeBase || (base ? defaultMergeBase(base) : () => null) };
  const checkouts = [...new Set([base, work.project.main_path, ...openAttempts.map((attempt) => attempt.worktree_path)]
    .filter((path) => path && existsSync(path)))];
  const reviewFor = (pr, attemptFolders) => pr.state === "OPEN"
    ? latestReview(pr.number, pr.headRefOid, { checkouts, attemptFolders }, { slug })
    : null;

  const linked = openAttempts.map((attempt) => {
    const folder = storeAttemptDir(slug, attempt.id);
    // strong: the branch, the PR body, or the attempt's review.json names it.
    // handoff: only the handoff prose names it (it may be a dependency).
    const links = handoffPullRequestLinks(readText(attempt.handoff_path));
    const reviewPr = attemptReviewPr(folder);
    if (reviewPr) links.set(reviewPr, "strong");
    const branches = new Set([attempt.responsibility_branch, attempt.execution?.branch].filter(Boolean));
    const createdAt = Date.parse(attempt.created_at || 0) || 0;
    for (const pr of github.prs) {
      // A reused branch name must not link an older attempt's finished PR.
      const finishedAt = Date.parse(pr.mergedAt || pr.closedAt || 0) || 0;
      if (branches.has(pr.headRefName) && (pr.state === "OPEN" || finishedAt >= createdAt)) links.set(pr.number, "strong");
      else if (pr.state === "OPEN" && String(pr.body || "").includes(attempt.id)) links.set(pr.number, "strong");
    }
    return { attempt, folder, links };
  });
  // PRs an attempt names that fell outside the list window: look them up one by one.
  // A number GitHub says is no PR (often an issue named as "#N") is dropped;
  // any other lookup failure stays UNKNOWN so cleanup never closes on it.
  const notPullRequests = new Set();
  if (github.available && lookupMissing) {
    const missing = [...new Set(linked.flatMap(({ links }) => [...links.keys()]))].filter((number) => !prsByNumber.has(number));
    for (const number of missing.slice(0, MAX_EXTRA_PR_LOOKUPS)) {
      try {
        const pr = JSON.parse(gh(["pr", "view", String(number), "--json", `${OPEN_PR_FIELDS},mergedAt,closedAt,mergeCommit`], { cwd: base }));
        if (pr?.number === number) prsByNumber.set(number, pr);
      } catch (error) {
        if (/could not resolve to a pullrequest|no pull requests? found/i.test(String(error?.stderr || error?.message || ""))) notPullRequests.add(number);
      }
    }
  }

  const claimed = new Set();
  const attempts = linked.map(({ attempt, folder, links }) => {
    // A PR that merged or closed before this attempt existed is context the
    // handoff mentions ("builds on PR #10"), not this attempt's shipped work.
    const createdAt = Date.parse(attempt.created_at || 0) || 0;
    const predates = (number) => {
      const pr = prsByNumber.get(number);
      return Boolean(pr) && pr.state !== "OPEN" && (Date.parse(pr.mergedAt || pr.closedAt || 0) || 0) < createdAt;
    };
    const prs = [...links.keys()].filter((number) => !notPullRequests.has(number) && !predates(number)).sort((a, b) => a - b).map((number) => {
      const pr = prsByNumber.get(number);
      if (!pr) return { number, state: github.available ? "UNKNOWN" : null, link: links.get(number), review: null, ready_to_merge: false, not_ready: [github.available ? "not found on GitHub" : "GitHub unavailable"] };
      claimed.add(number);
      return prView(pr, reviewFor(pr, [folder]), { ...viewContext, link: links.get(number) });
    });
    const activity = lastActivity(attempt);
    const idleDays = activity ? Math.max(0, Math.floor((now.getTime() - activity) / DAY_MS)) : null;
    return {
      id: attempt.id,
      name: attempt.name,
      status: attempt.lifecycle_status,
      live_state: attempt.live_state,
      phase: attempt.current_phase,
      blocker: attempt.blocker,
      updated_at: activity ? new Date(activity).toISOString() : attempt.updated_at,
      idle_days: idleDays,
      stale: idleDays !== null && idleDays >= staleDays,
      next_action: attempt.next_action,
      next_action_done: DONE_NEXT_ACTION.test(attempt.next_action || ""),
      handoff_path: attempt.handoff_path,
      prs,
    };
  });

  const unlinked = github.prs
    .filter((pr) => pr.state === "OPEN" && !claimed.has(pr.number))
    .sort((a, b) => a.number - b.number)
    .map((pr) => prView(pr, reviewFor(pr, []), viewContext));

  return {
    generated_at: now.toISOString(),
    project: work.project,
    stale_attempt_days: staleDays,
    github: { available: github.available, reason: github.reason, open_prs: github.prs.filter((pr) => pr.state === "OPEN").length },
    summary: {
      open_attempts: attempts.length,
      stale: attempts.filter((attempt) => attempt.stale).length,
      ready_to_merge: [...attempts.flatMap((attempt) => attempt.prs), ...unlinked].filter((pr) => pr.ready_to_merge).length,
    },
    attempts,
    unlinked_prs: unlinked,
  };
}

function age(days) {
  return days === null ? "?" : `${days}d`;
}

function clip(text, width = 100) {
  const line = String(text || "").replace(/\s+/g, " ").trim();
  return line.length > width ? `${line.slice(0, width - 1)}…` : line;
}

export function formatPrLine(pr) {
  if (!pr.state || pr.state === "UNKNOWN") return `PR #${pr.number} · ${pr.not_ready.join(", ")}`;
  if (pr.state !== "OPEN") return `PR #${pr.number} ${pr.state.toLowerCase()}${pr.merge_commit ? ` (${pr.merge_commit.slice(0, 7)})` : ""}`;
  const review = pr.review
    ? `review ${pr.review.verdict} q${pr.review.confidence.quality}/e${pr.review.confidence.evidence} ${pr.review.at_current_head ? "@head" : `@${pr.review.head_sha.slice(0, 7)} (old head)`}${pr.review.blocking_findings ? ` · ${pr.review.blocking_findings} fix-now` : ""}`
    : "no review";
  const mergeable = pr.mergeable === "MERGEABLE" ? "mergeable" : `mergeable ${String(pr.mergeable).toLowerCase()}`;
  const flag = pr.ready_to_merge ? "READY " : "";
  return `${flag}PR #${pr.number}${pr.draft ? " (draft)" : ""} · ${review} · checks ${pr.checks} · ${mergeable}`;
}

export function formatBoard(board) {
  const lines = [];
  const name = board.project.name || board.project.slug;
  lines.push(`DIRF board — ${name} · ${board.summary.open_attempts} open attempt(s) · ${board.summary.stale} stale (>${board.stale_attempt_days}d) · ${board.summary.ready_to_merge} PR(s) ready to merge`);
  if (!board.github.available) lines.push(`GitHub: unavailable (${board.github.reason}); PR columns are empty.`);
  if (!board.attempts.length) lines.push("", "No open attempts.");
  for (const attempt of board.attempts) {
    const state = `${attempt.stale ? "STALE" : attempt.status.replace("_", " ").toUpperCase()} ${age(attempt.idle_days)}`;
    lines.push("", `${state.padEnd(16)} ${attempt.name} · ${attempt.phase || "no phase"} · ${attempt.id}`);
    if (attempt.blocker) lines.push(`  blocked: ${clip(attempt.blocker)}`);
    else if (attempt.next_action) lines.push(`  next: ${clip(attempt.next_action)}`);
    // Open and unknown PRs get a line each; finished ones collapse to one line.
    for (const pr of attempt.prs.filter((item) => !["MERGED", "CLOSED"].includes(item.state))) lines.push(`  ${formatPrLine(pr)}`);
    for (const state of ["MERGED", "CLOSED"]) {
      const numbers = attempt.prs.filter((item) => item.state === state).map((item) => `#${item.number}`);
      if (!numbers.length) continue;
      const shown = numbers.length > 8 ? [...numbers.slice(0, 3), "…", ...numbers.slice(-3)] : numbers;
      lines.push(`  ${state.toLowerCase()}: ${numbers.length} PR(s) ${shown.join(" ")}`);
    }
  }
  if (board.unlinked_prs.length) {
    lines.push("", "Open PRs with no attempt:");
    for (const pr of board.unlinked_prs) lines.push(`  ${formatPrLine(pr)} · ${clip(pr.title, 60)}`);
  }
  lines.push("", "Close finished work: dirf cleanup (dry run) · dirf cleanup --apply");
  return lines.join("\n");
}

// ── cleanup ──────────────────────────────────────────────────────────────────

// Proposed actions, in apply order: merges first, so an attempt whose last PR
// merges in this run can close in the same run.
export function cleanupPlan(board) {
  const actions = [];
  const merging = new Set();
  const allPrs = new Map();
  for (const pr of [...board.attempts.flatMap((attempt) => attempt.prs), ...board.unlinked_prs]) allPrs.set(pr.number, pr);
  for (const pr of allPrs.values()) {
    if (!pr.ready_to_merge) continue;
    merging.add(pr.number);
    const owners = board.attempts.filter((attempt) => attempt.prs.some((item) => item.number === pr.number)).map((attempt) => attempt.id);
    actions.push({
      kind: "merge",
      pr: pr.number,
      head_sha: pr.head_sha,
      review_path: pr.review.path,
      base_ref_oid: pr.base_ref_oid,
      attempts: owners,
      summary: `Squash-merge PR #${pr.number} (review ${pr.review.verdict} at head ${pr.head_sha.slice(0, 7)}, checks passing, mergeable)`,
    });
  }
  const closing = new Set();
  for (const attempt of board.attempts) {
    const known = attempt.prs.filter((pr) => pr.state);
    // Only strongly linked PRs count as this attempt's shipped work.
    const merged = known.filter((pr) => pr.state === "MERGED" && pr.link === "strong").map((pr) => pr.number);
    const pendingMerge = known.filter((pr) => pr.state === "OPEN" && merging.has(pr.number) && pr.link === "strong").map((pr) => pr.number);
    const pendingAny = known.filter((pr) => pr.state === "OPEN" && merging.has(pr.number)).map((pr) => pr.number);
    const stillOpen = known.filter((pr) => pr.state === "OPEN" && !merging.has(pr.number));
    const unresolved = attempt.prs.some((pr) => !pr.state || pr.state === "UNKNOWN");
    const shippedByPrs = !unresolved && attempt.prs.length > 0 && stillOpen.length === 0 && merged.length + pendingMerge.length > 0;
    if (shippedByPrs || (attempt.next_action_done && stillOpen.length === 0 && !unresolved)) {
      closing.add(attempt.id);
      const why = shippedByPrs
        ? `all linked PRs merged${pendingMerge.length ? " after this run's merges" : ""}: ${[...merged, ...pendingMerge].map((n) => `#${n}`).join(", ")}`
        : `next action says done: "${clip(attempt.next_action, 60)}"`;
      actions.push({
        kind: "close",
        attempt: attempt.id,
        name: attempt.name,
        outcome: "shipped",
        prs: [...merged, ...pendingMerge],
        requires_merge: pendingAny,
        next_action: attempt.next_action,
        summary: `Close ${attempt.name} as shipped (${why})`,
      });
    }
  }
  for (const attempt of board.attempts) {
    if (!attempt.stale || closing.has(attempt.id)) continue;
    actions.push({
      kind: "stale",
      attempt: attempt.id,
      name: attempt.name,
      idle_days: attempt.idle_days,
      summary: `${attempt.name} idle ${attempt.idle_days}d — keep, close (shipped), or abandon?`,
    });
  }
  return actions;
}

export function formatCleanupPlan(actions, { apply = false } = {}) {
  if (!actions.length) return "Nothing to clean up.";
  const lines = [`${apply ? "Cleanup" : "Cleanup (dry run)"} — ${actions.length} proposed action(s):`];
  actions.forEach((action, index) => lines.push(`  ${index + 1}. [${action.kind}] ${action.summary}`));
  if (!apply) lines.push("", "Nothing changed. Run dirf cleanup --apply to choose per item, or --apply --yes to accept the merges and closes listed.");
  return lines.join("\n");
}

function closeNote(action) {
  const parts = ["closed by dirf cleanup"];
  if (action.next_action) parts.push(`next action: ${clip(action.next_action, 200)}`);
  return parts.join("; ");
}

// Apply with per-item confirmation. `ask(question)` resolves to the answer
// text. With `yes`, merges and closes are accepted and stale attempts are kept:
// a stale attempt needs a person to choose between close and abandon.
function reviewStillPasses(slug, action) {
  try {
    const review = JSON.parse(readFileSync(action.review_path, "utf8"));
    validateReview(review);
    assertReviewRoundRecorded(slug, review);
    return review.schema_version === 2 && review.target.mode === "full" && review.findings.length === 0
      && review.target.head_sha.toLowerCase() === action.head_sha && deriveVerdict(review) === "PASS";
  } catch {
    return false;
  }
}

const THREADS_QUERY = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved} pageInfo{hasNextPage}}}}}";

// Live review conversations, as `dirf review ready` checks them. Any doubt
// (unreadable, more than one page) counts as unresolved.
function liveThreadsResolved(ghJson, prNumber) {
  try {
    const graph = ghJson(["api", "graphql", "-f", `query=${THREADS_QUERY}`, "-F", "owner={owner}", "-F", "name={repo}", "-F", `number=${prNumber}`]);
    const connection = graph?.data?.repository?.pullRequest?.reviewThreads;
    return Array.isArray(connection?.nodes) && connection.pageInfo?.hasNextPage === false
      && connection.nodes.every((thread) => thread.isResolved === true);
  } catch {
    return false;
  }
}

export async function applyCleanup(slug, actions, { checkout, gh = defaultGh, ask, yes = false, authorityToken, log = console.log, now = new Date() } = {}) {
  const results = [];
  const merged = new Map();
  const ghJson = (args) => JSON.parse(gh(args, { cwd: checkout }));
  const confirm = async (question) => yes || /^y(?:es)?$/i.test(String(await ask(`${question} [y/N] `)).trim());

  for (const action of actions) {
    try {
      if (action.kind === "merge") {
        if (!(await confirm(`Merge PR #${action.pr}?`))) { results.push({ ...action, result: "skipped" }); continue; }
        // Re-read the PR so a push since the board snapshot cannot be merged unreviewed.
        // The review file is re-read too, so a newer verdict there stops the merge.
        const live = ghJson(["pr", "view", String(action.pr), "--json", "state,headRefOid,baseRefOid,isDraft,mergeable,mergeStateStatus,statusCheckRollup"]);
        if (live.state !== "OPEN" || String(live.headRefOid).toLowerCase() !== action.head_sha || live.isDraft
          || String(live.baseRefOid || "").toLowerCase() !== action.base_ref_oid
          || live.mergeable !== "MERGEABLE" || BLOCKED_MERGE_STATES.has(live.mergeStateStatus)
          || checkStatus(live.statusCheckRollup) !== "passing" || !reviewStillPasses(slug, action)
          || !liveThreadsResolved(ghJson, action.pr)) {
          results.push({ ...action, result: "skipped", reason: "PR, review, or conversations no longer qualify" });
          log(`  PR #${action.pr}: skipped — PR, review, or conversations no longer qualify`);
          continue;
        }
        gh(["pr", "merge", String(action.pr), "--squash", "--match-head-commit", action.head_sha], { cwd: checkout });
        const after = ghJson(["pr", "view", String(action.pr), "--json", "state,url,mergedAt,mergeCommit"]);
        merged.set(action.pr, { number: action.pr, url: after.url || null, merge_commit: after.mergeCommit?.oid || null, merged_at: after.mergedAt || null });
        results.push({ ...action, result: "merged", merge_commit: after.mergeCommit?.oid || null });
        log(`  PR #${action.pr}: merged${after.mergeCommit?.oid ? ` (${after.mergeCommit.oid.slice(0, 7)})` : ""}`);
      } else if (action.kind === "close") {
        const missing = action.requires_merge.filter((number) => !merged.has(number));
        if (missing.length) {
          results.push({ ...action, result: "skipped", reason: `PR ${missing.map((n) => `#${n}`).join(", ")} did not merge in this run` });
          log(`  ${action.name}: skipped — PR ${missing.map((n) => `#${n}`).join(", ")} did not merge`);
          continue;
        }
        if (!(await confirm(`Close ${action.name} as shipped?`))) { results.push({ ...action, result: "skipped" }); continue; }
        const prs = [];
        for (const number of action.prs) {
          if (merged.has(number)) { prs.push(merged.get(number)); continue; }
          const view = ghJson(["pr", "view", String(number), "--json", "state,url,mergedAt,mergeCommit"]);
          if (view.state !== "MERGED") throw new Error(`PR #${number} is ${view.state}, not merged`);
          prs.push({ number, url: view.url || null, merge_commit: view.mergeCommit?.oid || null, merged_at: view.mergedAt || null });
        }
        updateAttemptLifecycle(slug, action.attempt, "close", {
          outcome: "shipped",
          prs,
          note: closeNote(action),
          verifiedBy: prs.length ? "gh" : "manual",
        }, now);
        results.push({ ...action, result: "closed" });
        log(`  ${action.name}: closed (shipped)`);
      } else if (action.kind === "stale") {
        if (yes) { results.push({ ...action, result: "kept", reason: "--yes keeps stale attempts" }); log(`  ${action.name}: kept (choose without --yes)`); continue; }
        const answer = String(await ask(`${action.name} idle ${action.idle_days}d — [k]eep, [c]lose as shipped, [a]bandon? [k] `)).trim().toLowerCase();
        if (answer === "c" || answer === "close") {
          updateAttemptLifecycle(slug, action.attempt, "close", {
            outcome: "shipped",
            note: `closed by dirf cleanup after ${action.idle_days}d idle; a person confirmed the work shipped`,
          }, now);
          results.push({ ...action, result: "closed" });
          log(`  ${action.name}: closed (shipped)`);
        } else if (answer === "a" || answer === "abandon") {
          updateAttemptLifecycle(slug, action.attempt, "abandon", {
            reason: `abandoned by dirf cleanup after ${action.idle_days}d idle`,
            authorityToken,
          }, now);
          results.push({ ...action, result: "abandoned" });
          log(`  ${action.name}: abandoned`);
        } else {
          results.push({ ...action, result: "kept" });
        }
      }
    } catch (error) {
      results.push({ ...action, result: "failed", reason: error.message });
      log(`  ${action.kind} ${action.pr ? `#${action.pr}` : action.name}: failed — ${error.message}`);
    }
  }
  return results;
}

// ── surfacing on new work ────────────────────────────────────────────────────

// Short "unfinished work" notice for build/plan/create. Never prompts, never
// throws: a failure here must not stop new work from starting.
export function unfinishedWorkNotice(slug, { checkout, gh = defaultGh, limit = 5, now = new Date(), requireOrigin = true, mergeBase } = {}) {
  let board;
  try {
    // One open-PR list with a short timeout: the notice must not slow new work.
    const quickGh = (args, options = {}) => gh(args, { ...options, timeout: NOTICE_GH_TIMEOUT_MS });
    board = boardSnapshot(slug, { checkout, gh: quickGh, now, includeClosedPrs: false, lookupMissing: false, requireOrigin, mergeBase });
  } catch {
    return null;
  }
  const ready = [...board.attempts.flatMap((attempt) => attempt.prs), ...board.unlinked_prs].filter((pr) => pr.ready_to_merge);
  if (!board.attempts.length && !ready.length) return null;
  const lines = [`Unfinished work in this project: ${board.attempts.length} open attempt(s)${ready.length ? `, ${ready.length} PR(s) passing review but not merged` : ""}.`];
  const items = [
    ...ready.map((pr) => `  PR #${pr.number} ready to merge (review ${pr.review.verdict} at head, checks passing)`),
    ...board.attempts.map((attempt) => `  ${(attempt.stale ? `stale ${age(attempt.idle_days)}` : attempt.status.replace("_", " ")).padEnd(11)} ${attempt.name} · ${age(attempt.idle_days)} idle${attempt.next_action ? ` · next: ${clip(attempt.next_action, 60)}` : ""}`),
  ];
  lines.push(...items.slice(0, limit));
  if (items.length > limit) lines.push(`  … ${items.length - limit} more`);
  lines.push("  See all: dirf board · Close finished work: dirf cleanup");
  return lines.join("\n");
}
