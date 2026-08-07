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

## Communication
- Keep output terse and technical.
- Lead with changed, verified, blocked, or risk.
- Use concrete files, commands, diffs, tests, and errors as proof.
- Do not add AI attribution footers or generated-by boilerplate.

## Side observations
- Park anything noticed that is NOT the current task (a side bug, a doc staleness, a "fix later") via `dirf notice "<note>"`. Default target: the current attempt.
- Never put side observations in HANDOFF.md — they are not status, decisions, or blockers.
- Do not act on a side observation in the current attempt. Log it and continue.
- Observations are ephemeral to the attempt. Promote one to the project-level list with `dirf notice promote <N>` only if it should survive across sessions.

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
