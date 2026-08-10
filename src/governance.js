// Vendor-neutral governed execution decisions and tamper-evident evidence.
//
// The module is deliberately pure: host adapters normalize actions, call this
// interface, atomically consume any returned authorization, execute the action,
// and append the outcome to their durable ledger.
import { createHash } from "node:crypto";

export const GOVERNANCE_SCHEMA_VERSION = 1;

export const DECISION = Object.freeze({
  ALLOW: "allow",
  REQUIRE_APPROVAL: "require_approval",
  DENY: "deny",
});

const EFFECT_PRECEDENCE = Object.freeze({
  [DECISION.ALLOW]: 1,
  [DECISION.REQUIRE_APPROVAL]: 2,
  [DECISION.DENY]: 3,
});

const RISK_PRECEDENCE = Object.freeze({ low: 1, medium: 2, high: 3, critical: 4 });
const REQUIREMENTS = new Set([
  "mandate",
  "evidence",
  "exact_target",
  "exact_repository",
  "payload_digest",
  "human_approval",
  "single_use_authorization",
]);
const SECRET_KEYS = new Set([
  "secret",
  "password",
  "passphrase",
  "apikey",
  "privatekey",
  "accesstoken",
  "refreshtoken",
  "credential",
  "credentials",
]);
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach((child) => deepFreeze(child));
    Object.freeze(value);
  }
  return value;
}

export const DEFAULT_GOVERNED_EXECUTION_POLICY = deepFreeze({
  schemaVersion: GOVERNANCE_SCHEMA_VERSION,
  version: "dirf-governed-execution-v1",
  defaultEffect: DECISION.DENY,
  rules: [
    {
      id: "prohibited-exfiltration-or-bypass",
      match: { actionKinds: ["secret_export", "authorization_bypass", "credential_export"] },
      risk: "critical",
      effect: DECISION.DENY,
      requirements: [],
    },
    {
      id: "read-only-observation",
      match: { actionKinds: ["read", "inspect", "analyze"] },
      risk: "low",
      effect: DECISION.ALLOW,
      requirements: ["exact_target"],
    },
    {
      id: "bounded-workspace-change",
      match: { actionKinds: ["write", "edit", "test", "build", "execute", "commit", "push"] },
      risk: "medium",
      effect: DECISION.ALLOW,
      requirements: ["mandate", "exact_target", "exact_repository"],
    },
    {
      id: "high-risk-state-change",
      match: {
        actionKinds: [
          "merge",
          "deploy",
          "database_mutation",
          "external_send",
          "shared_infrastructure",
          "credential_access",
          "authorization_change",
        ],
      },
      risk: "high",
      effect: DECISION.REQUIRE_APPROVAL,
      requirements: [
        "mandate",
        "evidence",
        "exact_target",
        "human_approval",
        "single_use_authorization",
      ],
      evidenceTypes: ["scope", "verification"],
    },
    {
      id: "exact-content-external-action",
      match: { actionKinds: ["external_send", "deploy", "database_mutation"] },
      risk: "high",
      effect: DECISION.REQUIRE_APPROVAL,
      requirements: ["payload_digest"],
    },
    {
      id: "critical-financial-or-destructive-action",
      match: { actionKinds: ["payment", "charge", "billing_change", "destructive_delete", "release"] },
      risk: "critical",
      effect: DECISION.REQUIRE_APPROVAL,
      requirements: [
        "mandate",
        "evidence",
        "exact_target",
        "payload_digest",
        "human_approval",
        "single_use_authorization",
      ],
      evidenceTypes: ["scope", "verification", "rollback"],
    },
  ],
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizedKey(key) {
  return String(key).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function sensitivePaths(value, path = "$", found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => sensitivePaths(item, `${path}[${index}]`, found));
    return found;
  }
  if (!isRecord(value)) return found;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (SECRET_KEYS.has(normalizedKey(key)) && child !== null && child !== "") found.push(childPath);
    sensitivePaths(child, childPath, found);
  }
  return found;
}

