import { digestValue } from "./governance.js";

export const ISSUE_POLICY_SCHEMA_VERSION = 1;

export const FINDING_STATE = Object.freeze({
  DETECTED: "detected",
  VALIDATED: "validated",
  FIXED_LOCAL: "fixed_local",
  DISMISSED: "dismissed",
  DEFERRED_CANDIDATE: "deferred_candidate",
  AUTHORIZED: "authorized",
  CREATED: "created",
  CONSOLIDATED: "consolidated",
  CLOSED: "closed",
});

export const FINDING_CLASSIFICATION = Object.freeze({
  FIX_NOW: "fix_now",
  DUPLICATE: "duplicate",
  INVALID: "invalid",
  PRODUCT_DECISION: "product_decision",
  DEFERRED_CANDIDATE: "deferred_candidate",
});

export const DEFAULT_ISSUE_POLICY = Object.freeze({
  schemaVersion: ISSUE_POLICY_SCHEMA_VERSION,
  version: "dirf-local-first-issues-v1",
  mode: "pr_deferral_only",
  creationTrigger: "deferred_pr_finding",
  eligiblePriorities: ["P2"],
  minimumPrAcceptancePercent: 90,
  requireHumanAuthorization: true,
  requiredDedupeChecks: ["open_issues", "open_pull_requests", "merged_pull_requests"],
});

const TERMINAL_STATES = new Set([
  FINDING_STATE.FIXED_LOCAL,
  FINDING_STATE.DISMISSED,
  FINDING_STATE.CREATED,
  FINDING_STATE.CONSOLIDATED,
  FINDING_STATE.CLOSED,
]);

