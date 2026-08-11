export const ISSUE_POLICY_SCHEMA_VERSION = 1;

export const FINDING_STATE = Object.freeze({
  DETECTED: "detected",
  VALIDATED: "validated",
  RESOLVED_LOCAL: "resolved_local",
  DISMISSED: "dismissed",
  DEFERRED_CANDIDATE: "deferred_candidate",
  CONSOLIDATED: "consolidated",
});

export const FINDING_CLASSIFICATION = Object.freeze({
  FIX_NOW: "fix_now",
  DUPLICATE: "duplicate",
  INVALID: "invalid",
  PRODUCT_DECISION: "product_decision",
  DEFERRED_CANDIDATE: "deferred_candidate",
});

// DIRF is tracker-neutral. Projects decide whether a deferred finding may be
// promoted to GitHub, Jira, another tracker, or nowhere at all.
export const DEFAULT_ISSUE_POLICY = Object.freeze({
  schemaVersion: ISSUE_POLICY_SCHEMA_VERSION,
  version: "dirf-local-findings-v1",
  mode: "local_only",
  externalCreation: "project_policy_required",
});

const TERMINAL_STATES = new Set([
  FINDING_STATE.RESOLVED_LOCAL,
  FINDING_STATE.DISMISSED,
  FINDING_STATE.CONSOLIDATED,
]);

const TRANSITIONS = Object.freeze({
  [FINDING_STATE.DETECTED]: new Set([FINDING_STATE.VALIDATED, FINDING_STATE.DISMISSED]),
  [FINDING_STATE.VALIDATED]: new Set([
    FINDING_STATE.RESOLVED_LOCAL,
    FINDING_STATE.DISMISSED,
    FINDING_STATE.DEFERRED_CANDIDATE,
    FINDING_STATE.CONSOLIDATED,
  ]),
  [FINDING_STATE.DEFERRED_CANDIDATE]: new Set([
    FINDING_STATE.RESOLVED_LOCAL,
    FINDING_STATE.DISMISSED,
    FINDING_STATE.CONSOLIDATED,
  ]),
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  return {
    ...finding,
    state: nextState,
    history: [...(finding.history || []), { from: finding.state, to: nextState, evidence }],
  };
}
