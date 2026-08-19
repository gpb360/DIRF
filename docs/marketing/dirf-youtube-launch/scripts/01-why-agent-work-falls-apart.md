# Episode 1 — Why agent work falls apart between sessions

## Production card

**Primary title:** Your AI Coding Agent Forgot the Plan. Again.

**Alternative title:** Why AI Agent Work Falls Apart Between Sessions

**Thumbnail A:** `LOST THE PLAN`

**Thumbnail B:** `“DONE” WITH NO PROOF`

**Target runtime:** 8–10 minutes

**Primary framework:** ACCA

**Test first:** Title/thumbnail A. The recurring personal frustration is easier
to recognize than the abstract category of agent continuity.

**CTA:** Open the DIRF repository and read the first-run example.

## Alternate cold opens

### Version A — problem-led

Yesterday, your AI agent said the task was done. Today, a fresh session has
three questions: What changed? What passed? What happens next? If the answer is
buried in 200 messages, you do not have a handoff. You have an archaeological
site.

### Version B — proof-led

This is one DIRF handoff. It shows the objective, the current phase, the files
that changed, the validation that ran, the blockers, and one exact next action.
In this video I will show why those six pieces matter more than another giant
prompt.

## Chapters

| Time | Chapter |
|---|---|
| 00:00 | The archaeological-site handoff |
| 00:35 | Three failure modes |
| 02:20 | What DIRF adds |
| 04:20 | Route, record, finish line |
| 06:30 | What DIRF does not do |
| 07:30 | The first command |

## Voiceover and visual direction

### 00:00 — Cold open

**VOICEOVER**

Yesterday, your AI agent said the task was done. Today, a fresh session has
three questions: What changed? What passed? What happens next?

If the answer is buried in 200 messages, you do not have a handoff. You have an
archaeological site.

I built DIRF for this exact mess. DIRF stands for Do It Right First. In this
video, I am going to show the problem it solves, the parts it deliberately does
not solve, and why the answer is smaller than another all-purpose AI framework.

**VISUAL**

- Start on a blurred, very long agent conversation.
- Search for “done,” then reveal three contradictory matches.
- Cut to the clean canonical handoff with Objective, Validation, and Exact next
  action highlighted.
- Two-second DIRF title. No extended logo animation.

### 00:35 — Failure mode one: the wrong route

**VOICEOVER**

The first failure happens before the agent writes a line of code. We give every
job to the same general-purpose session.

A security review, a landing-page redesign, a database migration, and a release
investigation do not need the same sequence or the same expertise. Yet the
usual prompt is some version of, “Please look at this and fix it.”

The model sees whatever tools happen to be in context. It may load too much,
pick a familiar skill instead of the right one, or start implementing while a
load-bearing decision is still missing.

DIRF starts with routing. It reads the task, inspects the target repository, and
checks the capabilities actually available on the machine. Then it selects a
small workflow for that job.

Here is a real example. I asked DIRF to review a pull request for correctness,
security, and release readiness. It routed the work into code review, security
review, and test verification. Three capabilities. One order. No giant catalog
loaded into the task.

**VISUAL**

- Live capture: `dirf flow "review a pull request for correctness, security, and release readiness"`
- Highlight the three routed stages.
- Animate many faded skill names at the edge, with only three joining the route.

### 02:20 — Failure mode two: context drift

**VOICEOVER**

The second failure appears when the work outlives the chat.

Maybe the context window fills up. Maybe you open a new session. Maybe a second
agent takes the review. Maybe you move the work into a Git worktree. All of
those are normal. The problem starts when each environment carries a different
version of the plan.

One session says the objective changed. Another has the newer test result. A
local handoff says one thing, while the main checkout says something else. Add
two branches and a Friday afternoon, and confidence drops fast.

DIRF keeps coordination state in one central store, keyed to the repository's
Git common directory. Related worktrees resolve to the same project state.
There is one canonical project handoff, plus attempt-specific detail when a
particular run needs it.

