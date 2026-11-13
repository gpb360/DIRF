---
name: work-takeover
kind: skill
description: "Finish another author's pull request, branch, or agent thread: check the handoff against the code, keep the original credit, and reach the same goal"
uses: []
details: []
inputs: ["source pull request, branch, or thread"]
outputs: ["finished work with original credit","report of what was inherited and changed"]
capabilities: ["work takeover"]
---

# Work takeover

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

Bring the continuation branch up to date with the `pr-modernization` skill. Rework what the
original goal needs, and nothing else. Simplify the implementation, and keep
every intended behavior and surface. Check the source pull request again
before you finish. It can change while you work.

## Verify

Reproduce the original failure yourself. Then exercise the real workflows.
Green mocked tests do not prove that the experience works. State what remains
unverified.

## File and report

When the requested result includes a pull request, file or update it with the
`pr-communication` skill. Then watch it with the `pr-watching` skill. Do not
stop at creation.

Report what you inherited, what you changed, how you verified it, how the
credit was kept, and each decision that remains.
