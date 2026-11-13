---
name: pr-watch
kind: playbook
order: 17
description: "Watch an open pull request through checks and review bots, fix the real findings, and stop when it is ready."
uses: ["../../skills/pr-communication"]
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description": "Watch an open pull request through checks and review bots, fix the real findings, and stop when it is ready.", "keywords": ["babysit", "babysit pr", "watch pr", "watch the pr", "monitor pr", "monitor the pr", "watch pull request", "until the checks", "checks are green", "review bots"], "agents": ["agent-organizer", "test-engineer", "error-coordinator"], "workflow": {"phases": ["record the PR and its latest commit", "handle the checks and comments that already exist", "run one watcher and wait", "check each new finding against the code", "fix real findings and answer the rest", "keep the branch current with its base", "confirm the PR is ready on the latest commit"], "gates": {"confirm the PR is ready on the latest commit": {"kind": "decision"}}, "agent_contracts": {"agent-organizer": {"phases": ["record the PR and its latest commit", "handle the checks and comments that already exist", "run one watcher and wait", "keep the branch current with its base", "confirm the PR is ready on the latest commit"], "output": "one watcher for the PR, a current branch, and a plain ready, waiting, or blocked status for the latest commit", "verification": "the status names the latest commit, every required check, every open review conversation, and whether the branch is behind its base"}, "test-engineer": {"phases": ["check each new finding against the code"], "output": "each finding and failed check marked real, not real, or infrastructure fault, with evidence", "verification": "every verdict cites the code, a reproduction, or the check output for the latest commit"}, "error-coordinator": {"phases": ["fix real findings and answer the rest"], "output": "the smallest fix for each real finding and a written reason for each item that is not a finding", "verification": "each fix has proof from this session and each written reason is posted as a reply"}}, "output": "a pull request that is ready on its latest commit, or a plain statement of what blocks it; a merge happens only when the user asked for it", "validation": "required checks pass on the latest commit, review bots finished, no review conversation is open, and the branch is not behind its base", "recovery": "if the watcher stops or GitHub is unreachable, check the rate limit and start one watcher again; if another pull request makes this one obsolete, stop and ask before closing it"}, "questions": ["Which pull request should be watched?", "May the pull request be merged when it is ready, or does a person merge it?"], "skill_flow": {"label": "watch, verify each finding, fix what is real, stop when ready", "steps": [{"stage": "verify", "reason": "Check every bot finding and failed check against the code before any change.", "capability": "code review"}, {"stage": "fix", "reason": "Fix real findings with the smallest change. Answer the rest in writing.", "capability": "minimalism"}, {"stage": "verify", "reason": "Prove each fix before the push.", "capability": "testing"}, {"stage": "report", "reason": "Reply to each finding and report the result in plain language.", "capability": "pull request communication"}]}}

---

# pr-watch

Watch one open pull request until it is ready. Review bots and CI help, and
they are not always right.

This playbook covers CI and review bots after the pull request is open. Agent
reviews follow the Review Ladder in the `pr-review` playbook. When a review
artifact exists for this pull request, run `dirf review ready review.json`
before you call it ready.

## One watcher

Use exactly one watcher for each pull request.

- When the host has a pull-request watch tool, handle the existing checks and
  comments first. Then start the watch and end the turn. The host wakes you
  when a check fails, the required checks pass, someone comments, or the
  branch conflicts.
- Without that tool, run one long command that ends by itself:
  `gh pr checks <n> --watch`. Add `--required` only when the base branch has
  required checks. Then read the new comments and review conversations.
- Start the watcher again after each push.
- Do not write a polling loop or a `sleep` loop. All watchers on one GitHub
  account share one rate limit.
- Only the session that owns the pull request watches it. A delegated
  reviewer or fixer does not.
- Stop the watch before you hand off, report a blocker, or ask the user a
  question.

A wake-up is news. It is not a decision to merge. Check readiness yourself.

When an event needs no action, end the turn without a message. Do not post or
say "still waiting".

## Findings

1. Act only on checks and comments that are newer than the latest push.
2. Check every bot finding against the code before you change anything.
3. Separate a failure in the repository from a fault in the runner or the
   network. Run a faulted check again. Do not change code for it.
4. A finding is real when it shows a reachable failure in the behavior this
   pull request changes. Fix it with the smallest change. Prove the fix
   before you push it.
5. A style preference, a risk with no reachable failure, and an issue outside
   the changed behavior are not findings, as the `code-review` skill states.
   Answer each one with a written reason and list it as a follow-up.
6. Prefer the fix that deletes or narrows code.

Review loops grow a pull request one small fix at a time. Keep it at the size
the goal needs. Each push that starts the checks again is one round of the
Loop Limit in the workflow policy. At the limit, stop and ask a person.

Some bots only advise. When the project marks a bot as advisory, read its
findings and do not wait for it.

Reply to every finding with the `pr-communication` skill. Resolve a review
conversation only after its reply is posted.

## Base branch

- Check for new commits on the base branch. The pull request is not ready
  while it is behind or in conflict.
- When base commits that landed after the last passed run touch files in this
  pull request, rebase, push, and wait for the checks again.
- Update the branch with `git push --force-with-lease` after a rebase. Never
  use a plain force push.
- When another pull request makes this one obsolete, stop the watch. Report
  it and ask before you close anything.

## Stop

The pull request is ready when all of these are true on the latest commit:

- Required checks passed. When the base branch requires none, every check
  passed.
- Review bots finished.
- Each finding has a fix, and each other item has a written reason.
- No review conversation is open, and no person requests changes.
- The branch is current with its base and mergeable.

Merge only when the user asked for a merge. Otherwise report that the pull
request is ready. Immediately before a merge, fetch and check the pull request
again. Use the merge method the repository uses, and never bypass branch
protection.

If the watcher stops because it could not read the pull request, check the
rate limit with `gh api rate_limit --jq .resources.graphql`. Wait for the
reset before you start one watcher again.