function canonicalize(value, path = "$") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  if (!isRecord(value)) throw new TypeError(`${path} contains a non-JSON value`);
  const output = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) throw new TypeError(`${path}.${key} is undefined`);
    output[key] = canonicalize(value[key], `${path}.${key}`);
  }
  return output;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function digestValue(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function actionEnvelope(request) {
  return {
    schemaVersion: GOVERNANCE_SCHEMA_VERSION,
    requestId: request?.id ?? null,
    organizationId: request?.organizationId ?? null,
    actor: request?.actor ? { id: request.actor.id ?? null, type: request.actor.type ?? null } : null,
    source: request?.source ?? null,
    action: request?.action ?? null,
    mandate: request?.mandate ?? null,
    evidence: request?.evidence ?? null,
  };
}

export function digestAction(request) {
  return digestValue(actionEnvelope(request));
}

export function digestPolicy(policy) {
  return digestValue(policy);
}

function parseTime(value) {
  if (typeof value !== "string" || !ISO_UTC_RE.test(value)) return null;
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  const normalized = value.includes(".") ? value : value.replace(/Z$/, ".000Z");
  return new Date(millis).toISOString() === normalized ? millis : null;
}

function reason(code, message, details = undefined) {
  return details === undefined ? { code, message } : { code, message, details };
}

function validatePolicy(policy) {
  const errors = [];
  if (!isRecord(policy)) return [reason("invalid_policy", "Policy must be an object")];
  if (policy.schemaVersion !== GOVERNANCE_SCHEMA_VERSION) {
    errors.push(reason("unsupported_policy_schema", `Policy schemaVersion must be ${GOVERNANCE_SCHEMA_VERSION}`));
  }
  if (typeof policy.version !== "string" || !policy.version.trim()) {
    errors.push(reason("missing_policy_version", "Policy requires a non-empty version"));
  }
  if (policy.defaultEffect !== DECISION.DENY) {
    errors.push(reason("unsafe_policy_default", "Policy defaultEffect must be deny"));
  }
  if (!Array.isArray(policy.rules) || !policy.rules.length) {
    errors.push(reason("missing_policy_rules", "Policy requires at least one rule"));
    return errors;
  }
  const ids = new Set();
  for (const [index, rule] of policy.rules.entries()) {
    const label = `rules[${index}]`;
    if (!isRecord(rule) || typeof rule.id !== "string" || !rule.id.trim()) {
      errors.push(reason("invalid_policy_rule", `${label} requires a non-empty id`));
      continue;
    }
    if (ids.has(rule.id)) errors.push(reason("duplicate_policy_rule", `Duplicate policy rule id ${rule.id}`));
    ids.add(rule.id);
    if (!Array.isArray(rule.match?.actionKinds) || !rule.match.actionKinds.length || rule.match.actionKinds.some((item) => typeof item !== "string" || !item.trim())) {
      errors.push(reason("invalid_policy_match", `${label} requires match.actionKinds`));
    }
    if (!(rule.risk in RISK_PRECEDENCE)) errors.push(reason("invalid_policy_risk", `${label} has invalid risk`));
    if (!(rule.effect in EFFECT_PRECEDENCE)) errors.push(reason("invalid_policy_effect", `${label} has invalid effect`));
    if (!Array.isArray(rule.requirements) || rule.requirements.some((item) => !REQUIREMENTS.has(item))) {
      errors.push(reason("invalid_policy_requirements", `${label} has unknown requirements`));
    }
    if (rule.evidenceTypes !== undefined && (!Array.isArray(rule.evidenceTypes) || rule.evidenceTypes.some((item) => typeof item !== "string" || !item))) {
      errors.push(reason("invalid_policy_evidence_types", `${label}.evidenceTypes must be non-empty strings`));
    }
  }
  return errors;
}

function actionSegments(action) {
  if (!isRecord(action)) return [];
  if (action.segments === undefined) return [action];
  return Array.isArray(action.segments) ? action.segments : [];
}

function targetIdentity(target) {
  if (!isRecord(target)) return null;
  for (const key of ["id", "path", "resource", "repository", "url"]) {
    if (typeof target[key] === "string" && target[key].trim()) return target[key].trim();
  }
  return null;
}

function repositoryIdentity(target) {
  if (!isRecord(target)) return null;
  if (typeof target.repository !== "string" || !target.repository.trim()) return null;
  if (typeof target.ref !== "string" || !target.ref.trim()) return null;
  return `${target.repository.trim()}@${target.ref.trim()}`;
}

function matchingRules(segment, policy) {
  return policy.rules.filter((rule) => rule.match.actionKinds.includes("*") || rule.match.actionKinds.includes(segment.kind));
}

function strongest(items, precedence, fallback) {
  return items.reduce((current, item) => precedence[item] > precedence[current] ? item : current, fallback);
}

function validateMandate(request, segments, now) {
  const mandate = request.mandate;
  if (!isRecord(mandate) || typeof mandate.id !== "string" || !mandate.id || typeof mandate.grantedBy !== "string" || !mandate.grantedBy) {
    return reason("missing_mandate", "A named mandate is required");
  }
  const issuedAt = parseTime(mandate.issuedAt);
  const expiresAt = mandate.expiresAt === undefined ? null : parseTime(mandate.expiresAt);
  if (issuedAt === null || issuedAt > now || (mandate.expiresAt !== undefined && expiresAt === null)) {
    return reason("invalid_mandate_time", "Mandate timestamps are invalid");
  }
  if (expiresAt !== null && expiresAt <= now) return reason("expired_mandate", "Mandate has expired");
  const scope = mandate.scope;
  if (!isRecord(scope) || scope.organizationId !== request.organizationId) {
    return reason("mandate_organization_mismatch", "Mandate organization does not match the request");
  }
  const kinds = Array.isArray(scope.actionKinds) ? scope.actionKinds : [];
  if (!segments.every((segment) => kinds.includes("*") || kinds.includes(segment.kind))) {
    return reason("mandate_action_out_of_scope", "At least one action segment is outside the mandate");
  }
  const targets = Array.isArray(scope.targets) ? scope.targets : [];
  if (!segments.every((segment) => {
    const identity = targetIdentity(segment.target);
    return identity && (targets.includes("*") || targets.includes(identity));
  })) {
    return reason("mandate_target_out_of_scope", "At least one action target is outside the mandate");
  }
  const repositories = Array.isArray(scope.repositories) ? scope.repositories : [];
  if (!segments.every((segment) => {
    const target = segment.target;
    if (!isRecord(target) || (target.repository === undefined && target.ref === undefined)) return true;
    const identity = repositoryIdentity(target);
    return identity && (repositories.includes("*") || repositories.includes(identity));
  })) {
    return reason("mandate_repository_out_of_scope", "At least one repository and ref is outside the mandate");
  }
  return null;
}

function validateEvidence(request, requiredTypes) {
  if (!Array.isArray(request.evidence) || !request.evidence.length) {
    return reason("missing_evidence", "Required pre-execution evidence is missing");
  }
  for (const [index, item] of request.evidence.entries()) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id || typeof item.type !== "string" || !item.type || !SHA256_RE.test(item.digest || "")) {
      return reason("invalid_evidence", `Evidence item ${index + 1} requires id, type, organizationId, and sha256 digest`);
    }
    if (item.organizationId !== request.organizationId) {
      return reason("evidence_organization_mismatch", `Evidence item ${index + 1} belongs to another organization`);
    }
  }
  const present = new Set(request.evidence.map((item) => item.type));
  const missing = [...requiredTypes].filter((type) => !present.has(type));
  return missing.length ? reason("missing_evidence_types", "Required evidence types are missing", missing) : null;
}

