---
name: pr-unattended
kind: playbook
order: 20
description: "Take a change to a ready pull request while nobody watches the thread: full stop leaves it for a person to merge, full send also merges."
uses: ["../../skills/pr-communication", "../../skills/code-review"]
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description": "Take a change to a ready pull request while nobody watches the thread: full stop leaves it for a person to merge, full send also merges.", "keywords": ["full stop", "full send", "unattended", "not watching"], "agents": ["agent-organizer", "dx-optimizer", "test-engineer"], "workflow": {"phases": ["confirm the unattended request and its mode", "finish the smallest change", "prove every change", "review the change until it qualifies", "file the PR", "watch the PR and fix real findings", "check readiness on the latest commit", "hand off the ready PR or merge it"], "gates": {"prove every change": {"kind": "soft"}, "check readiness on the latest commit": {"kind": "soft"}}, "agent_contracts": {"agent-organizer": {"phases": ["confirm the unattended request and its mode", "review the change until it qualifies", "file the PR", "watch the PR and fix real findings", "check readiness on the latest commit", "hand off the ready PR or merge it"], "output": "a pull request that is ready on its latest commit, left open in stop mode or merged in send mode, with a final report", "verification": "the report names the mode, the pull request link, the latest commit, the verdict, and whether the pull request is open or merged"}, "dx-optimizer": {"phases": ["finish the smallest change"], "output": "the smallest change that reaches the goal of the request, on its own branch", "verification": "the diff fixes the case that happened and holds nothing the goal does not need"}, "test-engineer": {"phases": ["prove every change"], "output": "proof observed in this session for every change in the diff", "verification": "each change maps to command output, a reproduction, or a screenshot from this session"}}, "output": "stop mode: an open, unmerged pull request that is ready for a person to merge; send mode: a merged pull request; both with proof, the review result, and each decision made for the user", "validation": "on the latest commit: proof covers the whole diff, required checks passed, review bots finished with each finding fixed or declined in writing, no person requests changes, and the branch is current and mergeable", "recovery": "if a change cannot be proved or readiness cannot pass, ask through the host's question tool; with no answer, leave the pull request open and unmerged and start the final message with the question"}, "questions": ["What change should be taken to a pull request?", "Is this full stop, where a person merges, or full send, where the agent merges?"], "skill_flow": {"label": "finish, prove, review, file, watch, then stop or merge", "steps": [{"stage": "fix", "reason": "Finish the goal with the smallest change that works.", "capability": "minimalism"}, {"stage": "verify", "reason": "Get direct proof for every change before any review.", "capability": "testing"}, {"stage": "review", "reason": "Follow the Review Ladder before the pull request opens.", "capability": "code review"}, {"stage": "report", "reason": "File the pull request and write the final report.", "capability": "pull request communication"}]}}

---

# pr-unattended

The user is not watching this thread. Updates and the final message stay
unread until long after the work stops. You own the work from its current
state to a ready pull request.

Use this playbook only when the user asked for it in clear words, such as
"full stop", "full send", or "I am not watching". Without that request, do
not assume this autonomy.

## Two modes

- **Full stop** is the default. Stop when the pull request is ready. A person
  merges it.
- **Full send** also merges. It applies only when the user said "full send"
  for this task and the project rules let an agent merge into that base
  branch.

In both modes you may commit, push, rebase, fix conflicts, and update the
branch of this task with `git push --force-with-lease`.

In stop mode, never merge, enable auto-merge, enter a merge queue, or push to
the base branch. Turn off auto-merge that is already on, and report that you
did. If you cannot prevent an automatic merge, report that before you
continue.

## What the request permits

The request permits the test methods that proof needs, even when a project
file says to ask first. That covers browser automation, a running app or
development server, simulators, screenshots, and visual checks.

- Rules about how to test still apply. Use the command, fixture, or check the
  project names.
- The permission covers only the tests this task needs.
- It does not cover production changes, data deletion, or work outside the
  repository.
- It does not bypass an approval prompt of the host.

## Steps

1. **Finish the change.** Reach the goal of the request with the smallest
   change that works. Fix the case that happened, not every case that could.
   Create a branch first when you are on the base branch.
2. **Prove it.** Get proof for every change. See "Proof".
3. **Review it.** Follow the Review Ladder in the `pr-review` playbook before
   the pull request opens. Prefer a reviewer on a different model than the
   author when the host can run one.
4. **File the pull request** with the `pr-communication` skill. Rebase onto
   the latest base branch first.
5. **Watch it** with the `pr-watch` playbook. Fix real findings and failed
   checks. Prove each fix before the push.
6. **Check readiness** on the latest commit. See "Readiness".
7. **Stop or merge**, as the mode states. Then report.

Stay active from step 1 to step 7. When you end a turn while checks or bots
are pending, the work stops, because nobody will prompt you. Wait with the
watcher from `pr-watch` so that an event wakes you.

## Proof

Proof is evidence you observed in this session: command output, a
reproduction, or a screenshot. Use the most direct proof the change allows.

- Reproduce the original failure. Apply the fix. Watch the same reproduction
  pass.
- Run the checks that CI runs.
- Add one focused test that fails without the fix, when the behavior has no
  test and the repository has a test setup.
- For interface and runtime behavior, run the app and look at the change.
  Green mocked tests do not prove that the experience works.

When you cannot find a way to prove a change, you do not have full
confidence. Ask the user.

## Readiness

All of these are true on the latest commit:

- Proof covers every change in the diff.
- Required checks passed.
- Review bots finished, and each finding is fixed or declined with a written
  reason.
- No person requests changes.
- The branch is current with its base, and GitHub reports it mergeable.

In send mode, merge with the method the repository uses. Merge through branch
protection as configured. Never use an administrator bypass. When the
repository uses a merge queue, stay until GitHub reports the merge.

## Questions

A question in a normal message stays unseen, and the thread looks finished.
Ask through the question tool of the host, so the thread shows that it waits.
Put all context in the question: the pull request link, what blocks you, and
the options with your recommendation first.

Ask only when you cannot continue alone:

- You cannot prove the change.
- Readiness cannot pass, and you cannot fix that.
- The next step is outside what the request permits.
- The goal is unclear in a way that changes the result.
- Another pull request makes this one obsolete.

An unattended request does not accept a DIRF decision gate for the person.
Decide everything else yourself with sensible defaults, and list those
decisions in the report.

When no question tool exists, or it returns no answer, take the safe path.
Leave the pull request open and unmerged. Start the final message with the
question.

## Report

Stop the watch first. Then report:

- the mode and the pull request link;
- the latest commit and the verdict: ready to merge, waiting for a required
  approval, blocked, or merged with the merge commit;
- the proof and the review result;
- each decision you made for the user;
- the risks that remain;
- whether the pull request is open and unmerged.
