# Agent Guide — using DIRF against a project

This is the guide for an AI agent using **DIRF** (Do It Right First) as a tool
against a host project — any repo DIRF has been set up for. If you're
contributing to the DIRF repo itself, read
[`../AGENTS.md`](../AGENTS.md) instead.

## The one rule that matters most

**Always go through `dirf state`. Never read or write `.dirf/` directly.**

DIRF keeps one **canonical** copy of the project's coordination state — the
handoff, the attempt history, the config — in a central store at
`~/.dirf/projects/<slug>/`. You reach it with `dirf state ...` commands. A
leftover `.dirf/` folder in the project checkout is **legacy/inert** — it's a
pre-cutover artifact or a migration backup. Reading it directly is how state
**drifts**: a worktree reads a stale local copy and works from out-of-date
context. That exact failure has broken real multi-session work before. Don't
repeat it.

## Setup (one-time, per machine)

`dirf` is a shell function/alias pointing at `node <path-to-DIRF>/src/cli.js`.
If `dirf state which` works, you're set up. If not, the host hasn't installed
the alias — fall back to the full path:

```bash
node /path/to/DIRF/src/cli.js state which
```

(Adjust the path to wherever the DIRF clone lives on this machine.)

## Session lifecycle

### 1. Resolve responsibility (start of every session)

```bash
dirf state active
```

This bounded query reports one of three states without loading the portfolio or
full handoffs:

- **idle** — DIRF is available and new work can be routed normally;
- **active** — one in-progress attempt owns this checkout; reuse it instead of
  building a duplicate;
- **conflict** — multiple attempts claim the checkout; stop and select one
  explicitly instead of choosing the latest.

`dirf resume <id>` is the claim operation. It starts a planned attempt and
binds it to the current Git worktree. Blocking or completing it makes the
checkout idle again.

Use `dirf state which`, `state read-handoff`, and `state list-attempts` for
diagnosis or recovery, not as an unconditional session bootstrap. The project
slug still comes from `git rev-parse --git-common-dir`, so every worktree shares
canonical project state while responsibility remains checkout-scoped.

Hosts with session hooks can run `dirf state active --hook`. The command emits
the small `SessionStart` context envelope directly; it contains the active
phase, exact next action, and lazy paths to the workflow and attempt handoff.

### 2. Plan / start a workflow

```bash
dirf build <short-name> "<one-sentence task>"
```

This routes the task (matches a playbook), resolves agents + skills against
what's actually installed on the host, and writes a lean instruction set into
the store at `~/.dirf/projects/<slug>/attempts/<id>/`. It prints the attempt id.
Open that attempt's `README.md` — it's the operating workflow (ordered phases,
agent roles, done-when checks, policy). Execute it one phase at a time.

To see the routed skill flow without building:

```bash
dirf flow "<task>"
```

**Optional: diagnostic preflight model advice.** Add `--models <file>` to `build`,
`plan`, `create`, or `flow` when the host can provide a portable catalog:

```json
{"models":[{"name":"fast-model","cost_tier":"low","capabilities":["testing"]}]}
```

DIRF records a suggestion for capabilities known before work begins, or says
that advice is unavailable. See the [model-advice contract](../skills/model-advice/README.md)
for the matching rules, recorded evidence, and boundaries.

**Optional: project playbooks.** `dirf build|plan|create ... --playbooks <dir>`
lets one explicitly supplied directory of playbooks participate in routing,
alongside DIRF's bundled set. Trust model:

- The directory is used **only when you pass the flag** — DIRF never scans a
  repository for playbooks.
- Each playbook must follow the same `playbooks/<name>/README.md` contract and
  passes the same validation as bundled playbooks; a malformed playbook fails
  the command before anything routes.
- A same-name playbook colliding with a bundled one is an error naming both
  sources — there is no silent override.
- Loading parses inert metadata and Markdown only: it never executes scripts,
  prompts, commands, installers, or source code from project playbooks.
- The generated workflow records `playbook_source` (`bundled`|`project`) and
  `playbook_source_path`, so every routed result is provenance-carrying.

