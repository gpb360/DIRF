// Default ceiling for any repeated fix, retry, or review loop.
// A user or task may state a different limit. policies/workflow-policy.md
// repeats this number for agents; tests/review-ledger.test.js keeps them equal.
export const MAX_LOOP_ROUNDS = 5;
