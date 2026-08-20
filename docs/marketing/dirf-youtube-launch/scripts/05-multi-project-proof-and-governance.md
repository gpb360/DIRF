# Episode 5 — Multi-project continuity and governed execution

## Production card

**Primary title:** How I Manage Multiple AI Projects Without Losing the Handoff

**Alternative title:** DIRF Across Worktrees, Projects, and Agent Sessions

**Thumbnail A:** `9 PROJECTS. ONE TRUTH.`

**Thumbnail B:** `THE HANDOFF SURVIVES`

**Target runtime:** 10–13 minutes

**Primary framework:** STAR Story plus proof

**Test first:** Primary title. It leads with the operator outcome while the
thumbnail supplies the research-day scale snapshot.

**CTA:** Register one active project and write its first canonical handoff.

## Public naming gate

Replace the project names below with approved public names or anonymized labels
before recording:

- A previously named client engagement → Project A
- A second client engagement → Project B
- Challenge Builder → Project C
- Lowlands → Project D

## Alternate cold opens

### Version A — operating proof

On the research day, this DIRF store reconciled nine projects and their attempt
history from one portfolio command. That is internal operating proof, not a
customer count. I will show exactly what it proves and what it does not.

### Version B — worktree story

Two Git worktrees can hold different branches without inventing two versions of
the project memory. DIRF keys coordination state to Git's common directory, so
both worktrees resolve to the same canonical handoff.

## Chapters

| Time | Chapter |
|---|---|
| 00:00 | The Friday-afternoon problem |
| 01:10 | Project state versus attempt state |
| 03:05 | Why worktrees used to drift |
| 04:50 | Portfolio without live-agent theater |
| 06:40 | Real internal operating examples |
| 08:15 | Observations, blockers, and trackers |
| 09:35 | Governed execution |
| 11:20 | Start with one project |

## Voiceover and visual direction

### 00:00 — The Friday-afternoon problem

**VOICEOVER**

Here is the Friday-afternoon version of agent work.

One feature is in a worktree. A release fix is on main. Another session is
researching the root cause. The agent that ran the tests is gone. Somebody
opens a fresh chat and asks, “Are we good to deploy?”

The honest answer is usually, “Good in which checkout, at which commit, with
which test, and deployed where?”

DIRF grew from operating across real projects with exactly this kind of state.
On the research day, the central portfolio reconciled nine registered projects
and their attempt history. That is internal operating proof. It shows the tool
has been used repeatedly by its builder. It is not a customer count, a market
share claim, or proof that every workflow was successful.

In this video, I will show the operating model: project state, attempt state,
worktree continuity, portfolio rollups, and the advanced governed-execution
layer.

**VISUAL**

- Messy Friday timeline with three checkouts and two chats.
- Cut to approved portfolio view or sanitized JSON.
- On screen: “Internal operating proof. Research-day snapshot.”

### 01:10 — Project state versus attempt state

**VOICEOVER**

DIRF separates the project from the attempt.

The project has one canonical coordination snapshot. That handoff answers what
is true now across the repository: objective, current phase, completed work,
decisions, changed files, validation, blockers, and one exact next action.

An attempt is one routed run. It keeps its own workflow, lifecycle, selected
roles, evidence, gates, and scoped handoff.

Several attempts can belong to one project. One can be complete, another
planned, and a third in progress. The project itself is not a draggable card
pretending all work shares one status.

When a fresh session resumes an attempt, it reads canonical project state first
and the attempt detail second. Current project truth wins if older scoped detail
disagrees.

**VISUAL**

- One Project trunk with three Attempt branches.
- Canonical handoff sits on the trunk.
- Attempt handoffs sit on branches and never cover the trunk.

### 03:05 — Worktree continuity

**VOICEOVER**

Git worktrees are useful because two branches can stay checked out at the same
time. They are dangerous when workflow state lives inside each checkout and
starts to diverge.

DIRF derives the project identity from `git rev-parse --git-common-dir`. The
main tree and related worktrees share that Git common directory, so they resolve
to the same DIRF project in the central store.

Runtime paths remain local. The coordination identity does not.

DIRF also refuses to silently overwrite a newer local handoff during migration.
It surfaces the conflict and requires an explicit import path that backs up the
current canonical copy.

That is a small but important pattern: when two plausible truths exist, stop
and preserve both before choosing.

**VISUAL**

- Run `dirf state which` in two approved worktrees if a safe demo is available.
- Same slug and store path highlight.
- Show conflict path as a diagram, not by creating a real conflict during the
  recording.

