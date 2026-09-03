#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const REVIEW_AXES = [
  "spec",
  "correctness",
  "concurrency",
  "security",
  "data",
  "frontend",
  "testing",
  "standards",
];

const AXIS_STATUSES = new Set(["checked", "finding", "not_applicable"]);
const PRIORITIES = ["P0", "P1", "P2", "P3"];
const PRIORITY_ORDER = new Map(PRIORITIES.map((priority, index) => [priority, index]));
const MODES = new Set(["full", "incremental"]);
const VERIFICATION_STATUSES = new Set(["passed", "pending", "failed"]);
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export class ReviewValidationError extends Error {
  constructor(errors) {
    super(`Invalid review artifact:\n- ${errors.join("\n- ")}`);
    this.name = "ReviewValidationError";
    this.errors = errors;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function score(value) {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

function relativeFile(value) {
  return nonEmptyString(value) && !isAbsolute(value) && !value.replaceAll("\\", "/").split("/").includes("..");
}

function repositoryUrl(value) {
  if (!nonEmptyString(value) || /\s/.test(value)) return false;
  if (/^git@[^:]+:.+/.test(value)) return true;
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol && parsed.pathname && (parsed.protocol === "file:" || parsed.hostname));
  } catch {
    return false;
  }
}

export function validateReview(review) {
  const errors = [];

  if (!isObject(review)) throw new ReviewValidationError(["root must be an object"]);
  if (![1, 2].includes(review.schema_version)) errors.push("schema_version must equal 1 or 2");
  const strict = review.schema_version === 2;

  if (!isObject(review.target)) {
    errors.push("target must be an object");
  } else {
    if (!nonEmptyString(review.target.repository)) errors.push("target.repository is required");
    else if (strict && !repositoryUrl(review.target.repository)) errors.push("target.repository must be the canonical repository URL");
    if (strict && (!Number.isInteger(review.target.pr_number) || review.target.pr_number < 1)) errors.push("target.pr_number must be a positive integer");
    if (!SHA_PATTERN.test(review.target.base_sha || "")) errors.push("target.base_sha must be a 40-character Git SHA");
    if (!SHA_PATTERN.test(review.target.head_sha || "")) errors.push("target.head_sha must be a 40-character Git SHA");
    if (review.target.base_sha === review.target.head_sha) errors.push("target.base_sha and target.head_sha must differ");
    if (!MODES.has(review.target.mode)) errors.push("target.mode must be full or incremental");
    if (strict && review.target.mode === "incremental" && !SHA_PATTERN.test(review.target.previous_head_sha || "")) {
      errors.push("target.previous_head_sha must be a 40-character Git SHA in incremental mode");
    }
  }

  if (!Array.isArray(review.walkthrough) || review.walkthrough.length === 0) {
    errors.push("walkthrough must contain at least one changed area");
  } else {
    review.walkthrough.forEach((item, index) => {
      if (!isObject(item)) {
        errors.push(`walkthrough[${index}] must be an object`);
        return;
      }
      if (!nonEmptyString(item.area)) errors.push(`walkthrough[${index}].area is required`);
      if (!nonEmptyString(item.summary)) errors.push(`walkthrough[${index}].summary is required`);
      if (!Array.isArray(item.files) || item.files.length === 0 || item.files.some((file) => !relativeFile(file))) {
        errors.push(`walkthrough[${index}].files must contain repository-relative paths`);
      }
    });
  }

  if (!isObject(review.axes)) {
    errors.push("axes must be an object");
  } else {
    for (const axis of REVIEW_AXES) {
      const result = review.axes[axis];
      if (!isObject(result)) {
        errors.push(`axes.${axis} must be an object`);
        continue;
      }
      if (!AXIS_STATUSES.has(result.status)) errors.push(`axes.${axis}.status is invalid`);
      if (!nonEmptyString(result.evidence)) errors.push(`axes.${axis}.evidence is required`);
    }
  }

  if (!isObject(review.confidence)) {
    errors.push("confidence must be an object");
  } else {
    if (!score(review.confidence.quality)) errors.push("confidence.quality must be an integer from 0 through 100");
    if (!score(review.confidence.evidence)) errors.push("confidence.evidence must be an integer from 0 through 100");
  }

  if (!Array.isArray(review.findings)) {
    errors.push("findings must be an array");
  } else {
    const ids = new Set();
    review.findings.forEach((finding, index) => {
      const at = `findings[${index}]`;
      if (!isObject(finding)) {
        errors.push(`${at} must be an object`);
        return;
      }
      if (!nonEmptyString(finding.id)) errors.push(`${at}.id is required`);
      else if (ids.has(finding.id)) errors.push(`${at}.id must be unique`);
      else ids.add(finding.id);
      if (!PRIORITY_ORDER.has(finding.priority)) errors.push(`${at}.priority must be P0, P1, P2, or P3`);
      if (!Number.isInteger(finding.confidence) || finding.confidence < 80 || finding.confidence > 100) {
        errors.push(`${at}.confidence must be an integer from 80 through 100`);
      }
      if (!REVIEW_AXES.includes(finding.axis)) errors.push(`${at}.axis is invalid`);
      if (!nonEmptyString(finding.title)) errors.push(`${at}.title is required`);
      if (!relativeFile(finding.file)) errors.push(`${at}.file must be a repository-relative path`);
      if (!Number.isInteger(finding.line) || finding.line < 1) errors.push(`${at}.line must be a positive integer`);
      if (!nonEmptyString(finding.body)) errors.push(`${at}.body is required`);
      if (!Array.isArray(finding.evidence) || finding.evidence.length === 0 || finding.evidence.some((item) => !nonEmptyString(item))) {
        errors.push(`${at}.evidence must contain at least one concrete item`);
      }
    });
  }

  if (isObject(review.axes) && Array.isArray(review.findings)) {
    for (const axis of REVIEW_AXES) {
      const hasFinding = review.findings.some((finding) => finding?.axis === axis);
      const status = review.axes[axis]?.status;
      if (hasFinding && status !== "finding") errors.push(`axes.${axis}.status must be finding when that axis has a published finding`);
      if (!hasFinding && status === "finding") errors.push(`axes.${axis}.status cannot be finding without a published finding`);
    }
  }

  if (!Array.isArray(review.verification)) {
    errors.push("verification must be an array");
  } else {
    review.verification.forEach((item, index) => {
      const missingCore = !isObject(item) || !nonEmptyString(item.command) || !nonEmptyString(item.result);
      const invalidStatus = strict && !VERIFICATION_STATUSES.has(item?.status);
      if (missingCore || invalidStatus) {
        errors.push(strict
          ? `verification[${index}] requires command, status (passed, pending, or failed), and result`
          : `verification[${index}] requires command and result`);
      }
    });
  }

  if (!Array.isArray(review.limitations) || review.limitations.some((item) => !nonEmptyString(item))) {
    errors.push("limitations must be an array of non-empty strings");
  }
  if (strict && !isObject(review.completion)) {
    errors.push("completion must be an object");
  } else if (review.completion !== undefined) {
    if (typeof review.completion.review_complete !== "boolean") errors.push("completion.review_complete must be true or false");
    if (!VERIFICATION_STATUSES.has(review.completion.required_checks)) {
      errors.push("completion.required_checks must be passed, pending, or failed");
    }
    if (!Number.isInteger(review.completion.unresolved_threads) || review.completion.unresolved_threads < 0) {
      errors.push("completion.unresolved_threads must be a non-negative integer");
    }
  }
  if (Array.isArray(review.verification) && review.verification.length === 0 && Array.isArray(review.limitations) && review.limitations.length === 0) {
    errors.push("record at least one verification result or limitation");
  }
  if (Object.hasOwn(review, "verdict")) errors.push("verdict is derived and must not be stored in the artifact");

  if (errors.length > 0) throw new ReviewValidationError(errors);
  return review;
}

export function deriveVerdict(review) {
  validateReview(review);
  if (review.findings.some(({ priority }) => priority === "P0" || priority === "P1")) return "FAIL";
  if (
    review.findings.length > 0 ||
    review.limitations.length > 0 ||
    review.verification.some(({ status }) => status && status !== "passed") ||
    review.confidence.quality < 85 ||
    review.confidence.evidence < 80 ||
    (review.completion && (
      !review.completion.review_complete ||
      review.completion.required_checks !== "passed" ||
      review.completion.unresolved_threads !== 0
    ))
  ) return "CONDITIONAL";
  return "PASS";
}

function normalizeRepository(value) {
  let normalized = String(value || "").trim().replaceAll("\\", "/").replace(/\.git$/i, "");
  const ssh = normalized.match(/^git@([^:]+):(.+)$/i);
  if (ssh) normalized = `${ssh[1]}/${ssh[2]}`;
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      normalized = `${parsed.hostname}${parsed.pathname}`;
    } catch { /* validation below reports the mismatch */ }
  }
  return normalized.replace(/^\/+|\/+$/g, "").toLowerCase();
}

