# RPI bundle assessment for DIRF

Date: 2026-08-12  
Source reviewed: `C:\Users\garyp\Downloads\RPI\rpi-bundle`  
DIRF baseline: `main` at `886a762` after a fast-forward pull

## Executive assessment

RPI is a strong artifact-driven workflow for one opinionated path: research, design, plan, isolated implementation, and pull-request explanation. Its best ideas can deepen DIRF's existing lifecycle, but the bundle should not be installed into DIRF verbatim.

DIRF already has the more reusable outer architecture: host-neutral capability discovery, playbook routing, canonical cross-worktree state, explicit lifecycle gates, evidence records, governed effects, and portable generated attempts. RPI is stronger inside the software-change workflow: it defines richer artifact types, keeps current-state research deliberately separate from desired-state design, makes document precedence explicit, supports shared plus local multi-repository workspace configuration, and compares the final implementation with the approved plan.

The recommended contribution is therefore **not "replace DIRF with RPI"**. It is to add a small artifact contract and workspace adapter behind DIRF's existing interfaces.

## What the bundle contains

The bundle is installation material rather than a runnable application. Its root README directs users to copy 21 skill folders into `~/.claude/skills/` and seven agent definitions into `~/.claude/agents/`, then invoke `/rpi` from a Git repository (`rpi-bundle/README.md:1-39`). It has no package manifest, executable entry point, automated test suite, lockfile, version manifest, or bundled license file.

The orchestrator composes these stages:

```text
ticket or prose
  -> research questions
  -> objective current-state research
  -> design discussion / PRD / TDD as needed
  -> structure outline
  -> detailed plan
  -> worktree setup
  -> phase-by-phase implementation
  -> PR description plus plan-deviation review
```

Task artifacts are chronological Markdown files under `.humanlayer/tasks/<slug>/`. Create and iterate skills are separate, so user feedback rewrites an existing artifact rather than silently beginning the next stage.

## Setup and portability assessment

The bundle's documented two-copy installation is simple, but it is not safe enough to adopt as DIRF's installation model.

| Concern | RPI behavior | DIRF implication |
|---|---|---|
| Host binding | Claude Code slash commands, `Task` agents, and Claude-specific install roots | Import behavior through capability discovery; do not hardcode a host |
| Author binding | Many skills reference `/Users/joshboyd/.claude/skills/...` | Paths must resolve relative to the selected skill folder |
| State | Repo-local `.humanlayer/tasks/<slug>/` artifacts, often expected to be uncommitted or symlinked | Keep DIRF canonical state; expose artifact links inside an attempt |
| Workspaces | Shared `.humanlayer/workspace.json` plus local overrides and multi-repo entries | Adapt the schema behind a DIRF workspace interface |
| Mutation | Setup can create branches/worktrees, copy secrets, run arbitrary setup commands, commit, push, and create/update PRs | Route every effect through DIRF governance and explicit authority |
| Verification | Prompt contracts, no bundle-level executable tests | Convert adopted contracts into schemas and focused tests |

### Safe way to trial RPI itself

Do not copy this snapshot into the global Claude directories yet. A disposable pilot should:

1. Use a throwaway Claude configuration root or test account rather than `~/.claude`.
2. Rewrite hard-coded author paths to paths relative to each installed skill.
3. Disable worktree creation, setup commands, commits, pushes, and PR mutation for the first run.
4. Use a disposable repository and a prose task with no credentials or external integrations.
5. Capture every produced artifact and every requested action, then compare the result with a DIRF attempt for the same task.

Until that fidelity pilot exists, the bundle is suitable as research input, not as a globally installed dependency.

## Architectural comparison

| Capability | RPI | Current DIRF | Assessment |
|---|---|---|---|
| Task routing | One opinionated `/rpi` software-delivery path | Multiple playbooks selected from the task and installed capabilities | DIRF is broader and more portable |
| Progressive disclosure | Separate phase skills and references | Small attempt router plus lazy-loaded agent details | Equivalent principle; DIRF has the deeper external interface |
| Research objectivity | Dedicated question artifact; research is current-state only | Policy says research is current state and design is desired state | Add an optional question artifact and stronger enforcement |
| Artifact chain | Chronological typed files with explicit precedence | Workflow snapshot, README, agent details, evidence, handoffs | Add typed artifact relationships, not a parallel state tree |
| Human gates | Frequent conversational pauses, especially design and plan | Persisted verify/decision/soft gates that cannot be crossed implicitly | DIRF is more enforceable; borrow RPI's gate placement |
| Worktree creation | Configurable shared/local, multi-repo creation and bootstrap | Links, inspects, archives, and safely removes existing worktrees | RPI reveals a real creation/configuration gap |
| Implementation | One implementer per phase, verification and approval between phases | Ordered phases, installed capability casting, evidence and handoff | Adapt phase ownership while preserving host-neutral casting |
| Plan conformance | PR description calls a reviewer to classify deviations | Code review and evidence exist, but no first-class plan-delta artifact | High-value addition |
| External effects | Prompts directly invoke Git/GitHub/setup commands | Governed action evaluator and tamper-evident ledger | DIRF should remain authoritative |
| Resume/portfolio | Artifact folder and checkboxes | Canonical store, attempt lifecycle, handoff, portfolio | DIRF is substantially stronger |

## Findings for the DIRF plan

### Adopt: a typed artifact graph inside each attempt

RPI's chronological files make the reasoning chain reviewable. DIRF should represent the same relationships in `workflow.json` or a small `artifacts.json`, with types such as `research_questions`, `research`, `design`, `structure`, `plan`, `implementation_evidence`, and `plan_delta`.

The interface should stay small:

