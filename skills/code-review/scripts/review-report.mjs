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

export function validateReview(review) {
  const errors = [];

  if (!isObject(review)) throw new ReviewValidationError(["root must be an object"]);
  if (review.schema_version !== 1) errors.push("schema_version must equal 1");

  if (!isObject(review.target)) {
    errors.push("target must be an object");
  } else {
    if (!nonEmptyString(review.target.repository)) errors.push("target.repository is required");
    if (!Number.isInteger(review.target.pr_number) || review.target.pr_number < 1) errors.push("target.pr_number must be a positive integer");
    if (!/^refs\/[A-Za-z0-9._/-]+$/.test(review.target.base_ref || "") || review.target.base_ref.includes("..")) {
      errors.push("target.base_ref must be a safe refs/... Git reference");
    }
    if (!/^refs\/[A-Za-z0-9._/-]+$/.test(review.target.remote_head_ref || "") || review.target.remote_head_ref.includes("..")) {
      errors.push("target.remote_head_ref must be a safe refs/... Git reference");
    }
    if (!SHA_PATTERN.test(review.target.base_sha || "")) errors.push("target.base_sha must be a 40-character Git SHA");
    if (!SHA_PATTERN.test(review.target.head_sha || "")) errors.push("target.head_sha must be a 40-character Git SHA");
    if (review.target.base_sha === review.target.head_sha) errors.push("target.base_sha and target.head_sha must differ");
    if (!MODES.has(review.target.mode)) errors.push("target.mode must be full or incremental");
    if (review.target.mode === "incremental" && !SHA_PATTERN.test(review.target.previous_head_sha || "")) {
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
      if (!isObject(item) || !nonEmptyString(item.command) || !nonEmptyString(item.result) || !VERIFICATION_STATUSES.has(item.status)) {
        errors.push(`verification[${index}] requires command, status (passed, pending, or failed), and result`);
      }
    });
  }

  if (!Array.isArray(review.limitations) || review.limitations.some((item) => !nonEmptyString(item))) {
    errors.push("limitations must be an array of non-empty strings");
  }
  if (!isObject(review.completion)) {
    errors.push("completion must be an object");
  } else {
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
    review.verification.some(({ status }) => status !== "passed") ||
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
  const counts = priorityCounts(review);
  const issueCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (issueCount > 0) {
    throw new Error(`${issueCount} review issue${issueCount === 1 ? " remains" : "s remain"}. Fix ${issueCount === 1 ? "it" : "them"} and review the updated PR again.`);
  }
  const currentHead = gitContext?.current_head || "";
  if (!SHA_PATTERN.test(currentHead) || review.target.head_sha.toLowerCase() !== currentHead.toLowerCase()) {
    throw new Error("The review covers an older commit. Review the current commit before asking to merge.");
  }
  if (!SHA_PATTERN.test(gitContext?.remote_pr_head || "") || review.target.head_sha.toLowerCase() !== gitContext.remote_pr_head.toLowerCase()) {
    throw new Error("The pull request has a newer commit. Refresh it and review that commit before asking to merge.");
  }
  const expectedRepository = normalizeRepository(review.target.repository);
  const actualRepository = normalizeRepository(gitContext?.repository);
  if (!actualRepository || !(actualRepository === expectedRepository || actualRepository.endsWith(`/${expectedRepository}`))) {
    throw new Error("The review names a different repository from this checkout.");
  }
  if (!gitContext?.base_exists || !gitContext?.base_is_ancestor || !gitContext?.base_matches_merge_base) {
    throw new Error("The review base is missing or does not match the current pull-request base.");
  }
  if (review.target.mode === "incremental" && (!gitContext?.previous_head_exists || !gitContext?.previous_head_is_ancestor)) {
    throw new Error("The previous reviewed commit is missing or is not an ancestor of the current commit.");
  }
  if (!review.completion?.review_complete) throw new Error("The latest review is not complete yet.");
  if (review.verification.some(({ status }) => status !== "passed") || review.completion.required_checks !== "passed") {
    throw new Error("The required checks have not all passed.");
  }
  if (review.completion.unresolved_threads !== 0) {
    throw new Error(`${review.completion.unresolved_threads} review conversation${review.completion.unresolved_threads === 1 ? " is" : "s are"} still unresolved.`);
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
  return `<!-- dirf-review:v1;head=${review.target.head_sha};mode=${review.target.mode} -->`;
}

export function renderReview(review) {
  validateReview(review);
  const verdict = deriveVerdict(review);
  const grade = deriveGrade(review);
  const counts = priorityCounts(review);
  const lines = [
    "# DIRF PR review",
    "",
    `**Gate:** ${verdict}`,
    `**Grade:** ${grade}`,
    `**Review confidence:** Quality ${review.confidence.quality}% · Evidence ${review.confidence.evidence}%`,
    `**Priority count:** P0 ${counts.P0} · P1 ${counts.P1} · P2 ${counts.P2} · P3 ${counts.P3}`,
    `**Definition of done:** ${verdict === "PASS" ? "MET — no P0-P3 findings remain on this exact head" : "NOT MET — fix every P0-P3 finding, verify the behavior, and re-review the new head"}`,
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
  else lines.push(...review.verification.map(({ command, status, result }) => `- \`${command}\` — ${status}: ${result}`));

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

function currentGitContext(review) {
  let remotePrHead = "";
  let remoteBaseHead = "";
  try {
    remotePrHead = gitOutput(["ls-remote", "--exit-code", "origin", review.target.remote_head_ref]).split(/\s+/)[0] || "";
    remoteBaseHead = gitOutput(["ls-remote", "--exit-code", "origin", review.target.base_ref]).split(/\s+/)[0] || "";
  } catch {
    throw new Error("DIRF could not read the live pull-request commit and base from origin.");
  }
  const currentHead = gitOutput(["rev-parse", "HEAD"]);
  const base = review.target.base_sha;
  const previous = review.target.previous_head_sha;
  if (!gitSucceeds(["cat-file", "-e", `${remoteBaseHead}^{commit}`])) {
    try {
      execFileSync("git", ["fetch", "--quiet", "--no-tags", "origin", remoteBaseHead], { windowsHide: true, stdio: "ignore" });
    } catch {
      throw new Error("DIRF could not load the current pull-request base commit from origin.");
    }
  }
  let currentMergeBase = "";
  try { currentMergeBase = gitOutput(["merge-base", remoteBaseHead, currentHead]); } catch { /* reported below */ }
  return {
    current_head: currentHead,
    remote_pr_head: remotePrHead,
    repository: gitOutput(["remote", "get-url", "origin"]),
    base_exists: gitSucceeds(["cat-file", "-e", `${base}^{commit}`]),
    base_is_ancestor: gitSucceeds(["merge-base", "--is-ancestor", base, currentHead]),
    base_matches_merge_base: currentMergeBase.toLowerCase() === base.toLowerCase(),
    previous_head_exists: review.target.mode === "full" || gitSucceeds(["cat-file", "-e", `${previous}^{commit}`]),
    previous_head_is_ancestor: review.target.mode === "full" || gitSucceeds(["merge-base", "--is-ancestor", previous, currentHead]),
  };
}

export function run(argv) {
  const [command, file] = argv;
  if (!file || !new Set(["validate", "render", "ready"]).has(command)) throw new Error(usage());
  const review = loadReview(file);
  if (command === "validate") {
    validateReview(review);
    return `Valid DIRF review artifact: ${deriveVerdict(review)}`;
  }
  if (command === "ready") {
    const context = currentGitContext(review);
    assertReviewReady(review, context);
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