export function assertReviewReady(review, gitContext) {
  validateReview(review);
  if (review.schema_version !== 2) throw new Error("Merge readiness requires a schema version 2 review. Historical version 1 reports remain readable.");
  if (review.target.mode !== "full") throw new Error("Merge readiness requires a full review of the current pull request.");
  const counts = priorityCounts(review);
  const issueCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (issueCount > 0) {
    throw new Error(`${issueCount} review issue${issueCount === 1 ? " remains" : "s remain"}. Fix ${issueCount === 1 ? "it" : "them"} and review the updated PR again.`);
  }
  const currentHead = gitContext?.current_head || "";
  if (!SHA_PATTERN.test(currentHead) || review.target.head_sha.toLowerCase() !== currentHead.toLowerCase()) {
    throw new Error("The checkout commit differs from the reviewed commit. Check out and review the current PR commit before asking to merge.");
  }
  if (!SHA_PATTERN.test(gitContext?.remote_pr_head || "") || review.target.head_sha.toLowerCase() !== gitContext.remote_pr_head.toLowerCase()) {
    throw new Error("The pull-request commit changed. Refresh it and review the current commit before asking to merge.");
  }
  const expectedRepository = normalizeRepository(review.target.repository);
  const actualRepository = normalizeRepository(gitContext?.repository);
  if (!actualRepository || actualRepository !== expectedRepository) {
    throw new Error("The review names a different repository from this checkout.");
  }
  if (!gitContext?.base_exists || !gitContext?.base_is_ancestor || !gitContext?.base_matches_merge_base) {
    throw new Error("The review base is missing or does not match the current pull-request base.");
  }
  if (!new Set(["open", "merged"]).has(gitContext?.pr_state)) {
    throw new Error("DIRF could not verify whether the pull request is open or merged.");
  }
  if (gitContext.pr_state === "merged" && (
    !SHA_PATTERN.test(gitContext.merge_commit || "")
    || !gitContext.merge_commit_is_ancestor
  )) {
    throw new Error("DIRF could not verify the merged pull-request commit on its live base branch.");
  }
  if (!review.completion?.review_complete) throw new Error("The latest review is not complete yet.");
  if (review.verification.some(({ status }) => status !== "passed") || review.completion.required_checks !== "passed") {
    throw new Error("The required checks have not all passed.");
  }
  if (!gitContext?.live_checks_skipped && gitContext?.live_checks_passed === false) {
    throw new Error("Live pull-request checks were not verified.");
  }
  if (review.completion.unresolved_threads !== 0) {
    throw new Error(`${review.completion.unresolved_threads} review conversation${review.completion.unresolved_threads === 1 ? " is" : "s are"} still unresolved.`);
  }
  if (gitContext?.live_unresolved_threads !== undefined && gitContext.live_unresolved_threads !== 0) {
    throw new Error(`${gitContext.live_unresolved_threads} live review conversation${gitContext.live_unresolved_threads === 1 ? " is" : "s are"} still unresolved.`);
  }
  if (deriveVerdict(review) !== "PASS") throw new Error("The review is not clear enough to ask for merge approval.");
  return { ready: true, head_sha: review.target.head_sha, pr_number: review.target.pr_number };
}

