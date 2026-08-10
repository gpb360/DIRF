# RTK provenance and amplification

Research baseline: `rtk-ai/rtk` commit `9936b2b9ce560283d7be21fdfad027cb537be69c`, reviewed 2026-08-09.

Patterns retained as independently implemented behavior:

- deny, ask, allow, and least-privilege default decisions;
- deny precedence and independent permission for every compound command segment;
- deferral for actions a normalizer cannot attest;
- content hashes that invalidate trust when reviewed rules change;
- hook integrity checks, local audit metrics, recoverable full output, and transparent host adapters;
- preservation of stricter host-native permissions.

DIRF amplifies those patterns with tenant identity, named mandates, exact repository/ref scope, evidence requirements, action and policy digest binding, non-self human approval, expiry, single-use authorization, atomic consumption, secret rejection, and hash-linked execution evidence.

RTK is Apache-2.0 licensed. This package copies no RTK source code and does not use RTK branding or infer private RTK Pro behavior. If source code is copied later, retain its license and notices, mark modified files, and review trademark constraints before distribution.
