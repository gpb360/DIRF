# Workflow Policy

Use this policy in every generated workflow prompt.

## Folder Execution Contract
- Treat each skill, tool, playbook, or workflow folder as an isolated unit whose root `README.md` is its public interface.
- Follow declared folder references in order, load each unit once, and reject cycles.
- Load optional detail files only when their stage is active.
- Skills define bounded task behavior; tools define invocation only and cannot control workflows.
- Keep Markdown authoritative, HTML regenerable, and execution evidence tied to the resolved folder graph.

## Runtime Portability
- Operating instructions are host-neutral. The current host may be Claude, Codex, Cursor, Zcode, T3Code, another agent, or a person.
- Resolve repository, skill, and tool paths at runtime. Never persist absolute host paths as workflow identity.
- DIRF coordination state is canonical and central (~/.dirf/projects/<slug>/). Worktrees resolve to the same store entry automatically via git-common-dir, so no per-worktree setup is needed and state cannot drift between checkouts. Scratch isolation stays local to the current execution.
- Select scratch space inside the active workspace. Never silently fall back to another drive or the operating-system temp directory.
- Persist capability names and provider hints, not installation paths.

## Delegated Status
- The orchestrator is the only execution-registry writer for its Attempt; user-owned lifecycle and decision actions remain separate.
- The harness binds the execution authority token during trusted setup before children run and keeps it out of child environments; identity variables and a self-written transfer reason do not grant registry authority or abandonment rights.
- Every child assignment identifies the parent Attempt and requires the child to report its state, result, blocker, and handoff back to the orchestrator.
- Child agents do not call DIRF state commands. The orchestrator submits their reports as one bounded execution snapshot.
- A child is a separate Attempt only when it needs an independent lifecycle and handoff.

## Build Bias
- Start with the smallest useful workflow.
- Prefer standard library and native platform features.
- Do not add dependencies unless the task clearly needs them.
- Skip speculative scaffolding.
- If a shortcut has a ceiling, name the ceiling and the upgrade path.

## Scope Boundary
- The user's task defines what the workflow delivers. Repository instructions constrain how that work is performed; they do not add deliverables.
- Do not promote project process, planning, governance, approval, attestation, provenance, or release language into product scope unless the user explicitly requested it or it is the minimum control required for safety.
- When repository guidance conflicts with the requested outcome, preserve the necessary constraint, name the conflict, and continue the unblocked task instead of building new workflow machinery.


## Model Referential Integrity
- Before implementing or reviewing model-registry work, identify the authoritative requirement source, the exact registry model and intended capability, and the approved provider abstraction or contract.
- Required preflight: when a model- or provider-specific skill or contract exists, read and cite it before implementation, review, testing, or a merge-readiness claim.
- Reconcile the exact registry identifier, capability or type (for example, chat versus TTS), approved provider route, request payload, expected response or callback shape, pricing, and lifecycle status (active or retired).
- Never infer those facts from name similarity, legacy code, an old issue, or a fallback map. If authoritative sources conflict, stop and report the conflict instead of changing code or calling a PR ready.
- Act and validate only against that chain. Proof is valid only when it exercises the referenced contract.
- A different model, direct-provider path, request payload, response expectation, or inferred requirement is out of scope unless the authoritative source is explicitly amended.
- If the chain is missing or inconsistent, stop for clarification; do not substitute a model or expand the architecture.

## PR Merge Readiness
- Do not infer readiness from GitHub's mechanical mergeable or ready status, a green build, or a prior review.
- After every final push, refresh the exact PR head; collect all review comments, unresolved threads, and checks; reconcile every P0, P1, P2, and P3 finding; fix and verify each finding; then rerun the relevant checks and review the new head.
- Re-fetch that exact head's reviews, unresolved threads, checks, mergeability, and diff. Report "ready to merge" only when no unresolved review findings remain and all required gates pass.
- Dismiss a finding only when evidence shows it is invalid or a duplicate. A retained P0, P1, P2, or P3 finding cannot be waived for completion; fix and verify it, then review the new head. Otherwise report "not ready" and state the exact remaining action.

## Communication
- Write user-facing updates in simple, ordinary English. Keep internal workflow
  terms such as exact-head, fixed-point, remediation, gate, convergence, and
  evidence ledger out of the update unless the user asks for technical detail.
- Lead with the practical answer: what was found, what was fixed, what passed,
  what is still being checked, or whether the work is ready for approval.
- Prefer short sentences such as "I found 3 issues", "I fixed them and pushed
  the changes", "The tests passed", and "I am reviewing it again".
- Use concrete files, commands, diffs, tests, and errors as proof when useful,
  but translate what they mean instead of making the user decode the process.
- For pull requests, never say "ready to merge" while a review is still running
  or any serious review issue remains. When it is ready, ask one plain question:
  "All checks passed and no review issues remain. May I merge PR #N into staging?"
- In normal PR updates, say how many confirmed issues remain, what checks
  passed, whether another review is running, and what happens next.
- Keep grades, confidence scores, P-codes, and the detailed findings ledger in
  the review artifact. Show or link that detail when it helps, or when the user
  asks for it; do not make the user decode it in every status update.
- `Complete` requires a review of the current commit with no remaining issues,
  all required checks passed, all review conversations resolved, and proof that
  the corrected behavior works. Green checks alone are not completion.
- Separate code pushed, PR text posted, checks completed, and review completed.
  Never present one as proof of another.
- Include the PR number and current head when they matter. Link the published PR
  update when the user expects to see it on GitHub.
- Do not add AI attribution footers or generated-by boilerplate.
- Pull requests created during the workflow carry a description: what
  changed, why, and how it was verified — never a title-only PR.