export function priorityCounts(review) {
  validateReview(review);
  return Object.fromEntries(PRIORITIES.map((priority) => [
    priority,
    review.findings.filter((finding) => finding.priority === priority).length,
  ]));
}

export function deriveGrade(review) {
  validateReview(review);
  const counts = priorityCounts(review);
  if (counts.P0 > 0 || counts.P1 > 0) return "F";
  if (counts.P2 > 0) return "D";
  if (deriveVerdict(review) !== "PASS") return "C";
  if (
    counts.P3 > 0 ||
    review.limitations.length > 0 ||
    review.confidence.quality < 85 ||
    review.confidence.evidence < 80
  ) return "C";
  if (review.confidence.quality >= 90 && review.confidence.evidence >= 90) return "A";
  return "B";
}

function sortedFindings(findings) {
  return [...findings].sort((left, right) =>
    PRIORITY_ORDER.get(left.priority) - PRIORITY_ORDER.get(right.priority)
    || right.confidence - left.confidence
    || left.file.localeCompare(right.file)
    || left.line - right.line
  );
}

function marker(review) {
  return `<!-- dirf-review:v${review.schema_version};head=${review.target.head_sha};mode=${review.target.mode} -->`;
}

export function renderReview(review) {
  validateReview(review);
  const verdict = deriveVerdict(review);
  const grade = deriveGrade(review);
  const counts = priorityCounts(review);
  const historical = review.schema_version === 1;
  const displayedGate = historical ? "NOT APPLICABLE — historical report" : verdict;
  const displayedGrade = historical ? "NOT APPLICABLE" : grade;
  const doneStatus = historical
    ? "NOT APPLICABLE — historical schema version 1 reports are read-only and cannot authorize a merge"
    : verdict === "PASS"
      ? "MET — no P0-P3 findings remain on this exact head"
      : "NOT MET — fix every P0-P3 finding, verify the behavior, and re-review the new head";
  const lines = [
    "# DIRF PR review",
    "",
    `**Gate:** ${displayedGate}`,
    `**Grade:** ${displayedGrade}`,
    `**Review confidence:** Quality ${review.confidence.quality}% · Evidence ${review.confidence.evidence}%`,
    `**Priority count:** P0 ${counts.P0} · P1 ${counts.P1} · P2 ${counts.P2} · P3 ${counts.P3}`,
    `**Definition of done:** ${doneStatus}`,
    `**Target:** \`${review.target.repository}\` at \`${review.target.head_sha}\` against \`${review.target.base_sha}\` (${review.target.mode})`,
    "",
    "## Walkthrough",
    "",
    "| Area | Change | Files |",
    "| --- | --- | --- |",
    ...review.walkthrough.map(({ area, summary, files }) => `| ${area} | ${summary} | ${files.map((file) => `\`${file}\``).join("<br>")} |`),
    "",
    "## Findings",
    "",
  ];

  const findings = sortedFindings(review.findings);
  if (findings.length === 0) {
    lines.push("No actionable findings met the 80% publication threshold.", "");
  } else {
    for (const finding of findings) {
      lines.push(
        `### [${finding.priority}] ${finding.title} — ${finding.confidence}% confidence`,
        "",
        `\`${finding.file}:${finding.line}\` · ${finding.axis}`,
        "",
        finding.body,
        "",
        ...finding.evidence.map((evidence) => `- Evidence: ${evidence}`),
        "",
      );
    }
  }

  lines.push("## Verification", "");
  if (review.verification.length === 0) lines.push("No verification command completed.");
  else lines.push(...review.verification.map(({ command, status, result }) => `- \`${command}\` — ${status ? `${status}: ` : ""}${result}`));

  if (review.limitations.length > 0) {
    lines.push("", "## Limitations", "", ...review.limitations.map((limitation) => `- ${limitation}`));
  }

  lines.push("", marker(review));
  return lines.join("\n");
}