function validateAuthorization(request, actionDigest, policyDigest, now, singleUseRequired) {
  const authorization = request.authorization;
  if (!isRecord(authorization)) return reason("missing_human_approval", "Named human approval is required");
  if (typeof authorization.id !== "string" || !authorization.id || authorization.decision !== "approve") {
    return reason("invalid_human_approval", "Approval requires an id and approve decision");
  }
  const authority = authorization.authority;
  if (!isRecord(authority) || authority.type !== "human" || typeof authority.id !== "string" || !authority.id || typeof authority.role !== "string" || !authority.role) {
    return reason("invalid_approval_authority", "Approval must come from a named human authority with a role");
  }
  if (authority.id === request.actor.id) return reason("self_approval", "The executing actor cannot approve its own action");
  if (authorization.organizationId !== request.organizationId) {
    return reason("approval_organization_mismatch", "Approval organization does not match the request");
  }
  if (authorization.actionDigest !== actionDigest || authorization.policyDigest !== policyDigest) {
    return reason("stale_approval", "Approval is not bound to the exact action and policy content");
  }
  const issuedAt = parseTime(authorization.issuedAt);
  const expiresAt = parseTime(authorization.expiresAt);
  if (issuedAt === null || expiresAt === null || issuedAt > now || expiresAt <= now) {
    return reason("expired_or_invalid_approval", "Approval timestamps are invalid or expired");
  }
  if (singleUseRequired && authorization.singleUse !== true) {
    return reason("approval_not_single_use", "Approval must be single-use");
  }
  if (authorization.consumedAt !== undefined && authorization.consumedAt !== null) {
    return reason("approval_already_consumed", "Approval has already been consumed");
  }
  return null;
}