```json
{
  "type": "plan",
  "path": "artifacts/05-plan.md",
  "supersedes": ["artifact-id"],
  "acceptedAt": "ISO-8601 or null"
}
```

DIRF already states the governing rule — research describes current state, design describes desired state, and implementation follows the latest accepted artifact (`policies/workflow-policy.md:75-76`). The missing piece is machine-readable provenance and precedence.

### Adopt: research questions as an optional query-plan stage

RPI explicitly prevents research questions from leaking proposed implementation into current-state discovery (`skills/create-research-questions/SKILL.md:44-66`). That is useful for large, ambiguous, security-sensitive, or unfamiliar codebases.

Add it as a conditional stage, not a mandatory ceremony. The router can select it when task breadth, uncertainty, or risk is high. Small fixes should continue directly to focused research.

### Adapt: shared/local multi-repository workspace configuration

RPI's best operational contribution is its `workspace.json` / `workspace.local.json` model: task and repository path templates, one primary repository, per-repository source refs and setup commands, additive copy globs, and local overrides.

DIRF currently manages existing worktrees well: it links them to attempts, identifies dirty/conflicted/stale state, archives safely, and requires explicit approval before removal (`src/state.js:560-566`, `src/state.js:691-754`). It does not yet offer a deep module for creating and bootstrapping a single- or multi-repository workspace.

Create one workspace interface with at least two adapters before stabilizing it:

- a dry-run adapter that resolves paths, refs, files, and commands without effects;
- a Git adapter that performs approved creation and bootstrap operations.

The dry-run result should be the authorization payload for `dirf govern`, ensuring copied files and setup commands are exact-content-bound before execution.

### Adopt: implementation-versus-plan deviation evidence

RPI's PR workflow distinguishes implemented-as-planned, additions, and planned-but-missing work (`skills/describe-pr/references/pr_description_template.md:33-51`). DIRF should make this a standalone `plan_delta` artifact produced before completion, independent of whether GitHub is used.

This would strengthen DIRF's current completion contract: tests can prove behavior, but a green test alone does not prove that the accepted scope was fully delivered or that unapproved scope was avoided.

### Adapt: phase-local implementation ownership

RPI starts a fresh implementer for each plan phase and pauses for verification before the next phase (`skills/implement-plan/SKILL.md:6-75`). DIRF should express this as an optional execution policy:

- one phase has one declared owner at a time;
- the phase output and evidence are recorded before handoff;
- decision gates remain user-owned;
- commits remain repository-policy-controlled, never implicit.

This fits DIRF's current lifecycle, whose renderer already requires phases in order and whose state core refuses to cross unsatisfied gates (`src/renderer.js:319-341`, `src/state.js:328-398`).

### Reject: direct import of the RPI prompt tree

Do not add all 21 RPI skills and seven agents as bundled DIRF defaults. That would enlarge the always-maintained surface, duplicate installed host capabilities, and violate DIRF's installed-first and ponytail-lean principles.

Do not adopt:

- hard-coded Claude, HumanLayer, author-home, or Unix command paths;
- automatic branch creation, commits, pushes, PR creation, or setup commands from prose alone;
- the assumption that `.humanlayer/tasks` is an uncommitted symlink;
- exact-output templates that suppress useful host-specific status;
- "trust checked boxes unless something seems off" as completion evidence;
- a new artifact store beside DIRF's canonical store.

## Recommended roadmap contribution

### P0 — define and test artifact provenance

Add a minimal artifact schema, precedence validation, accepted-artifact gate, and `plan_delta` artifact. This deepens the existing attempt module without changing routing or host integration.

Success proof:

- contradictory artifacts resolve deterministically;
- implementation cannot begin before the configured accepted artifact;
- completion reports planned, added, omitted, and unverifiable scope;
- old attempts remain readable.

### P1 — add a governed workspace dry run

Add `dirf workspace plan <attempt>` that resolves a single- or multi-repo workspace without changing disk or Git. Output exact worktree paths, branch/ref choices, copy sources/destinations, setup commands, and required approvals.

Success proof:

- shared config plus local override merge is deterministic;
- secrets are identified without printing their contents;
- path traversal, main-checkout targets, duplicate branches, and dirty collisions are denied;
- the resulting digest can be evaluated by `dirf govern`.

### P2 — add the approved workspace execution adapter

Only after P1 is stable, add creation/bootstrapping with atomic authorization consumption, rollback guidance, and attempt linkage. Reuse DIRF's existing worktree inventory and cleanup controls.

### P3 — add conditional research-question routing

Introduce an optional high-uncertainty research stage and a small template. Measure whether it reduces rework or merely adds ceremony before making it a default branch.

## Validation and evidence

- `node src/cli.js validate` passed: 22 agents, 20 playbooks, 39 skills.
- `node --test tests/*.js` passed with exit code 0 when allowed to spawn Node test workers. The sandboxed run failed before executing tests with `spawn EPERM`; that was an environment restriction, not product failure.
- `dirf status` resolved the checkout correctly when Git subprocess access was allowed: configured, 12 attempts before this assessment, branch `main`, upstream 0 ahead/0 behind.
- Dedicated attempt created: `20260812T181343440Z-rpi-bundle-dirf-assessment`.
- No RPI installer, setup command, Git mutation, global skill installation, or external action was executed.

## Decision

RPI contributes four worthwhile ideas to DIRF: typed artifact provenance, optional objective research questions, governed multi-repo workspace creation, and plan-deviation evidence. DIRF should implement these behind its existing state, governance, discovery, and lifecycle interfaces. The RPI bundle itself should remain an uninstalled reference snapshot until a disposable fidelity and safety pilot is completed.