### 3. Execute

Work the attempt's phases in order. Don't advance a phase until its done-when
check passes. Each per-agent detail file is self-contained (role, skills, job,
not-your-job, done-when). The handoff inside the attempt folder
(`attempts/<id>/HANDOFF.md`) is **attempt-scoped** — it's for resuming that
specific run, separate from the canonical project handoff.

**Gates.** Some playbooks declare gates on phases: `verify` (advancing past
requires recorded evidence), `decision` (requires a recorded accept/deny —
user-owned, per the Decision Ownership policy), `soft` (tracked; enforced only
with `--strict`). Record them explicitly:

```bash
dirf attempt advance <id> --evidence "<verify command>" [--output F]   # verify gates
dirf attempt gate <id> "<phase>" accept|deny --comment "…"             # decision gates (deny requires a comment)
dirf attempt advance <id> --auto [--strict]                            # cross covered phases, stop at gates
```

`dirf resume` lists any **pending gates** first so you reconcile them before
continuing, and replays recorded evidence for completed phases instead of
re-running them. A soft gate crossed without evidence is reported as `passed`;
it is history, not a pending blocker. Use `--strict` when soft gates must require
evidence before they can be crossed.

### Typed artifacts

Store artifact content inside the attempt folder first,
then record portable metadata and accept it explicitly:

```bash
dirf artifact record <id> --file artifact.json   # add is a compatibility alias
dirf artifact list <id> --json                   # includes governing accepted artifacts
dirf artifact accept <id> <artifact-id>
```

Metadata requires a stable `id`, a supported `type`, and an attempt-relative
`path`; `supersedes` may name earlier artifacts in the same attempt. Supported
types are `source`, `research_questions`, `research`, `lesson`, `design`,
`structure`, `plan`, `implementation_evidence`, and `plan_delta`. Recording
never implies acceptance. New acceptances bind the exact artifact bytes with
`accepted_sha256`; historical accepted artifacts without a digest remain valid.
When a decision gate declares `artifact_type`, both its accepted
decision record and the governing accepted artifact are required to advance.
For `plan_delta`, the referenced JSON must name the governing accepted plan and
contain all four evidence buckets: `implemented_as_planned`, `additions`,
`omissions`, and `unverifiable`.

`lesson` artifacts capture what the attempt retained: the disposition
(`adopt`/`adapt`/`experiment`/`reject`/`defer`/`no_change`), the source and
recommendation it derives from, and the verification evidence — recorded at the
learning loop's "verify and retain" phase so a justified no-change result is
bound as evidence exactly like an accepted experiment.

To resume an attempt later:

```bash
dirf resume <name-or-id>     # prints that attempt's workflow + handoff
```

### 4. Write the canonical handoff back (end of session)

This is the step that prevents drift for the next agent. When you stop, capture
the current state into the **canonical project handoff** so whoever (or whatever)
runs next — in this checkout, a worktree, or a fresh session — starts from
reality. Write it **before** switching sessions, agents, or worktrees — the
handoff comes first, the switch after (workflow policy: Handoff-Before-Switch):

```bash
# Write your updated handoff to a file, then promote it to the canonical store:
dirf state write-handoff --file new-handoff.md
```

The handoff should contain: objective, current phase, what you completed this
session (with file refs, not duplicated content), decisions/assumptions,
changed files, validation status, blockers, and the **exact next action**.
Reference existing specs/tickets/decisions rather than restating them.

## Commands at a glance

