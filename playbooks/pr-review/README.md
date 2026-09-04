---
name: pr-review
kind: playbook
order: 1
description: "Review a pull request, fix every confirmed issue, and repeat until the current commit is clear and all required checks pass."
uses: ["../../skills/code-review"]
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description":"Review a pull request, fix every confirmed issue, and repeat until the current commit is clear and all required checks pass.","keywords":["pr","pull request","review","diff","merge","code review"],"agents":["agent-organizer","test-engineer","security-auditor","performance-benchmarker"],"workflow":{"phases":["get the latest PR version","review the changed behavior","check security risks","check performance and regression risks","prove each suspected issue","fix every confirmed issue","test the fixes","review the updated PR again","confirm no issues or checks remain"],"gates":{"confirm no issues or checks remain":{"kind":"verify","verify":"dirf review ready review.json"}},"agent_contracts":{"agent-organizer":{"phases":["get the latest PR version","fix every confirmed issue","review the updated PR again","confirm no issues or checks remain"],"output":"a current review with clear ownership for every required correction","verification":"dirf review ready review.json passes before merge approval is requested"},"test-engineer":{"phases":["review the changed behavior","prove each suspected issue","test the fixes"],"output":"behavior traces and focused proof for every confirmed issue and fix","verification":"each confirmed issue is reproduced, corrected, and proved by the narrowest applicable check"},"security-auditor":{"phases":["check security risks"],"output":"applicable security issues or a clear statement that none were found","verification":"changed trust boundaries, authorization, secrets, injection, and fail-open behavior were checked"},"performance-benchmarker":{"phases":["check performance and regression risks"],"output":"applicable performance or regression issues, or a clear statement that none were found","verification":"changed hot paths and regression-sensitive behavior were checked with proportionate proof"}},"output":"a plain-language status and a detailed review report; merge approval is requested only after the current commit has no remaining issues and every required check passes","validation":"dirf review ready review.json","recovery":"if the PR is unavailable, ask for its URL or branch; if an issue remains or a check is incomplete, say what remains and continue the fix, test, and review loop"},"questions":["What branch, commit range, diff, or PR should be reviewed?","What issue, specification, or expected behavior defines correctness?"],"skill_flow":{"label":"review, fix, test, and review again until clear","steps":[{"stage":"review","reason":"Get the current PR version and review its behavior and regressions.","capability":"code review"},{"stage":"security","reason":"Check relevant trust boundaries, secrets, injection, authorization, and fail-open behavior.","capability":"security review"},{"stage":"fix","reason":"Fix every confirmed issue without expanding the task.","capability":"implementation"},{"stage":"verify","reason":"Run the smallest checks that prove each fix and all required PR checks.","capability":"testing"},{"stage":"review","reason":"Review the updated PR and repeat until no confirmed issue remains.","capability":"code review"}]}}
---

# pr-review

Review the current pull request, fix every confirmed issue, and review it again.

Keep the detailed grade, confidence, and priority data in `review.json` and its
rendered report. Normal updates use ordinary language: how many issues remain,
what was fixed, what passed, whether another review is running, and what happens
next. Run `dirf review ready review.json` before asking to merge. That command
must confirm the report covers the current commit, no issues remain, the review
is complete, required checks passed, and no review conversations remain open.