### 04:50 — Portfolio without live-agent theater

**VOICEOVER**

`dirf portfolio` rolls up registered projects and attempt lifecycle state.

It can show active, completed, stale, archived, and empty project groupings,
plus counts for planned, in-progress, blocked, done, historical, and
evidence-complete attempts.

The language is deliberately careful. An attempt marked in progress means DIRF
records it as active. It does not claim an agent process is running right now.

The portfolio is also evidence-aware. Older attempts may carry completion in a
handoff even when lifecycle metadata was not updated at the time. DIRF can
surface that source and provides an explicit sync operation rather than silently
rewriting history.

This gives an operator a useful question: Where is work recorded as active, and
which exact attempt or handoff should I inspect next?

**VISUAL**

- Live `dirf portfolio --json` or the human Flow Board if approved and current.
- Highlight status source and latest exact next action.
- Add label: “Recorded state, not live process telemetry.”

### 06:40 — Real internal examples

**VOICEOVER**

Here is how this has worked in practice.

In the story-production project, DIRF has separated media, payments, release,
camera, audio, and audit work into distinct attempts instead of one permanent
mega-chat.

In the governed operations project, a planning attempt and an execution attempt
could carry different evidence and authority boundaries while sharing current
project truth.

In the challenge product, an SEO recovery attempt could finish its local proof
and still leave the pull-request decision as the exact next action. Local green
did not become an imaginary production deployment.

In the client marketing project, campaign work could be recorded as complete
without treating publication or scheduling as part of the research permission.

Use the public names only if approved. The point is the shape: separate attempts,
one current project handoff, and proof scoped to what actually happened.

**VISUAL**

- Four anonymized project lanes by default.
- Each shows one attempt, one evidence artifact, and one remaining boundary.
- No customer logo without permission.

### 08:15 — Observations, blockers, and trackers

**VOICEOVER**

Long-running work produces side observations. A stale document. A separate bug.
A cleanup idea. Putting every one of those into the handoff makes the next
session slower and less certain.

DIRF gives side observations their own channel. They can stay with the attempt
or be promoted to project-level visibility. They do not become blockers unless
they actually block the current task.

A blocker is different. It stops progress and needs a reason.

A ticket is different again. It needs prioritization, ownership, and the right
tracker.

Keeping those meanings separate makes the canonical handoff smaller and more
useful.

**VISUAL**

- Three destinations: Observation, Blocker, Tracker.
- One sample note goes to each.
- Canonical handoff remains uncluttered.

### 09:35 — Governed execution

**VOICEOVER**

Current DIRF main adds an advanced governed-execution layer.

This part deals with compound agent actions that may include reads, writes,
external calls, or higher-risk effects. The evaluator examines each action
segment and applies a strict precedence: deny wins, then require approval, then
allow.

Approvals bind to the exact action and policy digest. Evidence events form a
hash-linked ledger that can be verified later.

That still does not make a local CLI the final enforcement boundary. The host
product must normalize actions through trusted code, protect credentials, and
consume authorization atomically before the side effect happens.

The phrase I use is simple: approval is a pause, not permission. A recorded need
for approval tells the workflow to stop. The actual authority must be exact,
current, single-use where required, and owned outside the requesting agent.

This section must be captured from a commit that actually includes the
governance commands. The research checkout was behind remote main, so do not
demonstrate it from mixed code.

**VISUAL**

- Compound action breaks into segments.
- Precedence stack: Deny → Require approval → Allow.
- Exact action digest binds to an approval.
- Ledger events connect through hashes.
- Boundary label: “Host enforces before effect.”

### 11:20 — Close

**VOICEOVER**

Do not begin by registering every repository you have ever cloned.

Pick one active project. Run `dirf state register --path <project>` if it is not
already configured. Write a canonical handoff with the current objective,
evidence, blockers, and one exact next action. Then create one attempt for one
real task.

That small start is enough to test the promise of this entire series: the next
session should know where to begin without replaying your history or inventing
new truth.

If that works, add the second project. Then the second host. Keep the useful
parts of your stack and give the work a route, a record, and a finish line.

**VISUAL**

- Command card: `dirf state register --path <project>`
- Then: `dirf state write-handoff --file handoff.md --path <project>`
- Series end card linking playlist and repository.

## Shorts extraction markers

1. “Good in which checkout, at which commit, with which test?”
2. Project state versus attempt state.
3. Two worktrees, one canonical project identity.
4. Internal operating proof versus customer traction.
5. “Approval is a pause, not permission.”

