---
name: pr-modernize
kind: playbook
order: 18
description: "Bring an old, stale, or outdated pull request up to date and decide whether it still belongs: modernize, rework, or close."
uses: ["../../skills/pr-modernization","../../skills/pr-communication"]
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description": "Bring an old, stale, or outdated pull request up to date and decide whether it still belongs: modernize, rework, or close.", "keywords": ["modernize pr", "modernize this pr", "modernize the pr", "rebase pr", "rebase the pr", "rebase this pr", "stale pr", "old pr", "outdated pr", "stale pull request", "outdated pull request", "old pull request"], "agents": ["agent-organizer", "research-analyst", "test-engineer"], "workflow": {"phases": ["fetch the latest base and PR head", "state the smallest goal of the PR", "check what changed on the base branch", "choose modernize, rework, or close", "rebase in a safe checkout", "compare the commits before and after the rebase", "run the focused checks", "push with a lease and report"], "gates": {"choose modernize, rework, or close": {"kind": "soft"}, "push with a lease and report": {"kind": "decision"}}, "agent_contracts": {"agent-organizer": {"phases": ["fetch the latest base and PR head", "choose modernize, rework, or close", "rebase in a safe checkout", "push with a lease and report"], "output": "a recorded PR state, one disposition with its reason, and a rebased branch when the disposition is modernize", "verification": "the disposition cites base-branch evidence, and the push used a lease tied to the head recorded before the rebase"}, "research-analyst": {"phases": ["state the smallest goal of the PR", "check what changed on the base branch"], "output": "the smallest goal of the PR and the base-branch changes that affect it", "verification": "the goal comes from the PR title, body, issues, commits, and diff, and each base-branch change cites a commit or pull request"}, "test-engineer": {"phases": ["compare the commits before and after the rebase", "run the focused checks"], "output": "a comparison of the commit series before and after the rebase, and the check results for the touched area", "verification": "no intended behavior disappeared, no merged behavior returned, and each failed check is marked new, pre-existing, or infrastructure fault"}}, "output": "a report that leads with MODERNIZE, REWORK, or CLOSE and its reason; a rebased and pushed branch only for MODERNIZE", "validation": "git range-diff of the old and new commit series shows the intended changes only, and the focused checks for the touched area pass", "recovery": "if the lease fails, fetch and assess the new commits before any second push; if a conflict shows a product or architecture disagreement, stop and choose the disposition again"}, "questions": ["Which pull request should be brought up to date?", "If the right result is a rework, may it be done now or should the run stop at the recommendation?"], "skill_flow": {"label": "old pull request -> does it still belong -> safe rebase", "steps": [{"stage": "decide", "reason": "State the goal of the pull request and decide whether it still belongs before any rebase.", "capability": "branch modernization"}, {"stage": "understand", "reason": "Read what changed on the base branch around the pull request.", "capability": "code review"}, {"stage": "verify", "reason": "Prove the rebase kept the intended behavior.", "capability": "testing"}, {"stage": "report", "reason": "Lead with the disposition and separate facts from judgment.", "capability": "contribution writeup"}]}}

---

# pr-modernize

Modernize the idea, not only the branch. Read the
[pull request modernization skill](../../skills/pr-modernization/README.md)
before the first phase. It holds the limits, the three dispositions, and the
safe rebase.

MODERNIZE continues to the rebase. REWORK and CLOSE stop for the person.
