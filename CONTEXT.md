# DIRF

DIRF turns a project task into a lean, resumable instruction set grounded in
the project and the capabilities available to the current host.

## Language

**Playbook**:
A named task pattern containing its routing cues, agent roster, workflow contract, and ordered skill flow.
_Avoid_: Template, flow definition

**Reconciliation**:
Validation that each Playbook is one coherent definition across routing cues, workflow contract, agents, and skill flow. It never merges conflicting definitions at runtime.
_Avoid_: Runtime fallback, conflict resolution

**Task Routing**:
The decision that selects a playbook from task intent and assembles that playbook's ordered skill flow. Triage represents an unclassified task; an incomplete playbook definition is invalid.
_Avoid_: Classification, recommendation

**Capability Profile**:
An explicit invocation-scoped allowlist of skill names that narrows Task Routing candidates without changing the discovered inventory. Unavailable names remain visible capability gaps.
_Avoid_: Skill registry, project default, profile layer

**Preflight Model Advice**:
An optional model suggestion recorded before work begins from information supplied by the host. The full contract lives in [`skills/model-advice/README.md`](skills/model-advice/README.md).
_Avoid_: Live price routing, model execution, process monitoring

**DIRF Flow Board**:
A project and Attempt view of canonical DIRF coordination state. It does not monitor or manage live agent processes.
_Avoid_: Agent monitor, issue tracker

**In Progress**:
An Attempt recorded as actively being worked, including its current phase and assigned agent when known. It does not assert that an agent process is currently running.
_Avoid_: Live, running

**Execution Observation**:
The latest trusted-harness snapshot for an Attempt: owning orchestrator, normalized status, observed time, worktree, branch, and bounded child reports. A host-held capability, bound during trusted setup before agents run, authorizes updates without being exposed in the Project view. It describes runtime evidence without changing Attempt lifecycle state.
_Avoid_: Attempt status, inferred process

**Active Now**:
An Attempt whose fresh orchestrator snapshot reports the orchestrator or at least one registered child as `active`. The harness is the sole authority for this runtime fact; branch, worktree, lifecycle, and handoff evidence cannot infer it.
_Avoid_: In Progress, recently edited

**Execution Ownership Conflict**:
A different harness session or Attempt tries to claim a worktree and branch that has an Active Now owner. DIRF stops and shows the owning session, Attempt, and handoff. Re-observing the same session and Attempt is an idempotent refresh.
_Avoid_: New Attempt, automatic takeover

**Dormant Owner**:
The last owner of a worktree and branch is idle or stale rather than Active Now. DIRF defaults to resuming that Attempt's handoff. A new harness session may take over the same Attempt only with an explicit reason; a different Attempt must first explicitly abandon the old Attempt.
_Avoid_: Available branch, abandoned Attempt

**Abandoned Attempt**:
An Attempt explicitly stopped without completion by an authorized user or owning orchestrator, with a recorded reason. It remains visible in history and may be reopened. A timeout, missing observation, or released execution claim never implies abandonment.
_Avoid_: Stale Attempt, idle session, deleted Attempt

**Delegated Status Contract**:
Instructions attached by an orchestrator to every subagent assignment, identifying the DIRF Attempt and requiring the subagent to report its runtime state, result, blocker, and handoff back to that orchestrator.
_Avoid_: Optional status update, independent Attempt

**Child Execution**:
A bounded subagent run owned by an orchestrator within one Attempt. It has its own harness session, assignment, runtime state, blocker, and result, but it does not own an independent DIRF lifecycle or continuation handoff.
_Avoid_: Attempt, autonomous project task

**Independent Attempt Boundary**:
A delegated work item becomes a separate Attempt only when it must be resumed, transferred, blocked, abandoned, or continued through its own handoff independently of the parent Attempt.
_Avoid_: One Attempt per subagent

**Live Work Registry**:
The Project view that reconciles every Attempt's lifecycle, Execution Observation, worktree, and Attempt Handoff. It reports active, resumable, blocked, stale, explicitly abandoned, planned, historical, and completed work without starting or managing agent processes.
_Avoid_: Latest Attempt, process manager

