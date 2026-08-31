---
name: pr-review
kind: playbook
order: 1
description: "Review a pull request at an exact head for provable bugs, regressions, security risks, and missing tests with confidence-scored findings."
uses: ["../../skills/code-review"]
details: []
inputs: ["task"]
outputs: ["workflow"]
capabilities: []
config: {"description":"Review a pull request at an exact head for provable bugs, regressions, security risks, and missing tests with confidence-scored findings.","keywords":["pr","pull request","review","diff","merge","code review"],"agents":["agent-organizer","test-engineer","security-auditor","performance-benchmarker"],"workflow":{"phases":["freeze exact base and head","walk through changed behavior","review security and trust-boundary risks","review performance and regression risks","disprove and verify candidate findings","validate and grade the review artifact","fix every P0-P3 finding","verify corrected behavior","re-review the new exact head","recheck head and deduplicate before posting"],"agent_contracts":{"agent-organizer":{"phases":["freeze exact base and head","validate and grade the review artifact","fix every P0-P3 finding","re-review the new exact head","recheck head and deduplicate before posting"],"output":"a validated, graded, deduplicated review plus explicit ownership for every required correction","verification":"the recorded base and head still match, review.json validates, every P0-P3 correction is verified, every count is zero, and the latest verdict is PASS before completion"},"test-engineer":{"phases":["walk through changed behavior","disprove and verify candidate findings","verify corrected behavior"],"output":"behavior traces and focused evidence for every retained finding and fix","verification":"each retained finding is reproduced, corrected, and proved by the narrowest applicable check"},"security-auditor":{"phases":["review security and trust-boundary risks"],"output":"applicable security findings or an explicit security all-clear","verification":"changed trust boundaries, authorization, secrets, injection, and fail-open behavior were checked"},"performance-benchmarker":{"phases":["review performance and regression risks"],"output":"applicable performance and regression findings or an explicit all-clear","verification":"changed hot paths and regression-sensitive behavior were checked with proportionate evidence"}},"output":"P0-P3 counts, A-F grade, confidence-scored findings, and one PASS, CONDITIONAL, or FAIL gate","validation":"validate review.json; verify every fix and affected behavior; require a latest-head PASS with P0 0, P1 0, P2 0, and P3 0","recovery":"if no PR or diff is available, ask for the branch, commit range, diff, or PR URL; if verification is blocked or any P0-P3 finding remains, report not done and the exact next fix"},"questions":["What branch, commit range, diff, or PR should be reviewed?","What issue, specification, or expected behavior defines correctness?"],"skill_flow":{"label":"review, fix, and re-review a pull request","steps":[{"stage":"review","reason":"Freeze the exact target and review standards, specification, behavior, and regressions independently.","capability":"code review"},{"stage":"security","reason":"Check applicable trust boundaries, secrets, injection, authorization, and fail-open behavior.","capability":"security review"},{"stage":"fix","reason":"Resolve every validated P0-P3 finding and preserve the evidence for each correction.","capability":"implementation"},{"stage":"verify","reason":"Exercise the narrowest checks that prove each correction functions.","capability":"testing"},{"stage":"review","reason":"Review the new exact head and repeat until all P0-P3 counts are zero.","capability":"code review"}]}}
---

# pr-review

Review one immutable pull request head for provable bugs, regressions, security risks, and missing tests.

Follow the ordered phases and capability requirements declared above. Keep
working notes internal, but publish or link the validated rendered ledger. Always
show the A-F grade, quality and evidence confidence, explicit P0, P1, P2, and P3
counts, and each retained finding's priority and confidence. Tell the user what
was fixed, what checks passed, and whether another review is running. Do not
expose terms such as fixed-point, remediation cycle, gate, or exact-head unless
the user asks for technical detail. Definition of done requires every P0-P3
finding to be fixed, the affected behavior to function under verification, and
the latest head to be re-reviewed with zero findings. Only then ask for merge
approval.