function loadReview(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function usage() {
  return "Usage: node skills/code-review/scripts/review-report.mjs <validate|render|ready> <review.json>";
}

function gitOutput(args) {
  return execFileSync("git", args, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function gitSucceeds(args) {
  try {
    execFileSync("git", args, { windowsHide: true, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ghJson(args, failureMessage) {
  try {
    const raw = execFileSync("gh", ["api", ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const parsed = JSON.parse(raw);
    if (parsed?.errors?.length) throw new Error(parsed.errors.map((error) => error.message).join("; "));
    return parsed;
  } catch {
    throw new Error(failureMessage);
  }
}

function liveGithubState(review, remoteHead) {
  if (/^file:/i.test(String(review.target.repository || "").trim())) return { live_checks_skipped: true };
  const repository = normalizeRepository(review.target.repository);
  if (!/^[^/]+\/[^/]+$/.test(repository)) return null;
  const checks = ghJson([`repos/${repository}/commits/${remoteHead}/check-runs?per_page=100`], "DIRF could not read live pull-request checks from GitHub.");
  const runs = Array.isArray(checks.check_runs) ? checks.check_runs : [];
  if (!runs.length || runs.some((run) => run.status !== "completed" || run.conclusion !== "success")) {
    throw new Error("DIRF could not verify that all live pull-request checks passed.");
  }
  const [owner, name] = repository.split("/");
  const query = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}";
  const graph = ghJson(["graphql", "-f", `query=${query}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${review.target.pr_number}`], "DIRF could not read live pull-request conversations from GitHub.");
  const threads = graph?.data?.repository?.pullRequest?.reviewThreads?.nodes;
  if (!Array.isArray(threads) || threads.some((thread) => thread.isResolved !== true)) {
    throw new Error("DIRF could not verify that all live pull-request conversations are resolved.");
  }
  return { live_checks_passed: true, live_unresolved_threads: 0 };
}

function gitRun(args) {
  execFileSync("git", args, { windowsHide: true, stdio: "ignore" });
}

function remoteSha(output) {
  const value = String(output || "").trim().split(/\s+/)[0] || "";
  return SHA_PATTERN.test(value) ? value : "";
}

function githubPullRequest(review) {
  const repository = normalizeRepository(review.target.repository);
  try {
    const output = execFileSync("gh", [
      "pr",
      "view",
      String(review.target.pr_number),
      "--repo",
      repository,
      "--json",
      "state,mergedAt,mergeCommit,headRefOid,baseRefOid,baseRefName",
    ], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(output);
  } catch {
    throw new Error("DIRF could not read the merged pull-request state from GitHub. Install and authenticate the GitHub CLI, then retry.");
  }
}

function ensureCommit(sha, succeeds, run, message) {
  if (succeeds(["cat-file", "-e", `${sha}^{commit}`])) return;
  try {
    run(["fetch", "--quiet", "--no-tags", "origin", sha]);
  } catch {
    throw new Error(message);
  }
  if (!succeeds(["cat-file", "-e", `${sha}^{commit}`])) throw new Error(message);
}

function currentGitContext(review, io = {}) {
  const output = io.gitOutput || gitOutput;
  const succeeds = io.gitSucceeds || gitSucceeds;
  const runGit = io.gitRun || gitRun;
  const pullRequest = io.pullRequest || githubPullRequest;
  const liveState = io.liveGithubState || liveGithubState;
  let remotePrHead = "";
  let remoteMergeHead = "";
  const prHeadRef = `refs/pull/${review.target.pr_number}/head`;
  const prMergeRef = `refs/pull/${review.target.pr_number}/merge`;
  try {
    remotePrHead = remoteSha(output(["ls-remote", "--exit-code", "origin", prHeadRef]));
    remoteMergeHead = remoteSha(output(["ls-remote", "origin", prMergeRef]));
  } catch {
    throw new Error("DIRF could not read the live pull-request commit and merge base from origin.");
  }
  if (!remotePrHead) throw new Error("DIRF could not read the live pull-request commit from origin.");
  const currentHead = output(["rev-parse", "HEAD"]);
  const base = review.target.base_sha;
  let prState = "open";
  let remoteBaseHead = "";
  let mergeCommitIsAncestor = false;

  if (remoteMergeHead) {
    ensureCommit(remoteMergeHead, succeeds, runGit, "DIRF could not load the live pull-request merge commit from origin.");
    const mergeParents = output(["rev-list", "--parents", "-n", "1", remoteMergeHead]).split(/\s+/);
    if (mergeParents.length !== 3 || mergeParents[2].toLowerCase() !== remotePrHead.toLowerCase()) {
      throw new Error("DIRF could not verify the pull-request head against its live merge commit.");
    }
    remoteBaseHead = mergeParents[1];
  } else {
    const pr = pullRequest(review);
    const mergeCommit = pr?.mergeCommit?.oid || "";
    const baseRefName = String(pr?.baseRefName || "");
    if (pr?.state !== "MERGED" || !pr?.mergedAt) {
      throw new Error("The pull request has no live merge ref and GitHub does not report it as merged.");
    }
    if (
      !SHA_PATTERN.test(pr.headRefOid || "")
      || !SHA_PATTERN.test(pr.baseRefOid || "")
      || !SHA_PATTERN.test(mergeCommit)
      || pr.headRefOid.toLowerCase() !== remotePrHead.toLowerCase()
      || !succeeds(["check-ref-format", `refs/heads/${baseRefName}`])
    ) {
      throw new Error("DIRF could not validate GitHub's merged pull-request metadata.");
    }
    const baseRef = `refs/heads/${baseRefName}`;
    let liveBaseHead = "";
    try {
      liveBaseHead = remoteSha(output(["ls-remote", "--exit-code", "origin", baseRef]));
    } catch {
      throw new Error("DIRF could not read the merged pull request's live base branch from origin.");
    }
    if (!liveBaseHead) throw new Error("DIRF could not read the merged pull request's live base branch from origin.");
    ensureCommit(mergeCommit, succeeds, runGit, "DIRF could not load GitHub's merged pull-request commit from origin.");
    ensureCommit(liveBaseHead, succeeds, runGit, "DIRF could not load the merged pull request's live base branch from origin.");
    const mergeParents = output(["rev-list", "--parents", "-n", "1", mergeCommit]).split(/\s+/);
    if (
      mergeParents.length !== 3
      || mergeParents[1].toLowerCase() !== pr.baseRefOid.toLowerCase()
      || mergeParents[2].toLowerCase() !== remotePrHead.toLowerCase()
    ) {
      throw new Error("DIRF could not verify GitHub's merged pull-request commit against its reported base and head.");
    }
    if (!succeeds(["merge-base", "--is-ancestor", mergeCommit, liveBaseHead])) {
      throw new Error("GitHub's merged pull-request commit is not present on the live base branch.");
    }
    remoteMergeHead = mergeCommit;
    remoteBaseHead = mergeParents[1];
    mergeCommitIsAncestor = true;
    prState = "merged";
  }
  let currentMergeBase = "";
  try { currentMergeBase = output(["merge-base", remoteBaseHead, currentHead]); } catch { /* reported below */ }
  return {
    current_head: currentHead,
    remote_pr_head: remotePrHead,
    repository: output(["remote", "get-url", "origin"]),
    base_exists: succeeds(["cat-file", "-e", `${base}^{commit}`]),
    base_is_ancestor: succeeds(["merge-base", "--is-ancestor", base, currentHead]),
    base_matches_merge_base: currentMergeBase.toLowerCase() === base.toLowerCase(),
    pr_state: prState,
    merge_commit: remoteMergeHead,
    merge_commit_is_ancestor: prState === "open" || mergeCommitIsAncestor,
    ...(prState === "open" ? liveState(review, remotePrHead) : {}),
  };
}

export function run(argv, io = {}) {
  const [command, file] = argv;
  if (!file || !new Set(["validate", "render", "ready"]).has(command)) throw new Error(usage());
  const review = loadReview(file);
  if (command === "validate") {
    validateReview(review);
    return `Valid DIRF review artifact: ${deriveVerdict(review)}`;
  }
  if (command === "ready") {
    validateReview(review);
    if (review.schema_version !== 2) throw new Error("Merge readiness requires a schema version 2 review. Historical version 1 reports remain readable.");
    if (review.target.mode !== "full") throw new Error("Merge readiness requires a full review of the current pull request.");
    const context = currentGitContext(review, io);
    assertReviewReady(review, context);
    if (context.pr_state === "merged") {
      return `Verified: the review matches merged PR #${review.target.pr_number} at ${context.current_head.slice(0, 12)} with merge commit ${context.merge_commit.slice(0, 12)}.`;
    }
    return `Ready: no review issues remain, all required checks passed, and the review matches live PR #${review.target.pr_number} at ${context.current_head.slice(0, 12)}.`;
  }
  return renderReview(review);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    process.stdout.write(`${run(process.argv.slice(2))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