**Attempt Lifecycle Action**:
An explicit Start, Block, Abandon, Complete, or Reopen transition applied to canonical Attempt state. Moving or viewing a card in the Flow Board never changes status implicitly.
_Avoid_: Drag-and-drop update, automatic status inference

**Resume Prompt**:
Paste-ready instructions identifying the Project and Attempt and directing an agent to load the canonical workflow and handoff before continuing the exact next action. The Flow Board copies this text but does not launch an editor or terminal.
_Avoid_: Resume command, process launch

**Canonical Handoff**:
The Project's shared coordination snapshot. Resolve checkout responsibility first and load that Attempt's Handoff. Reconcile warnings about related work before continuing. Use the Project handoff as supporting context when it does not conflict with the active Attempt.
_Avoid_: Attempt handoff, local handoff

**Project Rollup**:
A count-based summary of the lifecycle states of a Project's Attempts. A Project has no lifecycle status of its own and may contain multiple In Progress Attempts.
_Avoid_: Project status

**Worker**:
The optional person or agent-host label currently assigned to an Attempt. Assignment accepts a new label or a previously used Worker tag and is not inferred from the Playbook's agent roster.
_Avoid_: Agent role, live process

**Current Phase**:
The selected phase from an Attempt's ordered Workflow. Starting selects the first phase and advancing selects the next; arbitrary phase names are not allowed.
_Avoid_: Free-text stage

**Done Attempt**:
An Attempt completed from its final Current Phase after explicit confirmation that the phase's done-when checks passed.
_Avoid_: Closed, archived

**Blocked Attempt**:
An Attempt that cannot advance and carries a required reason. Blocking may occur from any Current Phase.
_Avoid_: Paused, stalled

**Bucket View**:
The Flow Board layout where a lifecycle bucket is selected in a sidebar and the main area shows matching Attempt cards. It is not a draggable Kanban board.
_Avoid_: Kanban, board column

**Portfolio View**:
The all-Project Flow Board scope, grouped by Project within the selected bucket. The default scope is Portfolio View with In Progress selected.
_Avoid_: Project status

**Historical Attempt**:
An Attempt created before lifecycle tracking and shown only in History. Start Tracking adds canonical lifecycle metadata in Planned state without changing its Workflow or handoffs.
_Avoid_: Legacy attempt, migrated attempt

**Planned Attempt**:
A lifecycle-tracked Attempt that has not started. Every newly built Attempt enters Planned state automatically.
_Avoid_: New, queued

**Linked Worktree**:
An existing Git worktree associated with an Attempt. DIRF may inspect it automatically but never archives or deletes it without explicit approval.
_Avoid_: Attempt folder, checkout

**Cleanup Candidate**:
A Linked Worktree surfaced for human review because its Attempt is Done or its activity is stale. Dirty or conflicted worktrees are never eligible for deletion.
_Avoid_: Orphan, abandoned worktree

**Archived Worktree**:
A Linked Worktree retained for cleanup with its Project, Attempt, path, branch, HEAD, cleanliness, and archive time recorded. After a configurable retention interval, DIRF repeatedly offers removal but never deletes automatically; removal remains limited to a clean worktree at the recorded HEAD.
_Avoid_: Deleted worktree, Git archive

**Unlinked Worktree**:
A worktree discovered through a registered Project that has no associated Attempt. It is surfaced for linking or archive review without scanning arbitrary filesystem locations.
_Avoid_: Unknown folder, orphan

**Cleanup Bucket**:
The Flow Board view of completed, stale, unlinked, and archive-due worktrees requiring human review. Cleanup items are separate from Attempt lifecycle buckets.
_Avoid_: Attempt status, trash

**Needs Attention Worktree**:
A dirty or conflicted worktree that cannot be archived or deleted. It remains visible until its Git state is resolved by the user.
_Avoid_: Cleanup candidate, archived worktree
