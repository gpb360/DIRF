---
name: pr-watch
kind: playbook
order: 17
description: "Watch an open pull request through checks and review bots, fix the real findings, and stop when it is ready."
uses: ["../../skills/pr-watching","../../skills/pr-communication"]
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description": "Watch an open pull request through checks and review bots, fix the real findings, and stop when it is ready.", "keywords": ["babysit", "babysit pr", "watch pr", "watch the pr", "monitor pr", "monitor the pr", "watch pull request", "until the checks", "checks are green", "review bots", "watch this pr", "babysit this pr", "watch my pr", "watch this pull request", "babysit this pull request"], "agents": ["agent-organizer", "test-engineer", "error-coordinator"], "workflow": {"phases": ["record the PR and its latest commit", "handle the checks and comments that already exist", "wait for the next PR event", "check each new finding against the code", "fix real findings and answer the rest", "keep the branch current with its base", "confirm the PR is ready on the latest commit"], "gates": {"confirm the PR is ready on the latest commit": {"kind": "decision"}}, "agent_contracts": {"agent-organizer": {"phases": ["record the PR and its latest commit", "handle the checks and comments that already exist", "wait for the next PR event", "keep the branch current with its base", "confirm the PR is ready on the latest commit"], "output": "one watcher for the PR, a current branch, and a plain ready, waiting, or blocked status for the latest commit", "verification": "the status names the latest commit, every required check, every open review conversation, and whether the branch is behind its base"}, "test-engineer": {"phases": ["check each new finding against the code"], "output": "each finding and failed check marked real, not real, or infrastructure fault, with evidence", "verification": "every verdict cites the code, a reproduction, or the check output for the latest commit"}, "error-coordinator": {"phases": ["fix real findings and answer the rest"], "output": "the smallest fix for each real finding and a written reason for each item that is not a finding", "verification": "each fix has proof from this session and each written reason is posted as a reply"}}, "output": "a pull request that is green and ready on its latest commit, or a plain statement of what blocks it; a merge happens only when the user asked for it", "validation": "required checks pass on the latest commit, review bots finished, no review conversation is open, and the branch is not behind its base", "recovery": "if the watcher stops or GitHub is unreachable, check the rate limit and start one watcher again; if another pull request makes this one obsolete, stop and ask before closing it"}, "questions": ["Which pull request should be watched?", "May the pull request be merged when it is ready, or does a person merge it?"], "skill_flow": {"label": "watch, verify each finding, fix what is real, stop when ready", "steps": [{"stage": "watch", "reason": "Use one watcher. Act only on checks and comments that are newer than the latest push.", "capability": "readiness babysitting"}, {"stage": "verify", "reason": "Check every bot finding and failed check against the code before any change.", "capability": "code review"}, {"stage": "fix", "reason": "Fix real findings with the smallest change. Answer the rest in writing.", "capability": "minimalism"}, {"stage": "verify", "reason": "Prove each fix before the push.", "capability": "testing"}, {"stage": "report", "reason": "Reply to each finding and report the result in plain language.", "capability": "contribution writeup"}]}}

---

# pr-watch

Watch one open pull request until it is ready. Read the
[pull request watching skill](../../skills/pr-watching/README.md) before the
first phase. It holds the watcher, findings, base-branch, and readiness rules.

Merge only when the user asked for a merge. Otherwise report that the pull
request is ready.
