# Shorter assignments: offline experiment

This experiment is not enabled in DIRF. It tests one proposed plain-English
rewrite of the generated README's startup paragraph. It does not install
Caveman, change the renderer, shorten a user's task, or rewrite canonical state.

## Hypothesis and comparison

Remove redundant startup prose while keeping every task-specific byte unchanged.
The baseline is the actual `buildInstructions()` output from `src/renderer.js`.
The six declared fixtures cover email/site scope, an ambiguous objective,
negation and exceptions, human approval, exact technical text, and execution
receipts with Unicode. They are synthetic checks, not a representative routing
corpus or evidence that a model executed a skill.

The candidate changes only this exact, uniquely located paragraph under
`## Next step`:

> Open the target repository in your current host. Load this README.md as the operating workflow and execute the task.
> Follow the phases in order, act as one role at a time, and load only that role's detail. Read policy.md before editing. State an access blocker instead of guessing about unavailable files.

To:

> Open the target repository. Follow this README.md's phases in order, one role at a time. Load only that role's detail. Read policy.md before editing. Report unavailable files; do not guess.

Both instruct the reader to open the target, follow the README's ordered phases,
act in one role, load only that role's detail, read policy before edits, and report
missing access rather than guessing. That equivalence is a human assessment of
these two fixed paragraphs, not an automated semantic guarantee.

## Reproduce

```sh
node scripts/assignment-experiment.js --summary
node --test tests/assignment-experiment.test.js
npm run check:release
```

Without `--summary`, the report includes both complete assignments and their
SHA-256 hashes for inspection or restoration. It reports UTF-8 bytes, not
token estimates. Candidate size includes every candidate instruction; there
is no hidden extra prompt. Linked policy, kickoff and detail files stay unchanged
and are included in the generated-pack accounting, even though a host may load
only some of them. The script creates and removes only its own unique scratch
directory inside the checkout. It makes no model, provider or state calls.

The checker rejects edits anywhere outside the fixed paragraph, missing declared
constraints, and empty constraint declarations. Unknown or ambiguous layouts
remain unchanged and earn no size benefit. Negative controls reverse negation,
remove the objective or approval, change an exact command or phase, and replace
an execution receipt with selected metadata. A copied original phrase elsewhere
does not conceal a changed instruction. These controls test the checker's
ability to reject bad candidates; they do not test agent behavior.

## Observed result

Baseline: unchanged DIRF v0.31.0 renderer at `dbc177796cb1f5204058617abb5f6630382967b4`.
Measured locally on 2026-09-30:

| Fixture | Baseline README bytes | Candidate README bytes | Saved |
|---|---:|---:|---:|
| Email preview | 3,559 | 3,443 | 116 |
| Ambiguous objective | 3,665 | 3,549 | 116 |
| Negation and exception | 3,615 | 3,499 | 116 |
| Human approval | 3,826 | 3,710 | 116 |
| Exact technical text | 3,771 | 3,655 | 116 |
| Execution receipts and Unicode | 3,764 | 3,648 | 116 |
| Total | 22,200 | 21,504 | 696 |

All six candidates passed the declared preservation checks. README size fell
3.14% in aggregate. Across the entire generated packs the same saving is only
696 / 119,620 bytes, or 0.58%. Seven focused tests passed. The TDD trail included
actual assertion failures for no size reduction, a reversed restriction accepted
by a permissive checker, and an empty experiment report; each subsequently passed.
The full `npm run check:release` passed: 618 tests passed, 0 failed, 2 skipped;
registry validation, syntax, incremental type checking, CLI smoke, and repository
and package publication checks passed. The skips are not counted as passed.

## What this proves and what it does not

It proves a small text-size reduction and exact preservation outside one
reviewed paragraph on these fixtures. The deliberately defective candidates
were rejected. It does not prove faster execution, lower billing, model
comprehension, routing accuracy, or improved end-to-end task outcomes. No agent
or paid model benchmark ran. Do not extrapolate six preservation cases to a
98% routing claim.

The useful lesson from [Caveman's measurement notes](https://github.com/juliusbrussee/caveman/blob/2fd153c67988e980fb0b2455c90832159a6a5a25/docs/HONEST-NUMBERS.md)
is to separate size from quality and cost. The current measured benefit is
modest. Keep this as an experiment until the user accepts the result; do not
change defaults or publish a release on this result alone. Any host-run paired
evaluation needs separate scope, actual execution receipts, and independent
outcome scoring. If a candidate changes a protected byte or is not smaller,
discard it and retain the original.
