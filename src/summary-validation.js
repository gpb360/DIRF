// @ts-check
/** @typedef {import('./summary-contracts.js').RequirementMappingUpdate} RequirementMappingUpdate */
/** @typedef {import('./summary-contracts.js').MappingValidationContext} MappingValidationContext */
/** @typedef {import('./summary-contracts.js').SummaryCursor} SummaryCursor */
/** @typedef {import('./summary-contracts.js').CursorValidationContext} CursorValidationContext */

export const SUMMARY_PAGE_SIZE = 5;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const WORK_STATES = new Set(["planned", "in_progress", "blocked", "complete"]);
const COLLECTIONS = new Set(["requirements", "unresolved_work"]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

/** @param {unknown} value @returns {value is string} */
function isId(value) { return typeof value === "string" && ID.test(value); }

/** @param {unknown} value @returns {value is number} */
function isRevision(value) { return Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0; }

/** @param {Record<string, unknown>} value @param {string[]} allowed @param {string} at @param {string[]} errors */
function exactKeys(value, allowed, at, errors) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${at}.${key} is not allowed`);
  }
}

/** @param {unknown} value @param {string} at @param {string[]} errors @returns {value is import('./summary-contracts.js').ArtifactReference} */
function artifactReference(value, at, errors) {
  if (!isRecord(value)) { errors.push(`${at} must be an artifact reference`); return false; }
  const before = errors.length;
  exactKeys(value, ["artifact_id", "sha256"], at, errors);
  if (!isId(value.artifact_id)) errors.push(`${at}.artifact_id must be a stable artifact id`);
  if (typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) errors.push(`${at}.sha256 must be a lowercase SHA-256 digest`);
  return errors.length === before;
}

/**
 * Validate a caller's resolved context without reading canonical state.
 * @param {unknown} value @param {string[]} errors
 * @returns {value is CursorValidationContext}
 */
function cursorContext(value, errors) {
  if (!isRecord(value)) { errors.push("context must be an object"); return false; }
  if (!isId(value.attempt_id)) errors.push("context.attempt_id must be a stable attempt id");
  if (!isRevision(value.mapping_revision)) errors.push("context.mapping_revision must be a non-negative safe integer");
  if (typeof value.collection !== "string" || !COLLECTIONS.has(value.collection)) errors.push("context.collection is invalid");
  if (value.source_sha256 !== undefined && (typeof value.source_sha256 !== "string" || !SHA256.test(value.source_sha256))) errors.push("context.source_sha256 is invalid");
  return errors.length === 0;
}

/**
 * Checks shape and source identity only. state.js must still resolve acceptance,
 * validate referenced bytes, and apply the update inside its existing transaction.
 * @param {unknown} value
 * @param {MappingValidationContext} context
 * @returns {import('./summary-contracts.js').ValidationResult<RequirementMappingUpdate>}
 */
export function validateRequirementMappingUpdate(value, context) {
  /** @type {string[]} */
  const errors = [];
  if (!isRecord(context)) return { valid: false, errors: ["context must be an object"] };
  if (!isId(context.attempt_id)) errors.push("context.attempt_id must be a stable attempt id");
  if (!isRevision(context.mapping_revision)) errors.push("context.mapping_revision must be a non-negative safe integer");
  const planValid = artifactReference(context.governing_plan, "context.governing_plan", errors);
  if (!Array.isArray(context.requirement_ids) || context.requirement_ids.length === 0
    || [...context.requirement_ids].some(id => !isId(id)) || new Set(context.requirement_ids).size !== context.requirement_ids.length) {
    errors.push("context.requirement_ids must contain unique stable requirement ids");
  }
  if (errors.length) return { valid: false, errors };
  if (!isRecord(value)) return { valid: false, errors: ["mapping update must be an object"] };
  exactKeys(value, ["schema_version", "attempt_id", "governing_plan", "expected_revision", "requirements"], "update", errors);
  if (value.schema_version !== 1) errors.push("schema_version must be 1");
  if (value.attempt_id !== context.attempt_id) errors.push("attempt_id must match the selected attempt");
  if (!isRevision(value.expected_revision) || value.expected_revision !== context.mapping_revision) errors.push("expected_revision must match the current mapping revision");
  if (artifactReference(value.governing_plan, "governing_plan", errors) && planValid
    && (value.governing_plan.artifact_id !== context.governing_plan.artifact_id || value.governing_plan.sha256 !== context.governing_plan.sha256)) {
    errors.push("governing_plan must match the accepted plan identity and digest");
  }
  if (!Array.isArray(value.requirements) || value.requirements.length === 0) {
    errors.push("requirements must be a non-empty array");
  } else {
    const known = new Set(context.requirement_ids);
    const seen = new Set();
    for (const [index, entry] of value.requirements.entries()) {
      const at = `requirements[${index}]`;
      if (!isRecord(entry)) { errors.push(`${at} must be an object`); continue; }
      exactKeys(entry, ["requirement_id", "decision_ref", "work_state", "proof_refs"], at, errors);
      if (!isId(entry.requirement_id) || !known.has(entry.requirement_id)) errors.push(`${at}.requirement_id must exist in the governing plan`);
      else if (seen.has(entry.requirement_id)) errors.push(`${at}.requirement_id must be unique`);
      else seen.add(entry.requirement_id);
      if (entry.decision_ref !== null) artifactReference(entry.decision_ref, `${at}.decision_ref`, errors);
      if (typeof entry.work_state !== "string" || !WORK_STATES.has(entry.work_state)) errors.push(`${at}.work_state is invalid`);
      if (!Array.isArray(entry.proof_refs)) errors.push(`${at}.proof_refs must be an array`);
      else {
        const proofs = new Set();
        for (const [proofIndex, proof] of entry.proof_refs.entries()) {
          if (!artifactReference(proof, `${at}.proof_refs[${proofIndex}]`, errors)) continue;
          if (proofs.has(proof.artifact_id)) errors.push(`${at}.proof_refs must contain unique artifact ids`);
          proofs.add(proof.artifact_id);
        }
      }
    }
  }
  return errors.length ? { valid: false, errors }
    : { valid: true, errors: [], value: /** @type {RequirementMappingUpdate} */ (/** @type {unknown} */ (value)) };
}

/**
 * A cursor is scoped to a single attempt, mapping revision, and collection.
 * @param {unknown} value @param {CursorValidationContext} context
 * @returns {import('./summary-contracts.js').ValidationResult<SummaryCursor>}
 */
export function validateSummaryCursor(value, context) {
  /** @type {string[]} */
  const errors = [];
  if (!cursorContext(context, errors)) return { valid: false, errors };
  if (!isRecord(value)) return { valid: false, errors: ["cursor must be an object"] };
  exactKeys(value, ["schema_version", "attempt_id", "mapping_revision", "collection", "offset", "limit", "source_sha256"], "cursor", errors);
  if (value.schema_version !== 1) errors.push("cursor.schema_version must be 1");
  if (value.attempt_id !== context.attempt_id) errors.push("cursor.attempt_id must match the selected attempt");
  if (!isRevision(value.mapping_revision) || value.mapping_revision !== context.mapping_revision) errors.push("cursor.mapping_revision is stale or invalid");
  if (value.collection !== context.collection) errors.push("cursor.collection must match the requested page");
  if (!isRevision(value.offset)) errors.push("cursor.offset must be a non-negative safe integer");
  if (value.limit !== SUMMARY_PAGE_SIZE) errors.push(`cursor.limit must be ${SUMMARY_PAGE_SIZE}`);
  if (value.source_sha256 !== undefined && (typeof value.source_sha256 !== "string" || !SHA256.test(value.source_sha256))) errors.push("cursor.source_sha256 is invalid");
  if (context.source_sha256 !== undefined && value.source_sha256 !== context.source_sha256) errors.push("cursor.source_sha256 is stale or missing");
  return errors.length ? { valid: false, errors }
    : { valid: true, errors: [], value: /** @type {SummaryCursor} */ (/** @type {unknown} */ (value)) };
}

/**
 * Decode only canonical, bounded base64url JSON. This token carries no authority.
 * @param {unknown} token @param {CursorValidationContext} context
 * @returns {import('./summary-contracts.js').ValidationResult<SummaryCursor>}
 */
export function parseSummaryCursor(token, context) {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    return { valid: false, errors: ["cursor token must be bounded base64url JSON"] };
  }
  try {
    const bytes = Buffer.from(token, "base64url");
    if (bytes.toString("base64url") !== token) throw new Error("non-canonical base64url");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return validateSummaryCursor(JSON.parse(text), context);
  } catch {
    return { valid: false, errors: ["cursor token must be canonical UTF-8 JSON"] };
  }
}
