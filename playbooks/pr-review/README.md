---
name: pr-review
kind: playbook
order: 1
description: "Review a pull request with at most four reviewers and one code-cleaner. Stop for a person when the review does not qualify."
uses: ["../../skills/code-review"]
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description": "Review a pull request with at most four reviewers and one code-cleaner. Stop for a person when the review does not qualify.", "keywords": ["pr", "pull request", "review", "diff", "merge", "code review"], "agents": ["agent-organizer", "test-engineer", "security-auditor", "performance-benchmarker"], "workflow": {"phases": ["get the latest PR version", "review the changed behavior", "check security risks", "check performance and regression risks", "prove each suspected issue", "fix every confirmed issue", "test the fixes", "review the updated PR again", "confirm no issues or checks remain"], "gates": {"review the updated PR again": {"kind": "verify", "check": "review-json"}, "confirm no issues or checks remain": {"kind": "decision"}}, "agent_contracts": {"agent-organizer": {"phases": ["get the latest PR version", "fix every confirmed issue", "review the updated PR again", "confirm no issues or checks remain"], "output": "a current review with clear ownership for every required correction", "verification": "dirf review ready review.json passes before merge approval is requested"}, "test-engineer": {"phases": ["review the changed behavior", "prove each suspected issue", "test the fixes"], "output": "behavior traces and focused proof for every confirmed issue and fix", "verification": "each confirmed issue is reproduced, corrected, and proved by the narrowest applicable check"}, "security-auditor": {"phases": ["check security risks"], "output": "applicable security issues or a clear statement that none were found", "verification": "changed trust boundaries, authorization, secrets, injection, and fail-open behavior were checked"}, "performance-benchmarker": {"phases": ["check performance and regression risks"], "output": "applicable performance or regression issues, or a clear statement that none were found", "verification": "changed hot paths and regression-sensitive behavior were checked with proportionate proof"}}, "output": "a plain-language status and a detailed review report; merge approval is requested only after the current commit has no remaining issues and every required check passes", "validation": "dirf review ready review.json", "recovery": "if the PR is unavailable, ask for its URL or branch; if an issue remains or a check is incomplete, say what remains and do the next step of the Review Ladder; after the last step, or if dirf review trigger returns stop_for_person, stop and give the result to a person"}, "questions": ["What branch, commit range, diff, or PR should be reviewed?", "What issue, specification, or expected behavior defines correctness?"], "skill_flow": {"label": "review, add two reviewers, fix one time, review the fix, then stop", "steps": [{"stage": "review", "reason": "Get the current PR version and review its behavior and regressions.", "capability": "code review"}, {"stage": "security", "reason": "Check relevant trust boundaries, secrets, injection, authorization, and fail-open behavior.", "capability": "security review"}, {"stage": "fix", "reason": "Fix every confirmed issue without expanding the task.", "capability": "implementation"}, {"stage": "verify", "reason": "Run the smallest checks that prove each fix and all required PR checks.", "capability": "testing"}, {"stage": "review", "reason": "Review the fixed commit one time against the earlier reviews. Stop when that review does not qualify.", "capability": "code review"}]}}

---

# pr-review

Review the current pull request with the Review Ladder. The ladder uses at most
five agents: four reviewers and one code-cleaner. No step occurs twice.

1. Read the recorded review of the current commit. If it is qualified, start no agents.
2. One reviewer reviews the current commit. If the review is qualified, stop.
3. Two more reviewers review the same commit. If two of the three reviews are
   qualified, stop.
4. One code-cleaner reads all three reviews and fixes the issues in one commit.
5. One reviewer reviews that commit against the three earlier reviews.
6. If that review is not qualified, stop. Tell the person that the work needs a
   new examination.

Check gate: before step 2 and before step 5, run the required checks of the
task, such as lint, type check, tests, and build. The checks are commands, not
agents. If a required check fails, start no reviewer. Give the check output to
the author of the commit and stop.

A reviewer only reviews. A code-cleaner only changes code. Neither starts agents.
A review is qualified when it meets the gate that the user or task states.
Without a stated gate, it is qualified when it has no P0, P1, P2, or P3 finding.

Keep the detailed grade, confidence, and priority data in `review.json` and its
rendered report. Normal updates use ordinary language: how many issues remain,
what was fixed, what passed, whether another review is running, and what happens
next. Run `dirf review ready review.json` before asking to merge. That command
must confirm the report covers the current commit, no issues remain, the review
is complete, required checks passed, and no review conversations remain open.

To run the ladder without a person between steps, run `dirf review loop --pr N
--reviewer CMD --fixer CMD --check CMD` in the PR checkout. The reviewer command
writes review JSON to `DIRF_REVIEW_OUTPUT` for the commit in `DIRF_REVIEW_HEAD`.
The fixer command reads the reviews in `DIRF_REVIEW_FINDINGS` and makes one
commit. The command does not push or merge.

Run `dirf review trigger` for each review. The round count in the DIRF store is
a second limit. When the command returns `stop_for_person`, stop and give the
remaining issues to a person.
