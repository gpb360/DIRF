export const ARTIFACT_TYPES = Object.freeze([
  "research_questions",
  "research",
  "lesson",
  "design",
  "structure",
  "plan",
  "implementation_evidence",
  "plan_delta",
]);

const ARTIFACT_TYPE_SET = new Set(ARTIFACT_TYPES);
const ARTIFACT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ISO_8601_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-](\d{2}):(\d{2}))$/;
const PLAN_DELTA_BUCKETS = Object.freeze(["implemented_as_planned", "additions", "omissions", "unverifiable"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function isIso8601(value) {
  if (!nonEmptyString(value)) return false;
  const match = ISO_8601_RE.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  if (zone !== "Z" && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) return false;
  return true;
}

function isAttemptRelativePath(value) {
  if (!nonEmptyString(value) || value.includes("\\") || value.includes("\0")) return false;
  if (value.startsWith("/") || value.startsWith("//") || /^[A-Za-z]:/.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== "..");
}

function normalizedArtifacts(artifacts) {
  return artifacts === undefined ? [] : artifacts;
}

function typeFilter(requiredTypes) {
  if (requiredTypes === undefined || requiredTypes === null) return null;
  const values = Array.isArray(requiredTypes) ? requiredTypes : [requiredTypes];
  return new Set(values.filter((value) => ARTIFACT_TYPE_SET.has(value)));
}

function reachableIds(startId, byId) {
  const reached = new Set();
  const pending = [...(byId.get(startId)?.supersedes || [])];
  while (pending.length) {
    const id = pending.pop();
    if (reached.has(id)) continue;
    reached.add(id);
    const item = byId.get(id);
    if (item) pending.push(...(item.supersedes || []));
  }
  return reached;
}

export function validateArtifactGraph(input) {
  const artifacts = normalizedArtifacts(input);
  const errors = [];
  if (!Array.isArray(artifacts)) return { valid: false, errors: ["artifacts must be an array"] };

  const ids = new Set();
  const validRecords = [];

  artifacts.forEach((item, index) => {
    const at = `artifacts[${index}]`;
    if (!isObject(item)) {
      errors.push(`${at} must be an object`);
      return;
    }
    validRecords.push(item);

    if (!nonEmptyString(item.id) || !ARTIFACT_ID_RE.test(item.id)) {
      errors.push(`${at}.id must be a stable artifact id`);
    } else if (ids.has(item.id)) {
      errors.push(`${at}.id must be unique`);
    } else {
      ids.add(item.id);
    }

    if (!ARTIFACT_TYPE_SET.has(item.type)) errors.push(`${at}.type must be one of ${ARTIFACT_TYPES.join(", ")}`);
    if (!isAttemptRelativePath(item.path)) errors.push(`${at}.path must be attempt-relative and use forward slashes`);
    const validCreatedAt = isIso8601(item.created_at);
    const validAcceptedAt = item.accepted_at === undefined || isIso8601(item.accepted_at);
    if (!validCreatedAt) errors.push(`${at}.created_at must be an ISO-8601 timestamp`);
    if (!validAcceptedAt) errors.push(`${at}.accepted_at must be an ISO-8601 timestamp`);
    if (validCreatedAt && item.accepted_at !== undefined && validAcceptedAt && Date.parse(item.accepted_at) < Date.parse(item.created_at)) {
      errors.push(`${at}.accepted_at must not be earlier than created_at`);
    }

    if (item.supersedes !== undefined) {
      if (!Array.isArray(item.supersedes) || item.supersedes.some((id) => !nonEmptyString(id))) {
        errors.push(`${at}.supersedes must be an array of artifact ids`);
      } else if (new Set(item.supersedes).size !== item.supersedes.length) {
        errors.push(`${at}.supersedes must contain unique artifact ids`);
      }
    }
  });

  const byId = new Map(validRecords.filter((item) => nonEmptyString(item.id)).map((item) => [item.id, item]));
  validRecords.forEach((item, index) => {
    if (!Array.isArray(item.supersedes)) return;
    for (const target of item.supersedes) {
      if (!byId.has(target)) errors.push(`artifacts[${index}].supersedes references missing artifact ${JSON.stringify(target)}`);
    }
  });

  const visiting = new Set();
  const visited = new Set();
  let cycleReported = false;
  function visit(id) {
    if (visiting.has(id)) {
      if (!cycleReported) errors.push(`artifacts contains a supersedes cycle involving ${JSON.stringify(id)}`);
      cycleReported = true;
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const item = byId.get(id);
    for (const target of Array.isArray(item?.supersedes) ? item.supersedes : []) {
      if (byId.has(target)) visit(target);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id);

  return { valid: errors.length === 0, errors };
}

export function explainGoverningArtifact(input, requiredTypes) {
  const artifacts = normalizedArtifacts(input);
  if (!validateArtifactGraph(artifacts).valid) return { governing: null, eligible: [], superseded: [], candidates: [], selected_by: null };

  const types = typeFilter(requiredTypes);
  if (types && types.size === 0) return { governing: null, eligible: [], superseded: [], candidates: [], selected_by: null };
  const eligible = artifacts.filter((item) => item.accepted_at && (!types || types.has(item.type)));
  if (!eligible.length) return { governing: null, eligible: [], superseded: [], candidates: [], selected_by: null };

  const byId = new Map(artifacts.map((item) => [item.id, item]));
  const eligibleIds = new Set(eligible.map((item) => item.id));
  const supersededBy = new Map();
  for (const item of eligible) {
    for (const id of reachableIds(item.id, byId)) {
      if (eligibleIds.has(id)) {
        const by = supersededBy.get(id) || [];
        by.push(item.id);
        supersededBy.set(id, by);
      }
    }
  }

  const leaves = eligible.filter((item) => !supersededBy.has(item.id));
  leaves.sort((left, right) => {
    const time = Date.parse(left.accepted_at) - Date.parse(right.accepted_at);
    return time || left.id.localeCompare(right.id);
  });
  const governing = leaves.at(-1) || null;
  const sameTime = governing ? leaves.filter((item) => item.accepted_at === governing.accepted_at) : [];
  return {
    governing,
    eligible: eligible.map((item) => item.id).sort(),
    superseded: [...supersededBy.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([id, by]) => ({ id, by: [...new Set(by)].sort() })),
    candidates: leaves.map((item) => item.id),
    selected_by: !governing ? null : leaves.length === 1 ? "only eligible leaf" : sameTime.length > 1 ? "lexical id tie-break" : "latest acceptance time",
  };
}

export function resolveGoverningArtifact(input, requiredTypes) {
  return explainGoverningArtifact(input, requiredTypes).governing;
}

export function validatePlanDelta(value, inputArtifacts = []) {
  const errors = [];
  if (!isObject(value)) return { valid: false, errors: ["plan_delta must be an object"] };

  const artifacts = normalizedArtifacts(inputArtifacts);
  const graph = validateArtifactGraph(artifacts);
  if (!graph.valid) errors.push(...graph.errors.map((error) => `artifacts: ${error}`));

  if (!nonEmptyString(value.plan_artifact_id)) errors.push("plan_artifact_id is required");
  const governingPlan = graph.valid ? resolveGoverningArtifact(artifacts, "plan") : null;
  if (nonEmptyString(value.plan_artifact_id) && governingPlan?.id !== value.plan_artifact_id) {
    errors.push("plan_artifact_id must reference the governing accepted plan");
  }

  const entryIds = new Set();
  for (const bucket of PLAN_DELTA_BUCKETS) {
    const entries = value[bucket];
    if (!Array.isArray(entries)) {
      errors.push(`${bucket} must be an array`);
      continue;
    }
    entries.forEach((entry, index) => {
      const at = `${bucket}[${index}]`;
      if (!isObject(entry)) {
        errors.push(`${at} must be an object`);
        return;
      }
      if (!nonEmptyString(entry.id)) {
        errors.push(`${at}.id is required`);
      } else if (entryIds.has(entry.id)) {
        errors.push(`${at}.entry id must be unique across plan_delta`);
      } else {
        entryIds.add(entry.id);
      }
      if (!nonEmptyString(entry.summary)) errors.push(`${at}.summary is required`);
      if (!Array.isArray(entry.evidence) || entry.evidence.length === 0 || entry.evidence.some((item) => !nonEmptyString(item))) {
        errors.push(`${at}.evidence must contain non-empty references`);
      }
      if ((bucket === "additions" || bucket === "omissions") && !nonEmptyString(entry.reason)) {
        errors.push(`${at}.reason is required`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}
