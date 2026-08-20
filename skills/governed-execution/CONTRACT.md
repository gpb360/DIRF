# Governed execution contract

## Deep module interface

The module exposes four operations:

- `evaluateGovernedAction(request, policy, { now })`
- `digestAction(request)`
- `appendEvidenceLedger(ledger, event, { recordedAt })`
- `verifyEvidenceLedger(ledger)`

Callers need to know only the normalized request, policy, decision meanings, and authorization-consumption rule. Risk matching, precedence, scope validation, canonical hashing, secret rejection, and ledger chaining stay inside the module.

## Request

Required fields:

```json
{
  "id": "request-id",
  "organizationId": "tenant-id",
  "actor": { "id": "agent-or-user-id", "type": "agent", "organizationId": "tenant-id" },
  "source": { "adapter": "host-adapter-id", "version": "adapter-contract-version" },
  "action": {
    "kind": "write",
    "operation": "human-readable normalized operation",
    "target": {
      "id": "exact-target",
      "organizationId": "tenant-id",
      "repository": "owner/repo",
      "ref": "branch-or-commit"
    }
  }
}
```

Compound actions use `action.segments[]`; each segment has its own `kind`, `operation`, and `target`. Exact-content actions add `payloadDigest` in `sha256:<hex>` form.

A mandate includes `id`, named `grantedBy`, `issuedAt`, optional `expiresAt`, and a scope containing `organizationId`, `actionKinds[]`, exact `targets[]`, and exact `repositories[]` entries in `owner/repo@ref` form for repository actions. The action digest binds the trusted adapter id and version as well as the actor, tenant, targets, repository refs, and payload digests.

Evidence items contain only `id`, `type`, `organizationId`, and `digest`. Store artifacts elsewhere and refer to them by digest. The evidence organization must match the request. Credential, token, private-key, password, and API-key values are rejected.

## Approval

High-risk authorization includes:

- a unique id and `decision: approve`;
- named human authority id and role;
- the same organization id;
- exact `actionDigest` and `policyDigest` returned by DIRF; the action digest includes the adapter, action, mandate, and evidence snapshot;
- issued and expiry timestamps;
- `singleUse: true` and no `consumedAt` value.

The evaluator returns `authorizationToConsume` only on an allowed single-use decision. The execution adapter must consume that id atomically before acquiring credentials or causing an external effect. An evaluator result alone is not execution authority.

## Adapter seam

An adapter translates a host action into the request contract and translates the decision back into that host's allow/prompt/deny mechanism. It must preserve the host's stricter native decision, decompose compound actions, and never relabel an unknown mutation as read-only.

Two adapters make this seam real:

- the CLI/file adapter in `dirf govern` for local automation and CI;
- a persistence-backed host adapter for server-side authorization.

The production adapter owns atomic consumption, credential retrieval, side effects, and durable persistence. Tests use an in-memory ledger and fixed clock.
