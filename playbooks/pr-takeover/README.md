---
name: pr-takeover
kind: playbook
order: 19
description: "Finish another author's pull request, branch, or agent thread and keep the original credit."
uses: ["../../skills/pr-communication"]
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description": "Finish another author's pull request, branch, or agent thread and keep the original credit.", "keywords": ["take over", "takeover", "taking over", "take over pr", "take over this pr", "take over this branch", "finish this pr", "inherit this pr"], "agents": ["agent-organizer", "dx-optimizer", "test-engineer"], "workflow": {"phases": ["read the source work and its review history", "resolve the handoff to the real code and latest commit", "choose replacement, in-place, or stacked continuation", "bring the work up to date with its base", "finish the original goal", "verify the original failure and the real workflows", "file or update the PR with credit", "report what was inherited, changed, and verified"], "gates": {"choose replacement, in-place, or stacked continuation": {"kind": "soft"}, "report what was inherited, changed, and verified": {"kind": "decision"}}, "agent_contracts": {"agent-organizer": {"phases": ["read the source work and its review history", "resolve the handoff to the real code and latest commit", "choose replacement, in-place, or stacked continuation", "file or update the PR with credit", "report what was inherited, changed, and verified"], "output": "the original goal, the real state of the inherited code, the continuation form, and a pull request that credits the original contributors", "verification": "the recorded state matches the live branch and latest commit, uncommitted work is accounted for, and Git authorship and co-author trailers are intact"}, "dx-optimizer": {"phases": ["bring the work up to date with its base", "finish the original goal"], "output": "current work that reaches the original goal, with the new fixes in separate commits", "verification": "the changes serve the original goal only, and no intended behavior or surface was dropped"}, "test-engineer": {"phases": ["verify the original failure and the real workflows"], "output": "proof from this session that the original failure is fixed and the real workflows work", "verification": "the proof exercises real behavior, not only mocked tests, and names what remains unverified"}}, "output": "a finished pull request that keeps the original credit, with a report of what was inherited, what changed, how it was verified, and what a person must still decide", "validation": "the original failure is reproduced and then fixed in this session, and git log shows the original authors on their commits", "recovery": "if the source work is unavailable, ask for its link or branch; if the handoff and the code disagree, trust the code and report the difference; if another session is active on the same checkout, stop for the person"}, "questions": ["Which pull request, branch, or thread should be taken over?", "Should the work continue in a replacement pull request, in place, or stacked on the original?"], "skill_flow": {"label": "inherit, check against the code, finish the same goal, keep the credit", "steps": [{"stage": "understand", "reason": "Read the source work and check the handoff against the code.", "capability": "code review"}, {"stage": "fix", "reason": "Rework only what the original goal needs.", "capability": "minimalism"}, {"stage": "verify", "reason": "Prove the original failure is fixed in real workflows.", "capability": "testing"}, {"stage": "report", "reason": "File the pull request with credit and report the inherited state.", "capability": "pull request communication"}]}}

---

# pr-takeover

Take responsibility for the original goal. Keep the credit of the people who
started the work. Do not defend an implementation only because another agent
built it.

## Task ownership comes first

A takeover of code is not a takeover of a DIRF task. When the source work is a
DIRF task, continue that task with `dirf resume <id>`. Give an explicit reason
when a new session takes it. When another session is active on the same
checkout, DIRF reports a conflict. Stop and ask the person.

## Read and resolve

1. Read the source pull request, branch, or thread. Include the review
   findings and the user's later corrections.
2. Find the real code and its latest commit. Account for uncommitted work.
3. Treat the handoff as context, not as proof. When the handoff and the code
   disagree, trust the code and report the difference.

## Choose the continuation

- **Replacement** is the default. Import the original commits onto a new
  branch. Add your fixes as separate commits.
- **In place** or **stacked** applies only when the user asked for it.

Do not overwrite unrelated work. Do not change, merge, or close the original
pull request without permission.

## Keep the credit

- Keep Git authorship and the existing co-author trailers.
- Name the original contributors in the description and link the original
  pull request.
- When the work will be squashed, keep the human authors in the merge commit.
  Use verified identities. Never guess an email address.
- A model attribution line does not replace contributor credit.

## Finish the same goal

Bring the continuation branch up to date with the `pr-modernize` playbook. Rework what the
original goal needs, and nothing else. Simplify the implementation, and keep
every intended behavior and surface. Check the source pull request again
before you finish. It can change while you work.

## Verify

Reproduce the original failure yourself. Then exercise the real workflows.
Green mocked tests do not prove that the experience works. State what remains
unverified.

## File and report

When the requested result includes a pull request, file or update it with the
`pr-communication` skill. Then continue with the `pr-watch` playbook. Do not
stop at creation.

Report what you inherited, what you changed, how you verified it, how the
credit was kept, and each decision that remains.
