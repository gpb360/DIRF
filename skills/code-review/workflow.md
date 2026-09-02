# Review workflow

## 1. Get the current PR version

Resolve the canonical repository and target before analysis. Prefer immutable SHAs over branch names. Capture:

- repository and PR identifier when available;
- merge base or requested base SHA;
- exact head SHA;
- full or incremental mode;
- issue, specification, PR body, and repository instructions;
- existing review comments and the latest DIRF review marker.

Stop and refresh if the commit changes before publication.

## 2. Build the walkthrough

Read the three-dot diff and group files by behavior, not extension. For each group state what changed, which contract it touches, and the downstream consumers. Include generated files only when their generated output can alter runtime behavior.

The walkthrough is complete when every changed file belongs to a named subsystem or is explicitly classified as mechanical.

## 3. Inspect by risk

Start with the highest-risk boundary in the change. Follow changed values through callers, storage, retries, authorization, and rendering. Read enough unchanged code to prove the contract. Apply path-specific instructions from repository guidance and use the axes in `review-axes.md`.

Prefer one strong finding over several symptoms with the same root cause. Use the source-of-truth boundary as the comment location when practical.

## 4. Verify claims

For a candidate finding, attempt to disprove it. Use static tracing, focused tests, a minimal reproduction, database assertions, or browser evidence. Record the exact evidence. If the failure cannot be reached from supported inputs or state, suppress the finding.

Verification is complete when each published comment has a reproducible failure path and each clean axis has enough evidence to justify its status.

## 5. Fix, test, and review again

If the validated artifact contains any P0-P3 finding, fix every finding, run the narrowest checks that prove the corrected behavior, refresh the exact head, and start a new full or justified incremental review. Do not mark the workflow done because comments were resolved or a build is green.

The loop is complete only when the current review has no findings and the
corrected behavior works under the applicable checks.

## 6. Publish once

Create the structured artifact described in `findings-contract.md`. Validate and render it with the bundled script. Re-check the remote head and existing markers immediately before posting. Publish inline comments first, then one concise summary containing the walkthrough, verification, limitations, verdict, and marker.

The publication is complete when there is one review for the current commit and
every inline finding also appears in the detailed report. Publication does not
complete the workflow while any finding remains. Record `completion` in
`review.json`, then run `dirf review ready review.json` before asking to merge.
