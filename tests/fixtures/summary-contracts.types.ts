import type { ArtifactReference, AttemptSummary, RequirementMappingUpdate, SummaryCursor } from "../../src/summary-contracts.js";

const plan: ArtifactReference = { artifact_id: "plan-v1", sha256: "a".repeat(64) };
const detail = { attempt_id: "attempt-1", path: "artifacts/plan.md" };
const update: RequirementMappingUpdate = {
  schema_version: 1, attempt_id: "attempt-1", governing_plan: plan, expected_revision: 0,
  requirements: [{ requirement_id: "R1", decision_ref: null, work_state: "complete", proof_refs: [] }],
};
const cursor: SummaryCursor = {
  schema_version: 1, attempt_id: "attempt-1", mapping_revision: 1, collection: "requirements", offset: 5, limit: 5,
};
const summary: AttemptSummary = {
  schema_version: 1,
  attempt: { id: "attempt-1", lifecycle_state: "in_progress", current_phase: "verify" },
  governing_plan: plan,
  mapping: { status: "present", revision: 1, detail_ref: detail },
  requirements: {
    items: [{ source: { plan, requirement_id: "R1" }, decision_ref: null, work_state: "complete",
      verification: "unverified", proof_refs: [], detail_ref: detail }],
    offset: 0, limit: 5, total: 6, omitted: 5, next_cursor: "continuation",
  },
  unresolved_work: { items: [{ kind: "decision", attempt_id: "attempt-1", phase: "approve", requirement_id: "R1",
    summary: "Acceptance pending", detail_ref: detail }], offset: 0, limit: 5, total: 1, omitted: 0, next_cursor: null },
  evidence_completeness: "unverified",
  warnings: [{ code: "related_checkpoint", message: "Related checkpoint requires review", requirement_id: null, detail_ref: detail }],
  next_action: "Review R1", history_ref: detail,
};
summary.mapping = { status: "mapping_missing", revision: null, detail_ref: detail };
// @ts-expect-error A missing mapping cannot present a current revision.
summary.mapping = { status: "mapping_missing", revision: 1, detail_ref: detail };
// @ts-expect-error A work update cannot assert evidence verification.
update.requirements[0].verification = "verified";
// @ts-expect-error Attempt completion is not a requirement work state.
update.requirements[0].work_state = "done";
// @ts-expect-error Compact output excludes broad legacy handoff payloads.
summary.project_handoff = "history";
// @ts-expect-error Page limits cannot hide arbitrarily large collections.
cursor.limit = 100;
void [summary, update, cursor];
