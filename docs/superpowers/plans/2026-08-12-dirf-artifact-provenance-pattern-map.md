# DIRF artifact provenance pattern map

Status: reuse-existing-patterns phase
Attempt: `20260812T182702394Z-p0-artifact-provenance-plan-delta`
Specification: `docs/superpowers/specs/2026-08-12-dirf-artifact-provenance-plan-delta.md`

## Result

The P0 feature fits the existing Attempt module without a new store or lifecycle. The smallest vertical slice is one pure artifact module, optional metadata on `attempt.json`, three state operations, a narrow CLI surface, and reuse of the existing decision-gate path.

## Closest existing patterns

| Required behavior | Existing pattern | Reuse decision |
|---|---|---|
| Pure structured validation | `validateReview` accumulates deterministic errors in `skills/code-review/scripts/review-report.mjs:48-154`; governance separates pure evaluation from persistence in `src/governance.js` | Add `src/artifacts.js` with pure graph and plan-delta validation; no filesystem access |
| Canonical attempt persistence | `createAttemptInStore`, `listAttempts`, private `writeAttempt`, and `atomicWrite` in `src/state.js:244-307` | Store optional `artifacts` metadata on `attempt.json`; all reads/writes remain in `state.js` |
| Portable paths | `portable`, `storeSegment`, target-relative workflow paths, and runtime-path rejection in `src/state.js:122-130,228-241` and `src/validate.js:140-147` | Validate artifact paths as non-absolute attempt-relative paths with no `..` segment |
| Optional backward-compatible state | Gate metadata is absent for old attempts and introduced only when non-empty in `src/state.js:328-398,482-493` | Missing `artifacts` means `[]`; do not bump or migrate historical attempt files for P0 |
| Deterministic precedence | Governance defines explicit precedence tables and a pure `strongest` reducer in `src/governance.js:16-22,270-271` | Encode artifact eligibility and tie-breaking explicitly; never rely on array order |
| Decision enforcement | `gateRequirement` is the single check used by manual advance, auto-advance, and progress sync in `src/state.js:345-358,466-558,606-624` | Extend this one seam so `artifact_type` is checked everywhere automatically |
| Gate projection | `attemptGateState`, `pendingGates`, and CLI public projections in `src/state.js:367-402` and `src/cli.js:352-374` | Include required artifact type and resolved artifact ID in the existing gate projection |
| Workflow validation | `validateSnapshot` validates optional gates while preserving old snapshots in `src/validate.js:24-66`; reconciliation tests mirror it in `tests/gates.test.js:293-329` | Permit `artifact_type` only on decision gates and validate it against the artifact type vocabulary |
| State test fixtures | `attemptFixture` writes a real `workflow.json` and uses isolated `DIRF_HOME` in `tests/gates.test.js`; store tests use temp Git repositories in `tests/state.test.js` and `tests/project.test.js` | Extend those fixtures instead of mocking state internals |
| CLI lifecycle testing | Gate tests invoke `src/cli.js` as a subprocess and inspect JSON in `tests/gates.test.js:250-287` | Add CLI round-trip tests using the same subprocess pattern |

## Module placement

### `src/artifacts.js` — pure artifact behavior

This module owns the artifact vocabulary and all behavior that can be exercised without the filesystem:

```js
export const ARTIFACT_TYPES
export function validateArtifactGraph(artifacts)
export function resolveGoverningArtifact(artifacts, requiredTypes)
export function validatePlanDelta(value, artifacts)
```

It returns `{ valid, errors }` for validation and an artifact or `null` for resolution. Invalid graphs never partially resolve. Cycle detection, supersession traversal, acceptance eligibility, timestamp comparison, and lexical tie-breaking remain private implementation details.

This is a deep module: callers learn three operations while graph behavior stays local. It has one real caller seam with multiple consumers—state transitions, snapshot validation, and CLI projection—without exposing internal graph utilities.

### `src/state.js` — canonical persistence and lifecycle integration

Add state operations beside the existing attempt functions:

```js
listAttemptArtifacts(slug, idOrName)
recordAttemptArtifact(slug, idOrName, artifact, now?)
acceptAttemptArtifact(slug, idOrName, artifactId, now?)
```

