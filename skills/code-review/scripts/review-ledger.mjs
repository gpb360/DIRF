#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { validateReview, priorityCounts, deriveVerdict } from "./review-report.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

function load(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function targetOf(review) {
  return {
    repository: review.target.repository,
    pr_number: review.target.pr_number,
    base_sha: review.target.base_sha,
    head_sha: review.target.head_sha,
  };
}

/**
 * Turn a validated review into the one next action a harness may execute.
 * This is deliberately a handoff, not an agent invocation: DIRF does not
 * trust a reviewer or fixer to mutate another PR without an exact-head check.
 */
export function ledgerAction(review) {
  validateReview(review);
  if (review.schema_version !== 2) {
    throw new Error("Review ledger triggers require schema version 2; historical reports are read-only.");
  }
  const counts = priorityCounts(review);
  const findings = review.findings.map(({ id, priority, axis, title, file, line, body, evidence }) => ({
    id, priority, axis, title, file, line, body, evidence,
  }));

  if (findings.length > 0) {
    return {
      schema_version: 1,
      action: "fix_and_update_same_pr",
      target: targetOf(review),
      expected_head_sha: review.target.head_sha,
      findings,
      priority_counts: counts,
      guardrails: {
        same_repository: true,
        same_pr_number: true,
        same_base_sha: true,
        head_must_advance: true,
        merge_is_not_authorized: true,
      },
      next_review: {
        mode: "full",
        previous_head_sha: review.target.head_sha,
      },
    };
  }

  return {
    schema_version: 1,
    action: review.target.mode === "full" && deriveVerdict(review) === "PASS"
      ? "verify_merge_readiness"
      : "continue_review",
    target: targetOf(review),
    expected_head_sha: review.target.head_sha,
    findings: [],
    priority_counts: counts,
    guardrails: { live_readiness_required: true, merge_is_not_authorized: true },
  };
}

/**
 * Check that the returned artifact names the same PR and base with a different
 * head. The harness must verify that head against the live PR before re-review.
 */
export function verifyUpdatedReview(request, updatedReview) {
  validateReview(updatedReview);
  if (updatedReview.schema_version !== 2) {
    throw new Error("Updated review must use schema version 2.");
  }
  if (!request || request.schema_version !== 1 || request.action !== "fix_and_update_same_pr") {
    throw new Error("Invalid remediation request: expected a fix_and_update_same_pr request.");
  }
  const original = request.target;
  if (!original || typeof original.repository !== "string" || !original.repository.trim()
    || !Number.isInteger(original.pr_number) || original.pr_number < 1
    || !SHA_PATTERN.test(original.base_sha || "") || !SHA_PATTERN.test(original.head_sha || "")
    || !SHA_PATTERN.test(request.expected_head_sha || "")
    || original.head_sha.toLowerCase() !== request.expected_head_sha.toLowerCase()) {
    throw new Error("Invalid remediation request: the target and expected head must identify the same original PR commit.");
  }
  const updated = updatedReview.target;
  if (updated.repository !== original.repository) throw new Error("The fix changed the review repository.");
  if (updated.pr_number !== original.pr_number) throw new Error("The fix changed the pull request number.");
  if (updated.base_sha !== original.base_sha) throw new Error("The fix changed the pull request base.");
  if (updated.head_sha.toLowerCase() === request.expected_head_sha.toLowerCase()) {
    throw new Error("The fixer did not advance the pull-request head.");
  }
  if (!SHA_PATTERN.test(updated.head_sha)) throw new Error("The updated review head is not a valid Git SHA.");
  return {
    verified: true,
    verification_scope: "artifact_targets_only",
    live_head_verification_required: true,
    action: "trigger_review_ledger",
    repository: updated.repository,
    pr_number: updated.pr_number,
    previous_head_sha: request.expected_head_sha,
    head_sha: updated.head_sha,
    review_target: {
      ...updated,
      mode: "full",
      previous_head_sha: request.expected_head_sha,
    },
  };
}

export function run(argv) {
  const [command, first, second] = argv;
  if (command === "trigger" && first) return ledgerAction(load(first));
  if (command === "verify-update" && first && second) return verifyUpdatedReview(load(first), load(second));
  throw new Error("Usage: node skills/code-review/scripts/review-ledger.mjs <trigger review.json|verify-update request.json updated-review.json>");
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    process.stdout.write(`${JSON.stringify(run(process.argv.slice(2)), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
