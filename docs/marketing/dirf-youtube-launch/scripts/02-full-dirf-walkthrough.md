# Episode 2 — Full DIRF walkthrough

## Production card

**Primary title:** DIRF Tutorial: From One Task to a Verified Handoff

**Alternative title:** I Gave DIRF a Messy Task. Here Is the Workflow It Built.

**Thumbnail A:** `TASK → PROOF`

**Thumbnail B:** `THE WHOLE DIRF RUN`

**Target runtime:** 11–14 minutes

**Primary framework:** AIDA through a product-led demonstration

**Test first:** Primary title with thumbnail A. It names the product, the format,
and the transformation without promising automation DIRF does not own.

**CTA:** Run `dirf flow` against one real task.

## Recording scenario

Use a clean demo repository or a sanitized real repository. The task should
need research and a plan but no implementation:

> Research the current onboarding problem and create an evidence-backed plan
> with a specification, dependency-ordered tickets, and a handoff. Do not ship,
> publish, or spend credits.

Replace all command output in this script with recording-day output from the
exact chosen commit.

## Alternate cold opens

### Version A — demonstration-led

I am going to give DIRF one sentence. By the end of this video, that sentence
will have a routed workflow, selected capabilities, a saved attempt, explicit
boundaries, recorded evidence, and an exact next action.

### Version B — curiosity-led

There are three DIRF commands people confuse: flow, create, and plan. One previews
the route, one emits JSON, and one creates a planning lifecycle. I will show all
three, then use the one that fits this job.

## Chapters

| Time | Chapter |
|---|---|
| 00:00 | One sentence in |
| 00:40 | Orient to canonical state |
| 02:00 | Preview with `dirf flow` |
| 03:10 | Create versus build versus plan |
| 04:35 | Inspect the attempt |
| 06:40 | Work the phases |
| 08:45 | Evidence and decisions |
| 10:25 | Resume in a fresh session |
| 12:00 | Run it on your project |

## Voiceover and visual direction

### 00:00 — One sentence in

**VOICEOVER**

I am going to give DIRF one sentence. By the end of this video, that sentence
will have a routed workflow, selected capabilities, a saved attempt, explicit
boundaries, recorded evidence, and an exact next action.

The task is planning-only: research an onboarding problem, produce a spec and
dependency-ordered tickets, and leave a handoff. No implementation. No publish.
No spending credits.

That last sentence is important. DIRF should preserve the boundary, not quietly
turn a research request into a production project.

**VISUAL**

- Full task appears as typed text.
- Highlight outputs in blue and boundaries in amber.
- Show an empty route spine waiting for stages.

### 00:40 — Orient to canonical state

**VOICEOVER**

Before starting an attempt, I orient to the project.

First, `dirf state which`. This resolves the repository to its canonical DIRF
project. The identity comes from Git's common directory, so the main checkout
and related worktrees resolve to the same coordination state.

Second, `dirf state read-handoff`. This is the highest-precedence snapshot of
what is true now: the objective, phase, completed work, decisions, files,
validation, blockers, and exact next action.

Third, `dirf state list-attempts`. I can see prior runs before creating a
duplicate with a slightly different name.

The order matters. Read current reality before creating more state.

**VISUAL**

- Run each command separately.
- Highlight project slug and store path, but sanitize personal path segments if
  this is a public capture.
- Open the handoff and zoom into Exact next action.

### 02:00 — Preview the route

**VOICEOVER**

I do not need to create anything to test the routing decision. I can ask DIRF
for the flow.

Here is the command.

`dirf flow "research the onboarding problem and produce a spec, tickets, and a handoff" --path <project>`

DIRF matches the task to a playbook, applies branches such as research or
multi-session work, and resolves each stage against capabilities installed on
this host.

The important words are “installed on this host.” A playbook asks for a
capability such as primary-source research or dependency ticketing. DIRF then
selects the best available match. A missing optional capability becomes a gap.
It does not become a fake installed tool.

I inspect this preview before I create the attempt. If the route is wrong, the
task description or playbook needs work. There is no value in executing a
beautifully rendered mistake.

**VISUAL**

- Live flow output.
- Animate playbook selection, active branches, and installed capability checks.
- Hold on any reported gap; explain it instead of cutting around it.

### 03:10 — Choose the correct lifecycle command

**VOICEOVER**

DIRF has a few related commands, and they do different jobs.

`dirf create` is the JSON-only route. It is useful when another system wants the
resolved workflow data without the full rendered attempt.

`dirf build` creates an executable workflow for work that will move through the
full route.

`dirf plan` creates a planning lifecycle. With `--research`, it makes the
discovery, modeling, research, specification, ticketing, and handoff stages
explicit.

This task is planning-only, so I use plan.

`dirf plan onboarding-research "<the full task>" --path <project> --research`

