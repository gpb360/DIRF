# Methodology learning loop

Use this loop to learn from a video, transcript, article, talk, demo, repository,
or another team's method. The goal is retained understanding and the smallest
justified improvement—not a summary and not automatic imitation.

## 1. Freeze the source

Record the source reference, known metadata, provenance and limitations, and one
learning question. Another run must be able to identify the same source and
question without guessing.

## 2. Consume once for structure

Review the complete available source once. Capture its thesis, sequence,
definitions, examples, and claimed outcomes before comparing it to the target.

## 3. Replay load-bearing passages

Return only to passages that define the method, support a material claim, expose
an assumption, or remain unclear. Cite timestamps for audio/video and stable
passages for text. Label uncertainty instead of repairing it by intuition.

## 4. Reconstruct before judging

Build the strongest faithful version: problem, preconditions, actions, feedback
loops, human decisions, outputs, evidence, costs, risks, and failure conditions.

## 5. Compare with the live target

Inspect current code, policies, tests, and relevant history. Mark each idea
`already-present`, `different`, `missing`, `conflicting`, or `unverified`.
Prefer live behavior over stale documentation.

## 6. Challenge and ask

Test assumptions, evidence, fit, complexity, maintenance, counterexamples, and
unanswered questions. Ask only questions that can change the disposition or
experiment.

## 7. Decide without cargo culting

Give every material idea one disposition:

| Disposition | Meaning |
|---|---|
| `adopt` | Use essentially as presented because evidence and fit are strong. |
| `adapt` | Preserve the principle through the target's existing architecture. |
| `experiment` | Run one reversible test because evidence or fit is uncertain. |
| `reject` | Cost, conflict, or weak evidence outweighs expected value. |
| `defer` | A prerequisite or decision is missing. |

Select at most one experiment. Record the recommendation as a `research`
artifact and stop until both the artifact and decision gate are accepted.

## 8. Run the smallest approved experiment

Before editing, record the hypothesis, smallest affected surface, expected
improvement, verification check, rollback condition, and non-goals. Approval
does not authorize unrelated cleanup, publishing, deployment, provider spend,
or production mutation.

## 9. Verify and retain the learning

Compare the result with the hypothesis. Record what changed, verification
evidence, keep/revise/rollback/defer, the retained lesson, and new questions.

## Learning note shape

```markdown
# <Source> -> <Target> learning review

## Source record
## Learning question
## Faithful method map
## Load-bearing evidence
## Current-state comparison
## Assumptions, counterexamples, and questions
## Disposition table
## Approved experiment or no-change decision
## Verification result
## Retained lesson
```