export function evaluateGovernedAction(request, policy = DEFAULT_GOVERNED_EXECUTION_POLICY, options = {}) {
  const evaluatedAt = options.now ?? new Date().toISOString();
  const now = parseTime(evaluatedAt);
  let actionDigest = null;
  let policyDigest = null;
  const secretFields = sensitivePaths(request);
  if (secretFields.length) {
    try { policyDigest = digestPolicy(policy); }
    catch { /* A secret-bearing request is denied before policy evaluation. */ }
    const reasons = [reason("sensitive_value_present", "Requests must contain references, never credentials or secret values", secretFields)];
    return {
      schemaVersion: GOVERNANCE_SCHEMA_VERSION,
      requestId: request?.id ?? null,
      decision: DECISION.DENY,
      risk: "critical",
      evaluatedAt,
      actionDigest,
      policyDigest,
      matchedRules: [],
      segmentDecisions: [],
      reasons,
      missingRequirements: reasons.map((item) => item.code),
      authorizationToConsume: null,
    };
  }
  try {
    actionDigest = digestAction(request);
    policyDigest = digestPolicy(policy);
  } catch (error) {
    return {
      schemaVersion: GOVERNANCE_SCHEMA_VERSION,
      requestId: request?.id ?? null,
      decision: DECISION.DENY,
      risk: "critical",
      evaluatedAt,
      actionDigest,
      policyDigest,
      matchedRules: [],
      segmentDecisions: [],
      reasons: [reason("non_canonical_input", error.message)],
      missingRequirements: ["non_canonical_input"],
      authorizationToConsume: null,
    };
  }

  const reasons = validatePolicy(policy);
  if (reasons.length) {
    return {
      schemaVersion: GOVERNANCE_SCHEMA_VERSION,
      requestId: request?.id ?? null,
      decision: DECISION.DENY,
      risk: "critical",
      evaluatedAt,
      actionDigest,
      policyDigest,
      matchedRules: [],
      segmentDecisions: [],
      reasons,
      missingRequirements: reasons.map((item) => item.code),
      authorizationToConsume: null,
    };
  }
  if (now === null) reasons.push(reason("invalid_evaluation_time", "Evaluation time must be an ISO timestamp"));
  if (!isRecord(request) || typeof request.id !== "string" || !request.id) reasons.push(reason("missing_request_id", "Request requires an id"));
  if (typeof request?.organizationId !== "string" || !request.organizationId) reasons.push(reason("missing_organization", "Request requires an organizationId"));
  if (!isRecord(request?.actor) || typeof request.actor.id !== "string" || !request.actor.id || typeof request.actor.type !== "string" || !request.actor.type) {
    reasons.push(reason("missing_actor", "Request requires a named actor and type"));
  }
  if (request?.actor?.organizationId !== undefined && request.actor.organizationId !== request.organizationId) {
    reasons.push(reason("actor_organization_mismatch", "Actor organization does not match the request"));
  }

  const segments = actionSegments(request?.action);
  if (!segments.length) reasons.push(reason("missing_action", "Request requires one or more action segments"));
  const segmentDecisions = [];
  const matchedRuleIds = new Set();
  const requirements = new Set();
  const evidenceTypes = new Set();
  let risk = "low";
  let effect = DECISION.ALLOW;

  for (const [index, segment] of segments.entries()) {
    const segmentReasons = [];
    if (!isRecord(segment) || typeof segment.kind !== "string" || !segment.kind || typeof segment.operation !== "string" || !segment.operation) {
      segmentReasons.push(reason("invalid_action_segment", `Action segment ${index + 1} requires kind and operation`));
    }
    if (!isRecord(segment?.target)) segmentReasons.push(reason("missing_action_target", `Action segment ${index + 1} requires a target`));
    if (segment?.target?.organizationId !== undefined && segment.target.organizationId !== request?.organizationId) {
      segmentReasons.push(reason("target_organization_mismatch", `Action segment ${index + 1} targets another organization`));
    }
    const rules = typeof segment?.kind === "string" && segment.kind ? matchingRules(segment, policy) : [];
    if (!rules.length && typeof segment?.kind === "string" && segment.kind) {
      segmentReasons.push(reason("unknown_action", `No policy rule matches action kind ${segment.kind}`));
    }
    const segmentEffect = rules.length ? strongest(rules.map((rule) => rule.effect), EFFECT_PRECEDENCE, DECISION.ALLOW) : DECISION.DENY;
    const segmentRisk = rules.length ? strongest(rules.map((rule) => rule.risk), RISK_PRECEDENCE, "low") : "critical";
    risk = strongest([risk, segmentRisk], RISK_PRECEDENCE, "low");
    effect = strongest([effect, segmentReasons.length ? DECISION.DENY : segmentEffect], EFFECT_PRECEDENCE, DECISION.ALLOW);
    for (const rule of rules) {
      matchedRuleIds.add(rule.id);
      rule.requirements.forEach((item) => requirements.add(item));
      (rule.evidenceTypes || []).forEach((item) => evidenceTypes.add(item));
    }
    segmentDecisions.push({
      index,
      kind: segment?.kind ?? null,
      risk: segmentRisk,
      effect: segmentReasons.length ? DECISION.DENY : segmentEffect,
      matchedRules: rules.map((rule) => rule.id),
      reasons: segmentReasons,
    });
    reasons.push(...segmentReasons);
  }

  if (effect === DECISION.REQUIRE_APPROVAL) requirements.add("human_approval");

  if (requirements.has("exact_target")) {
    const missing = segments.map((segment, index) => targetIdentity(segment?.target) ? null : index).filter((item) => item !== null);
    if (missing.length) reasons.push(reason("inexact_target", "Every action segment requires an exact target", missing));
  }
  if (requirements.has("exact_repository")) {
    const missing = segments.map((segment, index) => {
      const target = segment?.target;
      return isRecord(target) && typeof target.repository === "string" && target.repository && typeof target.ref === "string" && target.ref ? null : index;
    }).filter((item) => item !== null);
    if (missing.length) reasons.push(reason("inexact_repository", "Every repository action requires exact repository and ref", missing));
  }
  if (requirements.has("payload_digest") && segments.some((segment) => !SHA256_RE.test(segment?.payloadDigest || ""))) {
    reasons.push(reason("missing_payload_digest", "Every exact-content action requires a sha256 payloadDigest"));
  }
  if (requirements.has("mandate") && now !== null) {
    const mandateReason = validateMandate(request, segments, now);
    if (mandateReason) reasons.push(mandateReason);
  }
  if (requirements.has("evidence")) {
    const evidenceReason = validateEvidence(request, evidenceTypes);
    if (evidenceReason) reasons.push(evidenceReason);
  }

  let approvalReason = null;
  if (requirements.has("human_approval") && now !== null) {
    approvalReason = validateAuthorization(request, actionDigest, policyDigest, now, requirements.has("single_use_authorization"));
  }

  const nonApprovalReasons = reasons.filter((item) => ![
    "missing_human_approval",
    "invalid_human_approval",
    "invalid_approval_authority",
    "self_approval",
    "approval_organization_mismatch",
    "stale_approval",
    "expired_or_invalid_approval",
    "approval_not_single_use",
    "approval_already_consumed",
  ].includes(item.code));

  let decision;
  if (effect === DECISION.DENY || nonApprovalReasons.length) decision = DECISION.DENY;
  else if (approvalReason) decision = DECISION.REQUIRE_APPROVAL;
  else decision = DECISION.ALLOW;
  if (approvalReason) reasons.push(approvalReason);

  return {
    schemaVersion: GOVERNANCE_SCHEMA_VERSION,
    requestId: request?.id ?? null,
    decision,
    risk,
    evaluatedAt,
    actionDigest,
    policyDigest,
    matchedRules: [...matchedRuleIds],
    segmentDecisions,
    reasons,
    missingRequirements: reasons.map((item) => item.code),
    authorizationToConsume: decision === DECISION.ALLOW && requirements.has("single_use_authorization") ? request.authorization.id : null,
  };
}