| Command | Purpose |
|---|---|
| `dirf state which` | which project am I in? (slug + store path) |
| `dirf state read-handoff` | read the project-wide handoff for diagnosis or recovery |
| `dirf state write-handoff --file F` | write the canonical handoff (end of session) |
| `dirf state list-attempts` | prior runs for this project |
| `dirf state get-attempt <id>` | one attempt's detail |
| `dirf state active [--json\|--hook]` | checkout-scoped idle, active, or conflict state |
| `dirf build <name> "<task>"` | route a task → instruction set in the store |
| `dirf learn [URL\|FILE\|TEXT]` | ingest one authorized source; a connected agent continues through read-only analysis to the decision gate without another user command |
| `dirf resume <name-or-id>` | load one attempt's workflow + handoff (lists pending gates) |
| `dirf attempt advance <id> [--evidence "CMD"] [--output F] [--strict] [--auto]` | advance one phase (gates enforced); `--auto` crosses covered phases and stops at gates |
| `dirf attempt gate <id> <phase> accept\|deny [--comment "…"]` | record a user-owned decision on a decision-gated phase (deny requires a comment) |
| `dirf attempt block <id> --reason R [--wait input\|blocker]` | block an attempt; `--wait input` marks it as awaiting user input |
| `dirf attempt observe <id> [--execution-status active\|idle\|unknown] [--file SNAPSHOT]` | trusted harness adapter refreshes the orchestrator-owned execution snapshot; requires `DIRF_ORCHESTRATOR_TOKEN` |
| `dirf attempt abandon <id> --reason "..."` | explicitly abandon an unfinished Attempt; requires the pre-bound `DIRF_ORCHESTRATOR_TOKEN` |
| `dirf artifact record <id> --file F` | validate and record one typed artifact metadata object (`add` is an alias) |
| `dirf artifact list <id> [--json]` | list artifacts and governing accepted versions |
| `dirf artifact accept <id> <artifact-id>` | explicitly accept a recorded artifact |
| `dirf review validate <review.json>` | validate a review artifact |
| `dirf review render <review.json>` | render a review artifact as Markdown |
| `dirf review ready <review.json>` | fail closed unless the exact PR is merge-ready |
| `dirf list` | list attempts (alias for state list-attempts scoped here) |
| `dirf state list` | all registered projects (works from anywhere) |
| `dirf portfolio` | cross-project status view: every project + attempt classified active/idle/stale/completed/archived/empty |
| `dirf project status [--json]` | reconciled project work view; JSON contains every attempt and continuation handoff |
| `dirf project complete\|archive\|reopen` | explicit project status override (derived classification otherwise) |
| `dirf export obsidian` | render the portfolio into an Obsidian vault (notes + canvas dashboard) |
| `dirf export graphify` | render the portfolio as a graphify graph + interactive HTML |
| `dirf skills scan` | show installed skills + resolved refs on this host |
| `dirf validate` | validate registries + workflows |

### Plain language

If you'd rather think in sentences, these natural-English forms do exactly the
same thing as the commands above (both forms always work):

| Plain English | Same as |
|---|---|
| `dirf where am i` | `state which` |
| `dirf show me the handoff` | `state read-handoff` |
| `dirf show me the projects` | `state list` |
| `dirf show me the portfolio` | `portfolio` |
| `dirf show me the attempts` | `state list-attempts` |
| `dirf start work on "<task>"` | `build <auto-name> "<task>"` (name generated for you) |
| `dirf plan "<task>"` | `flow "<task>"` (preview the skill flow without building) |
| `dirf save the handoff --file F` | `state write-handoff --file F` |
| `dirf what can i do` | print this help |

## Side observations (`dirf notice`)

Mid-attempt you'll spot things that are **not the current task** — a side bug, a
stale doc, a "should fix later." The destructive options are: fold it into the
status handoff (pollutes the signal — exactly the drift that breaks multi-session
work), derail the attempt to fix it (the "bleed"), or silently drop it. Use
`dirf notice` instead — a non-derailing channel that parks the note and lets you
continue.

```bash
dirf notice "Sidebar still uses text-white in 23 spots — separate from this task"
dirf notice list                       # read the current attempt's observations back
dirf notice list --project             # read the project-level (promoted) observations
dirf notice promote 2                  # lift entry #2 to project-level (survives sessions)
```

Rules (also enforced by the workflow policy embedded in every attempt):

- **Never put side observations in HANDOFF.md.** They are not status, decisions,
  or blockers — they're noise that doesn't belong in the resume document.
- **Do not act on a side observation in the current attempt.** Log it and continue
  with the task. If it genuinely blocks the task, it goes in `Blockers`, not here.
