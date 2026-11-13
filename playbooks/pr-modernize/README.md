---
name: pr-modernize
kind: playbook
order: 18
description: "Bring an old pull request up to date and decide whether it still belongs: modernize, rework, or close."
uses: ["../../skills/pr-communication"]
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description": "Bring an old pull request up to date and decide whether it still belongs: modernize, rework, or close.", "keywords": ["modernize", "modernize pr", "rebase pr", "rebase the pr", "rebase this pr", "stale pr", "old pr", "outdated pr"], "agents": ["agent-organizer", "research-analyst", "test-engineer"], "workflow": {"phases": ["fetch the latest base and PR head", "state the smallest goal of the PR", "check what changed on the base branch", "choose modernize, rework, or close", "rebase in a safe checkout", "compare the commits before and after the rebase", "run the focused checks", "push with a lease and report"], "gates": {"choose modernize, rework, or close": {"kind": "soft"}, "push with a lease and report": {"kind": "decision"}}, "agent_contracts": {"agent-organizer": {"phases": ["fetch the latest base and PR head", "choose modernize, rework, or close", "rebase in a safe checkout", "push with a lease and report"], "output": "a recorded PR state, one disposition with its reason, and a rebased branch when the disposition is modernize", "verification": "the disposition cites base-branch evidence, and the push used a lease tied to the head recorded before the rebase"}, "research-analyst": {"phases": ["state the smallest goal of the PR", "check what changed on the base branch"], "output": "the smallest goal of the PR and the base-branch changes that affect it", "verification": "the goal comes from the PR title, body, issues, commits, and diff, and each base-branch change cites a commit or pull request"}, "test-engineer": {"phases": ["compare the commits before and after the rebase", "run the focused checks"], "output": "a comparison of the commit series before and after the rebase, and the check results for the touched area", "verification": "no intended behavior disappeared, no merged behavior returned, and each failed check is marked new, pre-existing, or infrastructure fault"}}, "output": "a report that leads with MODERNIZE, REWORK, or CLOSE and its reason; a rebased and pushed branch only for MODERNIZE", "validation": "git range-diff of the old and new commit series shows the intended changes only, and the focused checks for the touched area pass", "recovery": "if the lease fails, fetch and assess the new commits before any second push; if a conflict shows a product or architecture disagreement, stop and choose the disposition again"}, "questions": ["Which pull request should be brought up to date?", "If the right result is a rework, may it be done now or should the run stop at the recommendation?"], "skill_flow": {"label": "old pull request -> does it still belong -> safe rebase", "steps": [{"stage": "understand", "reason": "State what the pull request tried to do and what changed around it.", "capability": "code review"}, {"stage": "decide", "reason": "Keep the pull request only when its goal and its shape are still right.", "capability": "minimalism"}, {"stage": "verify", "reason": "Prove the rebase kept the intended behavior.", "capability": "testing"}, {"stage": "report", "reason": "Lead with the disposition and separate facts from judgment.", "capability": "pull request communication"}]}}

---

# pr-modernize

Modernize the idea, not only the branch. A clean rebase does not prove that
the pull request still belongs in the product.

## Limits

- This playbook permits a rebase and an update of the pull request branch. It
  does not permit a merge, a close, a change of base branch, or a larger scope.
- Treat changes in the active checkout as the user's. Use a separate worktree
  when the checkout has changes or other work uses it.
- Push a rebased branch with `git push --force-with-lease` tied to the head
  you recorded before the rebase. Never use a plain force push.
- Post a comment only when the user asked for one. Use the `pr-communication`
  skill for it.

## Record and understand

1. Fetch the base branch and the pull request head. Use the real base of the
   pull request, not an assumed one.
2. Record the URL, state, base, head branch, head commit, author, checks, and
   review state. Record the merge base.
3. Read the title, body, linked issues, commits, review conversations, and the
   full diff.
4. State the smallest goal the pull request tried to reach. Do this before you
   judge the implementation.

## Check what changed around it

Read the commits that landed on the base branch after the pull request split
from it. Search merged and open pull requests for a replacement or a
competing change. Look past overlapping lines:

- Is the same user problem already solved?
- Did interfaces, types, schemas, dependencies, or module boundaries change?
- Do both sides now own the same behavior?
- Was the changed code deleted, moved, or simplified on purpose?
- Would the pull request bring back old behavior, or add a second way to do
  one thing?
- Is the benefit still worth the upkeep?

"No conflicts" does not mean current.

## Choose a disposition

Choose one before any push:

- **MODERNIZE.** The goal is useful and the implementation has the right
  shape. Rebase, resolve conflicts, test, and update the branch.
- **REWORK.** The goal is useful, and a mechanical rebase would keep the wrong
  implementation. Describe the smallest rewrite. Stop before any push unless
  the user also asked for the rework.
- **CLOSE.** The pull request is replaced, obsolete, or not worth its cost.
  Give the evidence and stop. Do not rebase it, and do not close it without
  permission.

Be willing to recommend CLOSE. Age alone is not evidence, and effort already
spent is not a reason to keep a pull request.

## Rebase for MODERNIZE

1. Create a local branch or a separate worktree at the recorded head.
2. Rebase the commits onto the fetched base branch.
3. Resolve each conflict by the goal of the pull request and the newer rules
   of the base branch. When a conflict shows a product or architecture
   disagreement, stop and choose the disposition again.
4. Compare the commit series before and after with `git range-diff`. Read the
   final diff. Confirm that no intended behavior disappeared and no merged
   behavior returned.
5. Run the focused checks for the touched area. Mark each failure as new,
   pre-existing, or an infrastructure fault.
6. Push with the lease. If the lease fails, fetch and assess the new commits.
   Do not overwrite them.

## Report

Lead with MODERNIZE, REWORK, or CLOSE and the reason. Then give:

- the base-branch changes that matter;
- the conflicts in meaning, or a statement that you found none;
- the rebase and push result, when you did them;
- the checks and their results;
- the decision or work that remains, with the pull request link.

Separate what you observed from what you judge. Say what you could not verify.
