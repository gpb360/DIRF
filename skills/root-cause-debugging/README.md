---
name: root-cause-debugging
kind: skill
description: "Reproduce, isolate, and fix the source of a defect rather than its symptom"
uses: []
details: []
inputs: ["failure report"]
outputs: ["reproduction, cause, and verified fix"]
capabilities: ["root cause debugging"]
---

# Root cause debugging

First reproduce the failure with an exact command or path. Bisect the surface area until one cause remains, and state why it explains every symptom. Patch the smallest shared source of the defect, then re-run the reproduction to prove it is gone.

When an attempted fix or check is blocked, diagnose the specific blocker before changing anything: a wrong configuration, a stale session, and a missing dependency have different remedies, and repeating the same blocked action for all of them wastes work and can make things worse. Do not retry an identical failing action without a changed input or a resolved blocker.
