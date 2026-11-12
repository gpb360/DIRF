#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { validateReview, priorityCounts, deriveVerdict, blockingFindings, followUpFindings } from "./review-report.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
export const MAX_LOOP_ROUNDS = 5;
// The forced rethink leaves two rounds to use the new approach.
const RETHINK_BEFORE_LIMIT = 2;
const FIX_ACTIONS = new Set(["fix_and_update_same_pr", "reconsider_approach"]);
const MIN_ROUNDS_FOR_RETHINK = 3;

function rethinkRound(maxRounds) {
  return maxRounds >= MIN_ROUNDS_FOR_RETHINK ? maxRounds - RETHINK_BEFORE_LIMIT : null;
}

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
export function ledgerAction(review, count = {}) {
  validateReview(review);
  if (review.schema_version !== 2) {
    throw new Error("Review ledger triggers require schema version 2; historical reports are read-only.");
  }
  const counts = priorityCounts(review);
  const brief = ({ id, priority, axis, title, file, line, body, evidence }) => ({
    id, priority, axis, title, file, line, body, evidence,
  });
  // Only blocking findings go to a fixer or count against the round limit.
  const findings = blockingFindings(review).map(brief);
  const followUp = followUpFindings(review).map(({ base_evidence, ...finding }) => ({ ...brief(finding), base_evidence }));
  const extra = followUp.length > 0 ? { follow_up_findings: followUp } : {};

  // The DIRF store supplies the count through dirf review trigger. The target
  // fields are only the fallback for running this script directly.
  const round = count.round ?? review.target.round ?? 1;
  const maxRounds = count.max_rounds ?? review.target.max_rounds ?? MAX_LOOP_ROUNDS;
  const remaining = Math.max(maxRounds - round, 0);
  const failedCheck = review.verification.some(({ status }) => status === "failed")
    || review.completion?.required_checks === "failed";

  // An agent fixer and an agent reviewer can keep each other busy indefinitely.
  // At the limit, the result goes to a person instead of a fixer.
  if (round >= maxRounds && (findings.length > 0 || failedCheck)) {
    return {
      schema_version: 1,
      action: "stop_for_person",
      target: targetOf(review),
      expected_head_sha: review.target.head_sha,
      round,
      max_rounds: maxRounds,
      remaining,
      findings,
      priority_counts: counts,
      ...extra,
      guardrails: { human_decision_required: true, merge_is_not_authorized: true },
    };
  }

  if (findings.length > 0) {
    const rethink = round === rethinkRound(maxRounds);
    return {
      schema_version: 1,
      action: rethink ? "reconsider_approach" : "fix_and_update_same_pr",
      ...(rethink ? { approach_change_required: true } : {}),
      target: targetOf(review),
      expected_head_sha: review.target.head_sha,
      round,
      max_rounds: maxRounds,
      remaining,
      findings,
      priority_counts: counts,
      ...extra,
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
        round: round + 1,
        max_rounds: maxRounds,
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
    round,
    max_rounds: maxRounds,
    remaining,
    findings: [],
    priority_counts: counts,
    ...extra,
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
  if (!request || request.schema_version !== 1 || !FIX_ACTIONS.has(request.action)) {
    throw new Error("Invalid remediation request: expected a fix_and_update_same_pr or reconsider_approach request.");
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
  if (request.approach_change_required && !updated.approach_change) {
    throw new Error("The updated review must describe the new approach in target.approach_change.");
  }
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
