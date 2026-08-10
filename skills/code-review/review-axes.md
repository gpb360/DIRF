# Review axes

Evaluate every axis and record `checked`, `finding`, or `not_applicable` with evidence.

## Spec

Compare behavior with the issue, specification, PR intent, and repository rules. Check scope omissions and unrelated behavior changes.

## Correctness

Trace happy paths, failure paths, state transitions, null and boundary inputs, error propagation, retries, cleanup, and backward compatibility.

## Concurrency

Check ordering, stale state, duplicate work, idempotency, atomicity, lost updates, retry identity, and out-of-order completion. Require a test that exercises the dangerous ordering when concurrency is relevant.

## Security

Check authorization at the mutation boundary, tenant isolation, untrusted inputs, secret exposure, injection, unsafe deserialization, credential access, and fail-open behavior.

## Data

Check schema compatibility, constraints, transactions, migrations, rollback, legacy writers, preservation of sibling fields, and exact binding between request and persisted result.

## Frontend

Check user-visible states, stale responses, accessibility, loading and error recovery, responsive behavior, and whether client state can contradict the server source of truth.

## Testing

Check that tests reproduce the boundary rather than only mock the intended implementation. Include negative paths and installed-library response shapes when they affect behavior.

## Standards

Apply repository instructions, architectural conventions, public API guarantees, generated-file rules, and dependency constraints. Report deviations only when they create a concrete maintenance or runtime failure.
