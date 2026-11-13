---
name: unattended-delivery
kind: skill
description: "Use when the user says \"full stop\" or \"full send\", or says that nobody watches the thread: take a change to a ready pull request alone, with proof, review, and safe stops"
uses: []
details: []
inputs: ["requested change","mode: full stop or full send"]
outputs: ["ready pull request and final report","merged pull request in send mode"]
capabilities: ["unattended delivery"]
---

# Unattended delivery

The user is not watching this thread. Updates and the final message stay
unread until long after the work stops. You own the work from its current
state to a ready pull request.

Use this skill only when the user asked for it in clear words, such as
"full stop", "full send", or "I am not watching". Without that request, do
not assume this autonomy. A "full stop" that only stresses another sentence,
or that names the punctuation mark, is not this request. In that case this
skill does not apply.

## Two modes

- **Full stop** is the default. Stop when the pull request is ready. A person
  merges it.
- **Full send** also merges. It applies only when the user said "full send"
  for this task and the project rules let an agent merge into that base
  branch. The "full send" request is the answer to the merge question that
  the workflow policy asks.

In both modes you may commit, push, rebase, fix conflicts, and update the
branch of this task. Push a rebased branch with a lease tied to the head you recorded before the
rebase: `git push --force-with-lease=<branch>:<recorded-commit>`. When the
lease fails, someone else pushed. Fetch, keep their commits, and push again.
Never use a plain force push or a bare `--force-with-lease`.

In stop mode, never merge, enable auto-merge, enter a merge queue, or push to
the base branch. When a person already set auto-merge or a merge queue on
the pull request, leave it as it is and report it. Their setting is their
decision to merge.

## What the request permits

The request permits the test methods that proof needs: browser automation, a
running app or development server, simulators, screenshots, and visual
checks.

- Project rules about testing still apply, including a rule to ask first.
  When a project rule says to ask, ask through the question tool. See
  "Questions".
- Use the command, fixture, or check the project names.
- The permission covers only the tests this task needs.
- It does not cover production changes, data deletion, or work outside the
  repository.
- It does not bypass an approval prompt of the host.

## Steps

1. **Finish the change.** Reach the goal of the request with the smallest
   change that works. Fix the case that happened, not every case that could.
   Create a branch first when you are on the base branch.
2. **Prove it.** Get proof for every change. See "Proof".
3. **File the pull request** with the `pr-communication` skill. Rebase onto
   the latest base branch first.
4. **Review it.** Follow the Review Ladder of the workflow policy with the
   `code-review` skill, on the latest commit of the pull request. Prefer a
   reviewer on a different model than the author when the host can run one.
   When the ladder stops for a person, readiness cannot pass. Ask, and with no
   answer leave the pull request open and unmerged.
5. **Watch it** with the `pr-watching` skill. Fix real findings and failed
   checks. Prove each fix before the push.
6. **Check readiness** on the latest commit. See "Readiness".
7. **Stop or merge**, as the mode states. Then report.

Stay active from step 1 to step 7. When you end a turn while checks or bots
are pending, the work stops, because nobody will prompt you. Wait with the
watcher from `pr-watching` so that an event wakes you.

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
- The review covers this commit: `dirf review ready review.json` passes.
  A commit pushed to answer a CI or bot finding gets one reviewer pass on
  that commit, the same as step 1 of the ladder. That pass counts toward the
  Loop Limit. It does not start the ladder again.
- Required checks passed. When the base branch requires none, every check
  passed.
- Review bots finished. Each finding has a fix, and each other item has a
  written reason.
- No review conversation is open, and no person requests changes.
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
- The Loop Limit of the workflow policy is reached.
- The next step is outside what the request permits.
- The goal is unclear in a way that changes the result.
- Another pull request makes this one obsolete.

A decision gate still needs the person. When the work reaches one before the
pull request is ready, ask through the question tool. The readiness check,
here and in `pr-watching`, is not a decision gate. The decision gate on the
last phase records that the person accepted the result. It does not delay
the report, or the merge in send mode.

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