That distinction matters. The attempt remembers its workflow. The canonical
handoff tells the next session what is true now.

**VISUAL**

- Two worktrees branch from one repository.
- Conflicting local notes appear, then fade.
- One canonical handoff stays centered and connects to both worktrees.
- On screen: “Canonical project state takes precedence.”

### 03:55 — Failure mode three: completion fog

**VOICEOVER**

The third failure is the most expensive: the agent says “done,” but nobody can
tell what that means.

Did the focused test pass? Did the full build pass? Was the pull request merged?
Was anything deployed? Did the production data change? Those are different
states. A clean local command proves one of them. It does not quietly prove the
rest.

DIRF puts completion checks and evidence into the workflow. A phase with a
verification gate cannot advance on confidence alone. A decision gate belongs
to the user. A blocked attempt needs a reason. The handoff names the evidence
that exists and the proof that still does not.

This is the finish line in the campaign line: not a green confetti animation.
A checkable definition of done.

**VISUAL**

- Show a “Done” bubble with no evidence. Turn it gray.
- Show three separate states: local tests, merged PR, production verification.
- Move only local tests to green.
- Animate an amber evidence gate turning green after a real command result.

### 05:00 — The DIRF model

**VOICEOVER**

I describe DIRF with three words: route, record, finish line.

Route means the task gets a workflow built from the project and the capabilities
available right now.

Record means DIRF saves the attempt, its role boundaries, its decisions, its
phase, and its handoff outside the disposable chat.

Finish line means the workflow says what evidence proves the job is complete.

Underneath that is a deliberately small design. Markdown is the source. The
agent reads a lean router first, then opens role detail only when that stage
begins. A human can open the matching HTML render. Unread detail stays out of
the context.

DIRF does not replace the model. It does not replace your skills. It does not
replace your project rules. It gives those pieces a task-specific operating
route.

**VISUAL**

- Full Excalidraw system map.
- Push into three labeled regions: Route, Record, Finish line.
- Split screen: Markdown router on the left, human HTML on the right.

### 06:30 — Honest boundaries

**VOICEOVER**

Here are the limits, because useful software has edges.

DIRF is not a live agent monitor. An attempt marked in progress means the work
is recorded as active. It does not claim that a model is currently running.

DIRF is not an issue tracker. It can preserve attempts, observations, and a
portfolio rollup, but work that needs team assignment and business priority
still belongs in the right tracker.

DIRF does not grant itself permission to deploy, merge, spend money, delete
data, or change production. It can represent a decision or evidence gate. The
authority remains human and system-owned.

And host-neutral instructions do not magically make every tool available in
every environment. DIRF preserves the capability and the route. The active host
still needs the required tool.

Those boundaries are part of the value. I would rather show you the exact layer
DIRF owns than sell you an imaginary robot company.

**VISUAL**

- Four simple boundary labels: No live monitor, no issue tracker, no automatic
  authority, no magical tool portability.
- Keep tone calm; no red alarm graphics.

### 07:30 — Close

**VOICEOVER**

The easiest way to understand DIRF is to try the route before you build
anything.

Open the repository linked below. Read the first-run example. Then take one real
task from your current project and ask DIRF to show the flow.

In the next episode, I will do exactly that from start to finish: one messy task,
the routed capabilities, the saved attempt, the evidence, and the resumed
handoff.

Keep your agent stack. Give it a route, a record, and a finish line.

**VISUAL**

- Show repository URL placeholder.
- End card: Episode 2, “Task → verified handoff.”
- Display one command: `dirf flow "<your real task>" --path <project>`

## Shorts extraction markers

1. “You do not have a handoff. You have an archaeological site.”
2. The three failure modes in 45 seconds.
3. “Done is not a feeling” with the evidence-gate visual.
4. The worktree-to-canonical-state explanation.
5. The four honest boundaries.