DIRF prints the attempt ID, the lifecycle, and the path to the human HTML render.
The attempt begins in planned state. When I resume it, DIRF marks the work in
progress and shows both the canonical project handoff and the attempt-scoped
handoff.

**VISUAL**

- Three-lane comparison: create = JSON, build = execution workflow, plan =
  planning lifecycle.
- Run the exact planning command.
- Highlight attempt ID and lifecycle.

### 04:35 — Inspect the attempt

**VOICEOVER**

The attempt folder is designed for progressive disclosure.

The top-level README is the router. It contains the objective, phases,
definition of done, policy link, role roster, and ordered skill flow.

Each role gets a separate detail file. That file tells the role which skills to
use, what its job is, what is outside its job, and what proves the stage is
done.

The agent does not need every role body loaded at the same time. It opens the
router, then the current stage detail, then any directly referenced material.
Unread files stay out of the context.

The HTML render shows the same structure to a person. Markdown remains the
source. HTML is the view.

That gives me one operating contract with two useful reading surfaces.

**VISUAL**

- File tree of the attempt.
- Open README, then one role file.
- Collapse the unused roles.
- Cut to the HTML render with the matching stage expanded.

### 06:40 — Work phases in order

**VOICEOVER**

The planning lifecycle starts by resolving load-bearing decisions.

For this example, success means a recording-ready onboarding plan. Existing
APIs are irrelevant because no implementation is authorized. The publish and
spend boundaries are already explicit. If the intended audience were still
unknown, that would block useful positioning and I would stop here.

Next comes domain language and durable decisions. I write a short context file
and an ADR. An ADR is useful when a choice will shape several downstream
artifacts. It is unnecessary for a reversible wording tweak.

Then research. Claims that can change, competitor behavior, platform guidance,
and standards need current primary sources. Stable facts from the repository
come from the code and docs at the exact commit.

After those decisions are grounded, I write the spec. The spec describes the
desired result and acceptance checks. Then I split it into dependency-ordered
tickets. Every ticket should trace back to an approved part of the spec.

Finally, I write the execution handoff. It points to the artifacts. It does not
paste the whole strategy into one giant resume document.

**VISUAL**

- Horizontal lifecycle: discover, model, research, specify, slice, handoff.
- For each stage, reveal the artifact and one done-when check.
- Use the actual files from this launch package as the example if approved.

### 08:45 — Record evidence and decisions

**VOICEOVER**

DIRF tracks progress outside the chat.

After a phase is complete, I record what changed, the phase, the next action,
and the files that contain the result. The attempt lifecycle moves with the
work.

Some workflows add stronger gates. A verification gate requires recorded
evidence before the phase advances. A decision gate requires an accept or deny
owned by the user. A denial needs a comment so the next session does not reopen
the same question from scratch.

Evidence remains specific. A passing focused test proves the touched behavior.
It does not prove a merge, a deployment, or production state.

DIRF's focused handoff format reinforces that discipline: lead with the current
result, show concrete evidence, name blockers plainly, and end with one exact
next action.

**VISUAL**

- Run a sanitized `dirf record-progress` command.
- Show an amber decision gate and a green verification gate.
- Split “local test,” “merged,” and “deployed” into separate proof chips.

### 10:25 — Resume in a fresh session

**VOICEOVER**

Now I simulate the part that usually hurts. I leave the session.

In a fresh context or another worktree, I run:

`dirf resume <attempt-id> --path <project>`

DIRF shows pending gates first. It identifies the workflow, the canonical
project handoff, and the attempt handoff. If those disagree, current canonical
project state takes precedence.

The new session does not need a retelling of the entire conversation. It needs
the operating workflow, the current truth, the scoped details for this attempt,
and the exact next action.

That is the continuity test. If I can resume without asking, “What were we
doing again?” the handoff did its job.

**VISUAL**

- Hard visual cut representing a new session.
- Run resume.
- Highlight pending gates, canonical handoff, attempt handoff, exact next action.

### 12:00 — Close

**VOICEOVER**

You do not need to start by building a workflow. Start with the preview.

Take one real task from your current repository. Run `dirf flow` with the
project path. Inspect the playbook, branches, and installed capabilities it
selects.

If the route fits, choose create, build, or plan based on the output you need.
Then preserve progress and evidence as the work moves.

The next video tackles the obvious question: Where does DIRF fit beside Spec
Kit, BMAD, GSD, and Superpowers? I will compare the jobs they do well and show
why this does not need to be a framework cage match.

**VISUAL**

- Final command card: `dirf flow "<your real task>" --path <project>`
- End card to episode 3.

## Shorts extraction markers

1. Flow versus create versus build versus plan.
2. “There is no value in executing a beautifully rendered mistake.”
3. Progressive disclosure in the attempt folder.
4. Focused tests versus merge/deployment proof.
5. The fresh-session resume demonstration.