- **Observations are ephemeral to the attempt by default.** Promote one to
  project-level (`dirf notice promote <N>`) only if it should survive across
  sessions. Most don't.
- **This is not an issue tracker.** No status, assignee, priority. A timestamped
  log. Things needing real tracking graduate to the project's committed
  `tickets.md` (the `slice` lifecycle), not this channel.

## Worktrees

If you're working in a git worktree of the project, **nothing changes**: `dirf
state which` resolves to the same store entry as the main tree (via
`git-common-dir`), so you read and write the same canonical handoff. No
per-worktree setup, no per-worktree state. Two agents in two worktrees of the
same repo see each other's handoff updates through the store.

## Live work registry

`dirf project status --json` reconciles every Attempt in the current Project.
Each item keeps lifecycle state separate from observed runtime state and shows
the current harness session, worktree, Attempt Handoff, and exact next action.

Before any agents run, the trusted harness generates a high-entropy
`DIRF_ORCHESTRATOR_TOKEN` and binds it through the normal idempotent setup path:

```bash
DIRF_ORCHESTRATOR_TOKEN=<secret> dirf setup <project-path>
```

Observation cannot create or replace this authority record. The adapter keeps
the token stable for the Project and does not pass it to child agents. It then
reports ownership through one small command, providing its identity through
`DIRF_HARNESS` and `DIRF_SESSION_ID`; Codex may use `CODEX_THREAD_ID` instead:

```bash
DIRF_HARNESS=<name> DIRF_SESSION_ID=<id> DIRF_ORCHESTRATOR_TOKEN=<secret> \
  dirf attempt observe <attempt> --execution-status active --worktree <path>
```

`active` means the observation is fresh; it expires after five minutes without
a refresh. An old or missing observation never proves that work is running. A
fresh owner cannot be replaced by a different session, even with a transfer
reason. Once the owner is dormant, changing the owning session for that same
Attempt requires `--transfer-reason "..."`; DIRF records the previous owner and
reason rather than treating expiry as permission to take over. A worktree or
branch tied to another unfinished Attempt remains unavailable until that Attempt
is explicitly abandoned.

The orchestrator is the sole registry writer. It tells every child agent to
report its session, assignment, state, result, blocker, and handoff back to the
orchestrator. The adapter may submit those reports atomically with `--file`:

```json
{
  "children": [
    {
      "session_id": "child-17",
      "assignment": "Check the API contract",
      "status": "completed",
      "result": "Contract verified"
    }
  ]
}
```

Child status is bounded data, not authority: children do not call DIRF state
commands. Trusted setup pins only the token hash in the Project store; later
execution writes require the matching capability. A child marked
`blocked` changes the parent view only when the
orchestrator also sets `"blocks_parent": true`; child completion never completes
the Attempt. The owning adapter may use
`dirf attempt abandon <id> --reason "..."` with the same capability for explicit
abandonment; `dirf attempt reopen <id>` resumes it. DIRF never infers abandonment
from a stale heartbeat.

This guard prevents unauthorized CLI takeover. It is not a security boundary
against a process that can freely edit the DIRF store; harnesses must keep the
token and canonical state mutation tools out of untrusted child sandboxes.

Codex refreshes automatically when `CODEX_THREAD_ID` and
`DIRF_ORCHESTRATOR_TOKEN` are present during `dirf state active`. Other harnesses
set `DIRF_HARNESS`, `DIRF_SESSION_ID`, `DIRF_ORCHESTRATOR_TOKEN`, and optional
`DIRF_EXECUTION_STATUS` before the same startup command.

## Portfolio (cross-project overview)

`dirf portfolio` shows **every registered project on the machine**, not just the
one you're in — useful at session start to see what's live, what's abandoned,
and what's finished:

- **active** — at least one Attempt has a fresh harness observation reporting
  active work.
- **idle** — unfinished work exists, but no fresh harness observation reports
  active work.
- **completed** — all tracked attempts done, or the canonical handoff carries
  `## Status: Complete.`
