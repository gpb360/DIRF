---
name: pr-review
kind: playbook
order: 1
description: "Review a pull request at an exact head for provable bugs, regressions, security risks, and missing tests with confidence-scored findings."
uses: []
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description":"Review a pull request at an exact head for provable bugs, regressions, security risks, and missing tests with confidence-scored findings.","keywords":["pr","pull request","review","diff","merge","code review"],"agents":["agent-organizer","test-engineer","security-auditor","performance-benchmarker"],"workflow":{"phases":["freeze exact base and head","walk through changed behavior","review applicable risk axes","disprove and verify candidate findings","validate the review artifact","recheck head and deduplicate before posting"],"output":"confidence-scored inline findings plus one PASS, CONDITIONAL, or FAIL gate","validation":"validate review.json and use focused tests, static checks, database proof, or browser evidence as applicable","recovery":"if no PR or diff is available, ask for the branch, commit range, diff, or PR URL; if verification is blocked, emit CONDITIONAL with the exact limitation"},"questions":["What branch, commit range, diff, or PR should be reviewed?","What issue, specification, or expected behavior defines correctness?"],"skill_flow":{"label":"review a pull request","steps":[{"stage":"review","reason":"Freeze the exact target and review standards, specification, behavior, and regressions independently.","capability":"code review"},{"stage":"security","reason":"Check applicable trust boundaries, secrets, injection, authorization, and fail-open behavior.","capability":"security review"},{"stage":"verify","reason":"Exercise the narrowest checks that prove or disprove each material claim.","capability":"testing"}]}}
---

# pr-review

Review one immutable pull request head for provable bugs, regressions, security risks, and missing tests.

Follow the ordered phases and capability requirements declared above. Keep the
structured review details internal. Tell the user, in plain English, how many
issues remain, what was fixed, what checks passed, and whether another review is
running. Do not expose terms such as fixed-point, remediation cycle, gate, or
exact-head unless the user asks for technical detail. Only ask for merge approval
after the latest commit has been reviewed and no actionable findings remain.
