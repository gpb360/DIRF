# DIRF typed artifact provenance and plan delta

Status: Phase 1 outcome contract
Attempt: `20260812T182702394Z-p0-artifact-provenance-plan-delta`
Date: 2026-08-12

## Outcome

An agent or person can ask DIRF which accepted artifact governs an attempt, trace why it governs, and compare delivered scope with the accepted plan before completing the attempt.

The feature extends the existing Attempt module. It does not create a second state store, task tree, issue tracker, or host-specific workflow.

## User-visible success

Given an attempt with typed artifacts, DIRF can:

1. validate the artifact graph and reject missing, duplicate, cyclic, or invalid references;
2. resolve one deterministic governing artifact from accepted artifacts;
3. prevent a configured implementation phase from advancing until its required artifact is accepted;
4. save and read a `plan_delta` artifact that classifies planned, added, omitted, and unverifiable scope;
5. read and run every existing artifact-free attempt without migration.

## Module and seam

Artifact graph behavior belongs behind a small pure interface. Canonical persistence remains in `src/state.js`, the only module that reads or writes canonical Attempt state.

```js
validateArtifactGraph(artifacts) -> { valid, errors }
resolveGoverningArtifact(artifacts, requiredTypes?) -> artifact | null
validatePlanDelta(value) -> { valid, errors }
```

The interface returns results and accepts data. It does not read files, mutate an attempt, inspect Git, or call a host. `src/state.js` invokes it when loading or changing artifact metadata and when checking an artifact-backed decision gate.

The deletion test supports this seam: without the pure module, graph validation, precedence, cycle detection, type rules, and plan-delta validation would spread across state transitions, validation, CLI rendering, and tests.

## Persistence contract

Typed metadata is an optional `artifacts` array in `attempt.json`. Artifact content remains a relative file inside the existing attempt folder.

```json
{
  "artifacts": [
    {
      "id": "05-plan",
      "type": "plan",
      "path": "artifacts/05-plan.md",
      "created_at": "2026-08-12T18:30:00.000Z",
      "accepted_at": "2026-08-12T18:35:00.000Z",
      "supersedes": ["04-structure"]
    }
  ]
}
```

Rules:

- `artifacts` absent means the legacy behavior and is valid.
- `id` is unique and stable within one attempt.
- `type` is one of `research_questions`, `research`, `design`, `structure`, `plan`, `implementation_evidence`, or `plan_delta`.
- `path` is attempt-relative, uses forward slashes, and cannot escape the attempt folder.
- `created_at` is an ISO-8601 timestamp.
- `accepted_at` is an ISO-8601 timestamp or absent. Acceptance is explicit; creation never implies acceptance.
- `supersedes` contains unique artifact IDs from the same attempt and forms an acyclic graph.
- Artifact metadata stays portable: no absolute host paths, provider paths, or runtime-only identities.

## Deterministic precedence

Precedence is graph-first and time-second:

1. Only accepted artifacts are eligible.
2. An accepted artifact superseded directly or transitively by another eligible artifact is not governing.
3. If multiple eligible leaves remain, the later `accepted_at` wins.
4. If timestamps are equal, lexical `id` order is the stable tie-breaker.

Live code remains authoritative for current runtime behavior; artifact precedence governs approved intent, not claims about what the code currently does.

## Acceptance gate integration

Artifact acceptance reuses the current decision-gate mechanism. A workflow may add an optional required artifact type to a decision gate:

```json
{
  "kind": "decision",
  "artifact_type": "plan"
}
```

Advancing past that phase requires both:

- the existing accepted gate record; and
- a governing accepted artifact of the declared type.

Old gates without `artifact_type` behave exactly as they do now. Artifact metadata does not introduce a second lifecycle or a second approval record.

## Plan delta contract

A `plan_delta` artifact is valid only when it identifies the accepted governing plan and contains four arrays:

```json
{
  "plan_artifact_id": "05-plan",
  "implemented_as_planned": [],
  "additions": [],
  "omissions": [],
  "unverifiable": []
}
```

Every entry contains a stable `id`, a concise `summary`, and non-empty `evidence` references. Entries in `additions` and `omissions` also require a reason. Empty arrays are valid and explicit.

P0 validates and records this evidence. It does not attempt semantic diff generation, infer plan coverage from Git, or require GitHub.

## Error behavior

Invalid artifact state fails closed for artifact-aware operations and reports all deterministic validation errors. It must not make legacy attempts unreadable.

Examples include:

- duplicate or missing IDs;
- unknown types;
- absolute or escaping paths;
- invalid timestamps;
- missing superseded targets or cycles;
- an artifact-aware gate with no accepted governing artifact of the required type;
- a `plan_delta` pointing at a missing, unaccepted, or non-governing plan.

## Acceptance tests

Focused tests must prove:

- artifact-free schema versions and historical attempts retain current behavior;
- valid linear and branching graphs resolve deterministically;
- duplicates, missing references, cycles, path escapes, bad types, and bad timestamps fail;
- acceptance time and lexical tie-breaking are stable;
- an artifact-aware decision gate blocks until both approval and the required accepted artifact exist;
- legacy decision and verification gates are unchanged;
- all four plan-delta classifications validate, including explicit empty arrays;
- plan deltas reject missing evidence and references to a non-governing plan;
- saved attempt metadata contains no absolute project or host paths.

Verification commands for the implementation phase:

```text
node --test tests/artifacts.test.js tests/gates.test.js tests/state.test.js tests/project.test.js
node src/cli.js validate
git diff --check
```

## Explicit exclusions

- No RPI or HumanLayer installation.
- No alternate artifact directory outside the canonical Attempt folder.
- No automatic acceptance, plan generation, Git diff interpretation, issue creation, commit, push, PR, deployment, or external mutation.
- No required migration or rewrite of existing attempts.
- No UI work in P0.

## Phase-one decision

Proceed with the artifact graph as an optional extension of `attempt.json`, a pure validation/resolution module, persistence through `src/state.js`, and artifact-aware reuse of existing decision gates.