const TRANSITIONS = Object.freeze({
  [FINDING_STATE.DETECTED]: new Set([FINDING_STATE.VALIDATED, FINDING_STATE.DISMISSED]),
  [FINDING_STATE.VALIDATED]: new Set([FINDING_STATE.FIXED_LOCAL, FINDING_STATE.DISMISSED, FINDING_STATE.DEFERRED_CANDIDATE]),
  [FINDING_STATE.DEFERRED_CANDIDATE]: new Set([FINDING_STATE.FIXED_LOCAL, FINDING_STATE.DISMISSED, FINDING_STATE.AUTHORIZED, FINDING_STATE.CONSOLIDATED]),
  [FINDING_STATE.AUTHORIZED]: new Set([FINDING_STATE.CREATED, FINDING_STATE.FIXED_LOCAL, FINDING_STATE.CONSOLIDATED]),
  [FINDING_STATE.CREATED]: new Set([FINDING_STATE.CONSOLIDATED, FINDING_STATE.CLOSED]),
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failure(code, message) {
  return { allowed: false, code, message };
}

export function transitionFinding(finding, nextState, evidence = {}) {
  if (!isRecord(finding) || typeof finding.id !== "string" || !finding.id) {
    throw new Error("finding requires a non-empty id");
  }
  if (!Object.values(FINDING_STATE).includes(finding.state)) throw new Error(`unknown finding state ${finding.state}`);
  if (!Object.values(FINDING_STATE).includes(nextState)) throw new Error(`unknown finding state ${nextState}`);
  if (TERMINAL_STATES.has(finding.state) || !TRANSITIONS[finding.state]?.has(nextState)) {
    throw new Error(`invalid finding transition ${finding.state} -> ${nextState}`);
  }
  if (!isRecord(evidence) || !Object.keys(evidence).length) throw new Error("finding transition requires evidence");
  return { ...finding, state: nextState, history: [...(finding.history || []), { from: finding.state, to: nextState, evidence }] };
}

export function issueFindingDigest(finding) {
  return digestValue({
    id: finding?.id ?? null,
    sourcePr: finding?.sourcePr ?? null,
    priority: finding?.priority ?? null,
    title: finding?.title ?? null,
    acceptanceCriteria: finding?.acceptanceCriteria ?? null,
    canonicalParent: finding?.canonicalParent ?? null,
    dedupe: finding?.dedupe ?? null,
  });
}

export function validateIssueAuthorization(finding, authorization, policy = DEFAULT_ISSUE_POLICY, now = new Date()) {
  if (!isRecord(policy) || policy.schemaVersion !== ISSUE_POLICY_SCHEMA_VERSION || policy.mode !== "pr_deferral_only" ||
      !Array.isArray(policy.eligiblePriorities) || policy.eligiblePriorities.length !== 1 || policy.eligiblePriorities[0] !== "P2" ||
      policy.minimumPrAcceptancePercent !== 90 ||
      !Array.isArray(policy.requiredDedupeChecks) || policy.requiredDedupeChecks.length !== DEFAULT_ISSUE_POLICY.requiredDedupeChecks.length ||
      !DEFAULT_ISSUE_POLICY.requiredDedupeChecks.every((check) => policy.requiredDedupeChecks.includes(check))) {
    return failure("invalid_issue_policy", "Issue policy is malformed or unsupported");
  }
  if (!isRecord(finding)) return failure("invalid_finding", "Finding must be an object");
  if (!Object.values(FINDING_CLASSIFICATION).includes(finding.classification)) return failure("invalid_classification", "Finding classification is invalid");
  if (finding.classification !== FINDING_CLASSIFICATION.DEFERRED_CANDIDATE) return failure("not_deferred_classification", "Only deferred_candidate findings can become GitHub issues");
  if (finding.state !== FINDING_STATE.DEFERRED_CANDIDATE) return failure("not_deferred_candidate", "Only a validated deferred PR finding can become a GitHub issue");
  if (!Number.isInteger(finding.sourcePr) || finding.sourcePr < 1) return failure("missing_source_pr", "A source pull request number is required");
  if (!policy.eligiblePriorities.includes(finding.priority)) return failure("ineligible_priority", "Only policy-approved priorities may be deferred to GitHub");
  if (finding.blocksCurrentPr !== false) return failure("blocks_current_pr", "A finding required for current PR acceptance must be fixed locally");
  if (finding.fixableInActivePr !== false) return failure("fixable_in_active_pr", "A finding fixable in the active PR must be fixed now");
  if (finding.speculativeFuture !== false) return failure("speculative_future", "Speculative future work is not eligible for issue creation");
  if (finding.hasCanonicalParent !== false) return failure("canonical_parent_exists", "A finding with a canonical parent must be consolidated there");
  if (finding.unresolvedP0Count !== 0 || finding.unresolvedP1Count !== 0) return failure("higher_priority_unresolved", "P0 and P1 findings must be resolved before P2 deferral");
  if (typeof finding.prAcceptancePercent !== "number" || finding.prAcceptancePercent < policy.minimumPrAcceptancePercent) {
    return failure("acceptance_below_threshold", `PR acceptance must be at least ${policy.minimumPrAcceptancePercent}% before deferral`);
  }
  if (typeof finding.deferReason !== "string" || !finding.deferReason.trim()) return failure("missing_defer_reason", "A concrete deferral reason is required");
  if (!Array.isArray(finding.acceptanceCriteria) || !finding.acceptanceCriteria.length || finding.acceptanceCriteria.some((item) => typeof item !== "string" || !item.trim())) {
    return failure("missing_acceptance_criteria", "Issue acceptance criteria must be non-empty strings");
  }
  if (!isRecord(finding.dedupe)) return failure("missing_dedupe_evidence", "Dedupe evidence is required");
  for (const check of policy.requiredDedupeChecks) {
    if (finding.dedupe[check] !== true) return failure("incomplete_dedupe_check", `Dedupe check ${check} must pass`);
  }
  if (finding.dedupe.matchingIssue) return failure("duplicate_issue", "An existing canonical issue already owns this finding");

  if (!policy.requireHumanAuthorization) return { allowed: true, authorizationId: null, findingDigest: issueFindingDigest(finding) };
  if (!isRecord(authorization)) return failure("missing_authorization", "Named human authorization is required");
  if (authorization.authority?.type !== "human" || typeof authorization.authority?.id !== "string" || !authorization.authority.id) {
    return failure("invalid_authority", "Authorization authority must be a named human");
  }
  if (authorization.singleUse !== true || authorization.consumedAt != null) return failure("invalid_single_use", "Authorization must be unused and single-use");
  const expectedDigest = issueFindingDigest(finding);
  if (authorization.findingDigest !== expectedDigest) return failure("digest_mismatch", "Authorization is not bound to this exact finding");
  const expiresAt = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return failure("authorization_expired", "Authorization must have a future expiry");
  if (typeof authorization.id !== "string" || !authorization.id) return failure("missing_authorization_id", "Authorization requires an id");
  return { allowed: true, authorizationId: authorization.id, findingDigest: expectedDigest };
}
