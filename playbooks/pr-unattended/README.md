---
name: pr-unattended
kind: playbook
order: 20
description: "Take a change to a ready pull request while nobody watches the thread: full stop leaves it for a person to merge, full send also merges."
uses: ["../../skills/unattended-delivery","../../skills/code-review","../../skills/pr-watching","../../skills/pr-communication"]
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description": "Take a change to a ready pull request while nobody watches the thread: full stop leaves it for a person to merge, full send also merges.", "keywords": ["full stop", "full send", "i am not watching"], "agents": ["agent-organizer", "dx-optimizer", "test-engineer"], "workflow": {"phases": ["confirm the unattended request and its mode", "finish the smallest change", "prove every change", "open the PR", "review the PR until it qualifies", "watch the PR and fix real findings", "check readiness on the latest commit", "hand off the ready PR or merge it"], "gates": {"prove every change": {"kind": "soft"}, "check readiness on the latest commit": {"kind": "soft"}, "hand off the ready PR or merge it": {"kind": "decision"}}, "agent_contracts": {"agent-organizer": {"phases": ["confirm the unattended request and its mode", "open the PR", "review the PR until it qualifies", "watch the PR and fix real findings", "check readiness on the latest commit", "hand off the ready PR or merge it"], "output": "a pull request that is ready on its latest commit, left open in stop mode or merged in send mode, with a final report", "verification": "the report names the mode, the pull request link, the latest commit, the verdict, and whether the pull request is open or merged"}, "dx-optimizer": {"phases": ["finish the smallest change"], "output": "the smallest change that reaches the goal of the request, on its own branch", "verification": "the diff fixes the case that happened and holds nothing the goal does not need"}, "test-engineer": {"phases": ["prove every change"], "output": "proof observed in this session for every change in the diff", "verification": "each change maps to command output, a reproduction, or a screenshot from this session"}}, "output": "stop mode: an open, unmerged pull request that is ready for a person to merge; send mode: a merged pull request; both with proof, the review result, and each decision made for the user", "validation": "on the latest commit: proof covers the whole diff, dirf review ready review.json passes, required checks passed, review bots finished, no review conversation is open, no person requests changes, and the branch is current and mergeable", "recovery": "if a change cannot be proved or readiness cannot pass, ask through the host's question tool; with no answer, leave the pull request open and unmerged and start the final message with the question"}, "questions": [], "skill_flow": {"label": "finish, prove, file, review, watch, then stop or merge", "steps": [{"stage": "own", "reason": "Confirm the mode and what the request permits. Own the work to a ready pull request.", "capability": "unattended delivery"}, {"stage": "fix", "reason": "Finish the goal with the smallest change that works.", "capability": "minimalism"}, {"stage": "verify", "reason": "Get direct proof for every change before the pull request opens.", "capability": "testing"}, {"stage": "file", "reason": "File the pull request and write the final report.", "capability": "contribution writeup"}, {"stage": "review", "reason": "Follow the Review Ladder on the latest commit of the pull request.", "capability": "code review"}, {"stage": "watch", "reason": "Watch the pull request and fix the real findings.", "capability": "readiness babysitting"}]}}

---

# pr-unattended

The user is not watching this thread. Read the
[unattended delivery skill](../../skills/unattended-delivery/README.md) before
the first phase. It holds the two modes, what the request permits, proof,
readiness, and how to ask a question that the user will see.

Full stop leaves the ready pull request open for a person to merge. Full send
also merges, and only when the user said "full send" and the project rules
let an agent merge into that base branch.
