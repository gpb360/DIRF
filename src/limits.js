// Default ceiling for any repeated fix, retry, or review loop.
// A user or task may state a different limit. The value lives in the skill so
// that the skill folder stays self-contained. policies/workflow-policy.md
// repeats the number for agents; tests/review-ledger.test.js keeps those equal.
export { MAX_LOOP_ROUNDS } from "../skills/code-review/scripts/review-ledger.mjs";
