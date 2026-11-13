---
name: pr-watching
kind: skill
description: "Watch an open pull request with one watcher, check each bot finding against the code, and decide when the pull request is ready"
uses: []
details: []
inputs: ["open pull request","whether a merge was requested"]
outputs: ["ready, waiting, or blocked status for the latest commit"]
capabilities: ["readiness babysitting"]
---

# Pull request watching

Watch one open pull request until it is ready. Review bots and CI help, and
they are not always right.

This skill covers CI and review bots after the pull request is open. Agent
reviews follow the Review Ladder of the workflow policy. When a review
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
   the changed behavior are not findings. Answer each one with a written reason and list it as a follow-up.
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
- After a rebase, push with a lease tied to the head you recorded before the
  rebase: `git push --force-with-lease=<branch>:<recorded-commit>`. A bot or a
  reviewer can push to the branch while you watch. When the lease fails,
  fetch, keep their commits, and push again. Never use a plain force push or
  a bare `--force-with-lease`.
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