- **stale** — no live work and no project activity past the threshold;
  abandonment is never inferred.
- **archived** / **empty** — explicitly parked, or registered with no attempts.

Status is derived from store data, so it can't drift; `dirf project
complete|archive` adds an explicit override when derived would be wrong, and
`dirf project reopen` clears it. `dirf portfolio --json` is the machine-readable
form — the flow-board desktop app consumes the same shape.

Status is **evidence-aware**: an attempt whose HANDOFF.md carries a completion
marker (`## Status: Complete.` or a filled-in `## Completed` section) is
reported as `done` even when its lifecycle was never updated, provided its
workflow has no pending gates. If past sessions
did the work without updating lifecycle state, promote the evidence once:

```bash
dirf attempt sync-from-handoff            # backfill done status from handoff evidence
```

And keep it honest going forward — `dirf resume` auto-starts a planned attempt,
and `dirf record-progress "what changed" --attempt <id> --phase X --next "next step"`
advances that attempt's lifecycle to match the phase being reported (start →
in_progress → advance). `--attempt` may be omitted only when the project has zero
or one attempt; use the full attempt ID when a name is reused. Explicit
completion (`dirf attempt complete --confirm`) stays a deliberate final gate.
If the final phase declares a verify command, pass its evidence with
`--evidence "<exact command>" [--output "<result>"]`; final decision and
artifact gates must also be satisfied before completion.

To hand the portfolio to a human: `dirf export obsidian` writes notes + a
color-coded `.canvas` dashboard into the active Obsidian vault, and `dirf export
graphify` renders an interactive HTML graph (`graphify-out/graph.html`). Both
are regenerable exports of the same snapshot — re-run to refresh.

## If you hit a conflict error

If `dirf state which` or `read-handoff` fails with *"Local HANDOFF.md is newer
than canonical"* — it means a per-checkout `.dirf/HANDOFF.md` has been edited
more recently than the store's copy (someone bypassed the store). DIRF refuses
to proceed rather than silently pick a winner. Resolve it explicitly:

```bash
dirf state import-handoff          # promote the local copy into the store (prompts)
dirf state import-handoff --force  # same, no prompt
```

`import-handoff` **backs up the store's current handoff first** (to
`HANDOFF.md.<ts>.bak`), so promoting a local copy can never destroy the
canonical one. After importing, the local copy is inert — you can leave it or
delete it; the store is now canonical.

## Migration (one-time, automatic)

If the project has a legacy `.dirf/` from before DIRF used the central store,
running `dirf setup` (or the first `dirf` command that resolves the project)
migrates it into the store: config upgraded to schema v2, attempts and handoff
moved in. A backup is left at `.dirf.migrating.<ts>/` until you run:

```bash
dirf state migrate-cleanup     # removes migration backups once the store looks right
```

## Anti-patterns (don't do these)

- **Reading `.dirf/HANDOFF.md` directly.** It's a stale legacy copy or a
  migration leftover. Use `dirf state read-handoff`. This is the exact behavior
  that caused the real-world drift this design exists to prevent.
- **Writing `.dirf/HANDOFF.md` directly.** It won't be seen by other checkouts
  and will eventually trip the conflict check. Use `dirf state write-handoff`.
- **Copying a handoff between checkouts by hand.** Unnecessary — both checkouts
  share the store entry. Write once, read from either.
- **Treating the per-attempt `HANDOFF.md` as the project handoff.** The attempt
  handoff is run-scoped. The canonical handoff is project-wide state, but normal
  startup still begins with `dirf state active` so DIRF can name the right
  workflow and handoff for the current checkout.
- **Starting work without resolving checkout responsibility.** Run
  `dirf state active` first. Reuse the reported active attempt, build new work
  only when idle, and never select the latest attempt automatically.

## Zero dependencies

DIRF is pure Node.js built-ins — no `npm install`, no `node_modules`. If `node`
is on the path, DIRF works. The MCP server (`src/mcp.js`) is the same: hand-rolled
stdio JSON-RPC, no SDK.