export function appendEvidenceLedger(ledger, event, options = {}) {
  if (!Array.isArray(ledger)) throw new TypeError("Ledger must be an array");
  const verification = verifyEvidenceLedger(ledger);
  if (!verification.valid) throw new Error(`Cannot append to invalid ledger: ${verification.errors.join("; ")}`);
  const secretFields = sensitivePaths(event);
  if (secretFields.length) throw new Error(`Ledger events must not contain secrets: ${secretFields.join(", ")}`);
  const recordedAt = options.recordedAt ?? new Date().toISOString();
  if (parseTime(recordedAt) === null) throw new Error("recordedAt must be an ISO timestamp");
  const previous = ledger.at(-1);
  const entry = {
    schemaVersion: GOVERNANCE_SCHEMA_VERSION,
    sequence: ledger.length + 1,
    previousHash: previous?.entryHash ?? null,
    recordedAt,
    event: canonicalize(event),
  };
  return [...ledger, { ...entry, entryHash: digestValue(entry) }];
}

export function verifyEvidenceLedger(ledger) {
  if (!Array.isArray(ledger)) return { valid: false, entries: 0, headHash: null, errors: ["ledger must be an array"] };
  const errors = [];
  let previousHash = null;
  for (const [index, entry] of ledger.entries()) {
    const label = `entry ${index + 1}`;
    if (!isRecord(entry)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (entry.schemaVersion !== GOVERNANCE_SCHEMA_VERSION) errors.push(`${label} has unsupported schemaVersion`);
    if (entry.sequence !== index + 1) errors.push(`${label} has invalid sequence`);
    if (entry.previousHash !== previousHash) errors.push(`${label} previousHash mismatch`);
    if (parseTime(entry.recordedAt) === null) errors.push(`${label} has invalid recordedAt`);
    const secretFields = sensitivePaths(entry.event);
    if (secretFields.length) errors.push(`${label} contains sensitive values at ${secretFields.join(", ")}`);
    try {
      const body = {
        schemaVersion: entry.schemaVersion,
        sequence: entry.sequence,
        previousHash: entry.previousHash,
        recordedAt: entry.recordedAt,
        event: entry.event,
      };
      const expected = digestValue(body);
      if (entry.entryHash !== expected) errors.push(`${label} entryHash mismatch`);
    } catch (error) {
      errors.push(`${label} is not canonical JSON: ${error.message}`);
    }
    previousHash = entry.entryHash ?? null;
  }
  return { valid: errors.length === 0, entries: ledger.length, headHash: ledger.at(-1)?.entryHash ?? null, errors };
}
