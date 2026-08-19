# Agent Guide — using DIRF against a project

This is the guide for an AI agent using **DIRF** (Do It Right First) as a tool
against a host project — any repo DIRF has been set up for. If you're
contributing to the amf-dirf repo itself, read
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

`dirf` is a shell function/alias pointing at `node <path-to-amf-dirf>/src/cli.js`.
If `dirf state which` works, you're set up. If not, the host hasn't installed
the alias — fall back to the full path:

```bash
node /path/to/amf-dirf/src/cli.js state which
```

(Adjust the path to wherever amf-dirf lives on this machine.)

## Session lifecycle

### 1. Orient (start of every session)

```bash
dirf state which              # confirm which project this checkout resolves to
dirf state read-handoff       # the canonical handoff — read this FIRST
dirf state list-attempts      # see prior runs
```

`dirf state which` tells you the slug and store path. The slug is derived from
`git rev-parse --git-common-dir`, so **the main tree and any worktree resolve to
the same store entry** — you'll get the same handoff regardless of which
checkout you start in. That's the point.

`dirf state read-handoff` prints the canonical handoff. This is your starting
context: objective, current phase, what's done, decisions, blockers, the exact
next action. Treat it as authoritative.

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
re-running them.

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
types are `source`, `research_questions`, `research`, `design`, `structure`, `plan`,
`implementation_evidence`, and `plan_delta`. Recording never implies
acceptance. New acceptances bind the exact artifact bytes with `accepted_sha256`;
historical accepted artifacts without a digest remain valid. When a decision
gate declares `artifact_type`, both its accepted decision record and the
governing accepted artifact are required to advance.
For `plan_delta`, the referenced JSON must name the governing accepted plan and
contain all four evidence buckets: `implemented_as_planned`, `additions`,
`omissions`, and `unverifiable`.

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
| `dirf state read-handoff` | print the canonical handoff (read this first) |
| `dirf state write-handoff --file F` | write the canonical handoff (end of session) |
| `dirf state list-attempts` | prior runs for this project |
| `dirf state get-attempt <id>` | one attempt's detail |
| `dirf build <name> "<task>"` | route a task → instruction set in the store |
| `dirf learn [URL\|FILE\|TEXT]` | ingest one authorized source, prepare an approvable recommendation, then allow at most one accepted reversible experiment |
| `dirf resume <name-or-id>` | load one attempt's workflow + handoff (lists pending gates) |
| `dirf attempt advance <id> [--evidence "CMD"] [--output F] [--strict] [--auto]` | advance one phase (gates enforced); `--auto` crosses covered phases and stops at gates |
| `dirf attempt gate <id> <phase> accept\|deny [--comment "…"]` | record a user-owned decision on a decision-gated phase (deny requires a comment) |
| `dirf attempt block <id> --reason R [--wait input\|blocker]` | block an attempt; `--wait input` marks it as awaiting user input |
| `dirf artifact record <id> --file F` | validate and record one typed artifact metadata object (`add` is an alias) |
| `dirf artifact list <id> [--json]` | list artifacts and governing accepted versions |
| `dirf artifact accept <id> <artifact-id>` | explicitly accept a recorded artifact |
| `dirf list` | list attempts (alias for state list-attempts scoped here) |
| `dirf state list` | all registered projects (works from anywhere) |
| `dirf portfolio` | cross-project status view: every project + attempt classified active/stale/completed/archived/empty |
| `dirf project complete\|archive\|reopen\|status` | explicit project status override (derived classification otherwise) |
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

## Portfolio (cross-project overview)

`dirf portfolio` shows **every registered project on the machine**, not just the
one you're in — useful at session start to see what's live, what's abandoned,
and what's finished:

- **active** — open work (in_progress/blocked attempts) or activity within the
  staleness threshold (`settings set --stale-project-days N`, default 30).
- **completed** — all tracked attempts done, or the canonical handoff carries
  `## Status: Complete.`
- **stale** — nothing open and no activity past the threshold.
- **archived** / **empty** — explicitly parked, or registered with no attempts.

Status is derived from store data, so it can't drift; `dirf project
complete|archive` adds an explicit override when derived would be wrong, and
`dirf project reopen` clears it. `dirf portfolio --json` is the machine-readable
form — the flow-board desktop app consumes the same shape.

Status is **evidence-aware**: an attempt whose HANDOFF.md carries a completion
marker (`## Status: Complete.` or a filled-in `## Completed` section) is
reported as `done` even when its lifecycle was never updated. If past sessions
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
  handoff is run-scoped (for resuming that attempt via `dirf resume`). The
  canonical project handoff (`dirf state read/write-handoff`) is what the next
  session should read.
- **Starting work without reading the canonical handoff.** Always
  `dirf state read-handoff` first — it's the current truth.

## Zero dependencies

DIRF is pure Node.js built-ins — no `npm install`, no `node_modules`. If `node`
is on the path, DIRF works. The MCP server (`src/mcp.js`) is the same: hand-rolled
stdio JSON-RPC, no SDK.