## Final Prose Pass
- When the workflow includes a prose-editing capability, apply it once to
  human-facing output such as documentation, reports, pull-request text,
  handoffs, and interface copy.
- Remove filler, puffery, vague attribution, repeated ideas, generic
  conclusions, forced lists, synonym cycling, and formulaic framing.
- Prefer concrete actors, actions, evidence, and ordinary words. Preserve the
  intended meaning, audience, and tone.
- Do not invent evidence or polish an unverified claim into certainty. State
  the uncertainty plainly.
- Do not rewrite code, machine-readable data, commands, logs, citations,
  quotations, or verbatim source. Preserve required formats and contracts.
- Self-audit once before delivery.

## Side observations
- Park anything noticed that is NOT the current task (a side bug, a doc staleness, a "fix later") via `dirf notice "<note>"`. Default target: the current attempt.
- Never put side observations in HANDOFF.md — they are not status, decisions, or blockers.
- Do not act on a side observation in the current attempt. Log it and continue.
- Observations are ephemeral to the attempt. Promote one to the project-level list with `dirf notice promote <N>` only if it should survive across sessions.

## Local-First Issue Governance
- A finding is local execution evidence first, not automatically a GitHub issue. Validate it and fix it in the current branch when it is required for current acceptance.
- Classify each validated finding as `fix_now`, `duplicate`, `invalid`, `product_decision`, or `deferred_candidate`.
- DIRF defaults to local-only findings and does not select GitHub, a severity scale, an acceptance percentage, or an authorization scheme.
- Promote a `deferred_candidate` only when the target repository explicitly defines a tracker and promotion policy. Use that repository's existing review, identity, approval, and audit trail.
- If project policy allows promotion, search its live tracker and change history first. Consolidate under the existing canonical owner when one exists.
- On merge, follow project policy to reconcile referenced work. Do not keep a tracker item open by silently broadening its original contract.

## Workflow Audit
- Name the selected playbook.
- List selected agents and skipped obvious agents with reasons.
- State assumptions before edits.
- Report files read or changed when relevant.
- Include the verification command and result.
- Leave open risks or blockers explicit.

## Verification Contract
- Name each phase's verification command before work starts; a phase is done only with that command's output attached to the evidence.
- Do not assume a skill, tool, or integration is available unless the resolved workflow, registry, or this policy lists it.
- When a named verification cannot run, say so and mark the claim unverified rather than reporting success.

## Governance Boundary
- Agents advise, implement, review, and produce evidence; they do not grant their own execution authority.
- State-changing actions require a mandate, bounded scope, evidence, and named authority.
- Missing authority, conflicting scope, or under-specified risk means stop or require human approval.
- Keep credentials out of prompts, saved workflows, registry files, and agent Markdown.
- If a future gateway is present, route writes, deploys, merges, API calls, database mutations, and external messages through it.

## Decision Ownership
- Draft freely, decide jointly: agents propose options and draft artifacts; product and design decisions belong to the user unless the task explicitly mandates them.
- Research describes the current state; design describes the desired state; implementation follows the latest accepted artifact. Facts are corrected before they become design assumptions.
- A playbook may mark a decision gate: a phase whose output must be accepted before the next phase starts. A marked gate is not complete until the decision is recorded.

## Cost-Aware Planning
- Use the cheapest agent/model that can answer the question safely.
- Use expensive/frontier reasoning only for unclear architecture, repeated failures, or high-risk root cause work.
- Split parallel agents only when scopes are disjoint and file/module ownership is explicit.
- Do not spawn agents only to look busy.
- Define verification gates before merge or release.

## Context Reserve
- Keep the configured context reserve available for a final handoff; five percent is the default.
- When the host exposes remaining context and reaches the reserve, update `HANDOFF.md`, then stop.
- If usage telemetry is unavailable, checkpoint after every completed workflow phase.
- Record the objective, current phase, completed work, decisions, changed files, validation, blockers, and exact next action.
- Side observations go to `OBSERVATIONS.md` via `dirf notice`, not the handoff.

## Handoff-Before-Switch
- Write decisions, completed work, and the exact next action into HANDOFF.md before switching sessions, agents, or worktrees — not only when the context reserve is reached.
- The handoff is written first; the switch happens after. Switching without a written handoff is a drift event, not a shortcut.

## Compaction
- Under context pressure, prefer dropping lines by selection over rewriting or summarizing.
- Surviving lines stay byte-identical to their source — never paraphrase a line you keep.
- Run one global pass, not chunked summarization.
- Protect the objective, definition of done, policy, and open decisions from compaction.
- Preserve the most recent turns intact before any historical trimming.
- If the host cannot do verbatim-line compaction, fall back to its native compaction but still protect the sections above.

## Idea to Ship
- Clarify the intent with the best installed interview capability before implementation.
- Prototype only when a question needs a runnable answer.
- Keep small work in one context; publish a tracked spec and dependency-ordered tickets for multi-session work.
- Execute one ticket per fresh context, then review independently against both the specification and repository standards.
- Treat `.dirf/attempts/` as disposable execution evidence, not durable project knowledge.

## UI/UX Quality
- Use UI/UX design-system guidance for visible interface work.
- Check accessibility, touch targets, responsive layout, typography, color contrast, loading/error states, and reduced motion.
- Prefer concrete viewport/runtime evidence over subjective polish claims.
- Treat "impeccable" as a final quality pass, not permission to overbuild.

## Commands
- If `rtk` is installed, prefer `rtk <command>` for shell commands.
- If `rtk` is missing, run the normal command.
- Never make `rtk` a hard requirement for the workflow.