`recordAttemptArtifact` validates the complete candidate graph before the existing atomic `attempt.json` write. `acceptAttemptArtifact` timestamps an existing artifact and validates the complete graph before writing. Both return the updated attempt through the existing `writeAttempt` path.

Extend `attemptWorkflow` to retain `artifact_type` in gate declarations without adding another workflow read. Extend `gateRequirement` to receive the current artifact list and require a governing artifact of the declared type after the existing decision record is accepted.

Do not write artifact content from the state module in P0. The metadata path points to content already placed inside the attempt folder by the host or a later adapter. P0 validates metadata and lifecycle truth; it does not invent file-authoring authority.

### `src/validate.js` — persisted workflow contract

Reuse optional-field validation:

- absent `artifact_type` stays valid;
- present `artifact_type` must be a known type;
- `artifact_type` is valid only when `kind` is `decision`;
- no schema-version bump is required because this is an optional workflow field.

Artifact metadata itself is validated when state reads or changes an artifact-aware attempt. `validateSnapshot` validates the workflow declaration, not canonical `attempt.json` persistence.

### `src/cli.js` — smallest usable interface

Follow the `notice` and `attempt` command dispatch patterns:

```text
dirf artifact list <attempt> [--json]
dirf artifact add <attempt> --file <metadata.json>
dirf artifact accept <attempt> <artifact-id>
```

`add` accepts one JSON metadata record. A `plan_delta` record uses the same command and points to a JSON or Markdown artifact file; no special GitHub or Git inference command is introduced.

CLI JSON projections should show:

- artifact metadata;
- the governing accepted artifact;
- artifact-aware pending gates and their required type.

The CLI remains a shell over state and pure validation. It must not duplicate graph rules.

## Vertical implementation slice

Implement in this order so every step is independently testable:

1. Add `src/artifacts.js` and `tests/artifacts.test.js` for vocabulary, paths, graph validation, precedence, cycles, and plan-delta validation.
2. Add state list/record/accept operations and persistence coverage in `tests/state.test.js` or a focused `tests/state-artifacts.test.js`.
3. Add `artifact_type` to workflow validation and the single `gateRequirement` enforcement seam, extending `tests/gates.test.js` for manual advance, auto-advance, progress sync, and legacy behavior.
4. Add the minimal CLI commands and JSON projection tests in `tests/cli-artifacts.test.js`.
5. Update README/agent guidance only for the shipped command surface, then run focused and full validation.

## Exact compatibility constraints

- Keep `attempt.schema_version` at 2 for P0; optional metadata must not reclassify historical attempts.
- Never rewrite existing attempts merely because they were read.
- Preserve `writeAttempt` as the only attempt metadata writer.
- Preserve `gateRequirement` as the single lifecycle enforcement point.
- Preserve gate-free and artifact-free byte shape: do not add empty `artifacts`, `gates`, or `evidence` keys.
- Keep artifact paths portable and attempt-relative.
- Keep plan delta independent of GitHub, PR state, and repository hosting.

## Tests mapped to acceptance criteria

| Acceptance criterion | Test home |
|---|---|
| Valid/invalid graphs and deterministic governing artifact | new `tests/artifacts.test.js` |
| Plan-delta four-bucket validation and governing-plan reference | new `tests/artifacts.test.js` |
| Atomic record/accept round trip and absent-artifacts compatibility | new `tests/state-artifacts.test.js` |
| Artifact-aware gate blocks manual advance | `tests/gates.test.js` |
| Artifact-aware gate blocks auto-advance and progress sync | `tests/gates.test.js` |
| Legacy gates and artifact-free attempts remain unchanged | existing plus added assertions in `tests/gates.test.js` |
| CLI add/list/accept JSON round trip and error exit | new `tests/cli-artifacts.test.js` |
| No absolute paths persist | `tests/state-artifacts.test.js` and `tests/project.test.js` |

## Verification for this phase

```text
node src/cli.js validate
git diff --check -- docs/superpowers/specs/2026-08-12-dirf-artifact-provenance-plan-delta.md docs/superpowers/plans/2026-08-12-dirf-artifact-provenance-pattern-map.md
```

## Next implementation target

Begin the vertical slice with the pure artifact module and its focused tests. Do not touch state or CLI until the graph and plan-delta contracts pass through the module interface.
