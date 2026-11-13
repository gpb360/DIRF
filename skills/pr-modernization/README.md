---
name: pr-modernization
kind: skill
description: "Decide whether an old pull request still belongs, then rebase it safely: modernize, rework, or close"
uses: []
details: []
inputs: ["old pull request"]
outputs: ["MODERNIZE, REWORK, or CLOSE with evidence","rebased branch for MODERNIZE"]
capabilities: ["branch modernization"]
---

# Pull request modernization

Modernize the idea, not only the branch. A clean rebase does not prove that
the pull request still belongs in the product.

## Limits

- This skill permits a rebase and an update of the pull request branch. It
  does not permit a merge, a close, a change of base branch, or a larger scope.
- Treat changes in the active checkout as the user's. Use a separate worktree
  when the checkout has changes or other work uses it.
- Push a rebased branch with a lease tied to the head you recorded before the
  rebase: `git push --force-with-lease=<branch>:<recorded-commit>`. Never use
  a plain force push.
- Post a comment only when the user asked for one. Use the `pr-communication`
  skill for it.

## Record and understand

1. Fetch the base branch and the pull request head. Use the real base of the
   pull request, not an assumed one.
2. Record the URL, state, base, head repository and branch, head commit,
   author, checks, and review state. Record the merge base.
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
