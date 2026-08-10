# GOVERNED method

Use this sequence for every action that can read sensitive context, change state, contact another system, or affect another person.

1. **Ground** — bind the actor, organization, exact target, repository/ref when applicable, and the user mandate. Complete when no identity or tenant field is inferred.
2. **Observe** — normalize the whole action, including compound segments and exact content digests. Complete when hidden shell segments, redirects, callbacks, provider calls, and payloads are represented.
3. **Verify** — validate the policy version, mandate time/scope, evidence digests, and target organization. Complete when malformed, expired, stale, and cross-tenant inputs are denied.
4. **Evaluate** — match every segment and combine outcomes using `deny > require_approval > allow` and the highest risk. Complete when no segment relies on another segment's permission.
5. **Require authority** — bind high/critical actions to a named human, exact action digest, exact policy digest, organization, expiry, and single-use authorization. Complete when changed content or policy necessarily requires a new approval.
6. **Narrowly execute** — atomically consume authorization before credentials, provider access, or irreversible effects, then execute only the normalized action. Complete when replay and time-of-check/time-of-use reuse are impossible.
7. **Evidence** — record the decision, consumption result, execution outcome, verification, and reversible recovery reference without credentials. Complete when an independent reviewer can reconstruct what happened.
8. **Digest** — append the event to the hash-linked ledger and verify its chain. Complete when mutation of any prior record is detectable.

Low-risk observation may proceed without human approval when the target is exact. State changes require a mandate. High/critical changes require named human approval. Policy errors, missing scope, missing evidence, and unknown action kinds fail closed.
