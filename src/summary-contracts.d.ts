/** Portable references carry identity, not a second copy of requirement prose. */
export interface ArtifactReference {
  artifact_id: string;
  sha256: string;
}

export interface RequirementReference {
  plan: ArtifactReference;
  requirement_id: string;
}

export type RequirementWorkState = "planned" | "in_progress" | "blocked" | "complete";
export type VerificationState = "verified" | "unverified";
export type AttemptLifecycleState = "planned" | "in_progress" | "blocked" | "abandoned" | "done" | "historical";
export type SummaryCollection = "requirements" | "unresolved_work";

/** Every entry inherits the update's governing plan. Acceptance is resolved by state.js. */
export interface RequirementUpdate {
  requirement_id: string;
  decision_ref: ArtifactReference | null;
  work_state: RequirementWorkState;
  proof_refs: ArtifactReference[];
}

/** Partial updates preserve unnamed entries under the same governing plan. History is retained across plan replacements. */
export interface RequirementMappingUpdate {
  schema_version: 1;
  attempt_id: string;
  governing_plan: ArtifactReference;
  expected_revision: number;
  requirements: RequirementUpdate[];
}

/** The core supplies these identities from the accepted plan and current mapping. */
export interface MappingValidationContext {
  attempt_id: string;
  governing_plan: ArtifactReference;
  requirement_ids: readonly string[];
  mapping_revision: number;
}

export interface DetailReference {
  attempt_id: string;
  path: string;
}

export interface RequirementSummary {
  source: RequirementReference;
  decision_ref: ArtifactReference | null;
  work_state: RequirementWorkState;
  /** Derived from checked evidence by the core; never writable in an update. */
  verification: VerificationState;
  proof_refs: ArtifactReference[];
  detail_ref: DetailReference;
}

export interface UnresolvedWorkSummary {
  kind: "decision" | "blocker";
  attempt_id: string;
  phase: string | null;
  requirement_id: string | null;
  summary: string;
  detail_ref: DetailReference;
}

export interface SummaryPage<T> {
  items: T[];
  offset: number;
  limit: 5;
  total: number;
  omitted: number;
  next_cursor: string | null;
}

export interface SummaryWarning {
  code: "related_checkpoint" | "phase_mismatch" | "evidence_unavailable" | "artifact_changed" | "mapping_missing";
  message: string;
  requirement_id: string | null;
  detail_ref: DetailReference | null;
}

export interface AttemptSummary {
  schema_version: 1;
  attempt: { id: string; lifecycle_state: AttemptLifecycleState; current_phase: string | null };
  governing_plan: ArtifactReference | null;
  mapping:
    | { status: "present"; revision: number; detail_ref: DetailReference }
    | { status: "mapping_missing"; revision: null; detail_ref: DetailReference };
  requirements: SummaryPage<RequirementSummary>;
  unresolved_work: SummaryPage<UnresolvedWorkSummary>;
  /** Independent from related-checkpoint warnings and attempt lifecycle. */
  evidence_completeness: VerificationState;
  warnings: SummaryWarning[];
  next_action: string | null;
  history_ref: DetailReference;
}

export interface SummaryCursor {
  schema_version: 1;
  /** Attempt ID, or project slug for startup blocker pages without an owner. */
  attempt_id: string;
  mapping_revision: number;
  collection: SummaryCollection;
  offset: number;
  limit: 5;
  /** Summary-issued cursors also bind derived rows, such as blocked attempts. */
  source_sha256?: string;
}

export interface SummaryQueryOptions {
  requirementsCursor?: string;
  unresolvedWorkCursor?: string;
}

export interface CursorValidationContext {
  attempt_id: string;
  mapping_revision: number;
  collection: SummaryCollection;
  source_sha256?: string;
}

export type ValidationResult<T> =
  | { valid: true; errors: []; value: T }
  | { valid: false; errors: string[] };
