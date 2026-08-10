# FlowStack governed-execution integration

DIRF owns the vendor-neutral decision semantics. FlowStack supplies the production persistence and execution adapter.

## Server-side seam

1. A trusted Edge Function normalizes the requested FlowStack action into the DIRF request contract.
2. The evaluator returns `allow`, `require_approval`, or `deny` with action and policy digests.
3. FlowStack stores immutable request and decision snapshots under the organization.
4. High-risk approval is issued by a named human and bound to both digests, organization, expiry, and one use.
5. A single database RPC atomically consumes the authorization before the function loads credentials or calls an external provider.
6. Outcome evidence is appended to the hash-linked ledger and linked into the existing document-first governance corpus.

## Persistence contract

Use organization-scoped tables for normalized requests, policy snapshots, decisions, authorizations, and ledger entries. Enforce RLS for tenant readers, use a narrow server-only function for authorization consumption, and retain old policy/decision snapshots after policy changes.

The consume operation must check in one transaction:

- authorization id and organization;
- exact action and policy digests;
- approving human identity and role;
- issued/expiry timestamps;
- `consumed_at is null`;
- the caller's server-side execution identity.

It then sets `consumed_at`, `consumed_by`, and a unique execution id and returns success once. Provider credentials are fetched only after success.

## FlowStack mappings

| FlowStack operation | DIRF action kind | Default control |
| --- | --- | --- |
| Read evidence or assessment state | `read` / `inspect` | Exact tenant target |
| Edit local governance artifacts | `write` / `edit` | Mandate plus exact repository/ref |
| Publish an assessment snapshot | `database_mutation` | Evidence, payload digest, named approval, single use |
| Send email or provider message | `external_send` | Exact-content approval and atomic consumption |
| Deploy an Edge Function or migration | `deploy` | Scope/verification evidence and named approval |
| Change billing or initiate payment | `billing_change` / `payment` | Critical approval plus rollback evidence |

Existing FlowStack rules remain authoritative: documents form the evidence corpus, assessment runs are immutable, repository evidence is exact `owner/repo@branch`, non-repository evidence survives branch changes, and no score or finding is manufactured outside `governance-assess`.

## Acceptance gates

- Cross-tenant requests deny before authorization lookup.
- Unknown action kinds deny.
- Changing action content or policy invalidates approval.
- Parallel consumers produce exactly one successful authorization consumption.
- Credentials are unreachable before consumption.
- Assessment and execution history remain clickable after refresh.
- Ledger mutation is detected.
- Logs and evidence contain references and digests, never secret values.
