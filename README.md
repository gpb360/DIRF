# Do It Right First

![DIRF: a routed workflow ending in a verified check](docs/assets/dirf-hero.png)

DIRF turns a task into a small, executable instruction set for AI coding agents.
It inspects the target repository, maps the capabilities actually installed on
the host, assigns bounded roles, and leaves behind a human-readable workflow.

**AMF** = Agent Marketing Factory · **DIRF** = Do It Right First.

> Requires Node.js ≥ 18.17. Zero dependencies. No `npm install`.

## Zero to running — paste this into your AI

No manual install needed. Copy this prompt into your model of choice and it
will clone DIRF, set it up against your project, build your first workflow,
and execute it:

```text
Set up and run DIRF (Do It Right First), an agent workflow kit, against my project.

1. Clone https://github.com/gpb360/amf-dirf.git into a sibling folder of my
   project. It needs Node.js >= 18.17 and nothing else — zero dependencies,
   do not run npm install.
2. Ask me two things before touching anything: the path to my project, and my
   task in one sentence.
3. Run: node <dirf>/src/cli.js setup <my project>
4. Run: node <dirf>/src/cli.js build <short-name> "<my task>" --path <my project>
5. The build prints an attempt folder. (If the project already had a legacy
   `.dirf/`, setup migrates it into DIRF's central store at
   `~/.dirf/projects/<slug>/` and leaves a backup; otherwise the attempt just
   lives in the store.) Open that attempt folder's README.md and follow it as
   your operating workflow: act as one agent role at a time, work the phases
   in order, and do not advance a phase until it is verifiably done.
6. If any command fails, stop and show me the exact command and its output
   instead of improvising around it.
```

Every generated workflow also embeds its own kickoff prompt, so you can hand
individual workflows to any model later without repeating these steps.

## What DIRF helps with

- **Wrong skills:** resolves capabilities from the current repo and host instead
  of assuming every machine has the same tools.
- **Prompt drift:** keeps the objective, role boundaries, policy, and done-when
  checks inside the generated artifact.
- **Bloated context:** loads one small router first, then only the detail needed
  for the active stage.
- **Weak handoffs:** produces durable markdown for agents and a matching HTML
  view for people.
- **Skipped verification:** makes evidence and completion checks part of the
  workflow, not an afterthought.

## How DIRF is different

| Typical agent setup | DIRF |
| --- | --- |
| One large prompt | A small router with lazy-loaded detail |
| Hardcoded skill names | Capability requests resolved against installed skills |
| Missing tools fail silently | Gaps are explicit and approval-gated |
| Instructions tied to one agent host | Portable, host-neutral workflow snapshots |
| “Done” means the agent stopped | Done-when checks and evidence travel with the task |

DIRF is the preflight layer. It does not replace Codex, Claude, or another
executor; it gives that executor a repo-aware route before work begins.

## Quick start

```bash
git clone https://github.com/gpb360/amf-dirf.git
cd amf-dirf

# One-time setup for the repository you want DIRF to work on
node src/cli.js setup ../my-project --reserve-percent 5

# Task -> routed workflow -> lean markdown + human HTML
node src/cli.js build first-run "fix the checkout timeout" --path ../my-project
```

Open the generated attempt's `README.md` (the path is printed by `build`; it
lives under DIRF's central store at `~/.dirf/projects/<slug>/attempts/<id>/`,
and `dirf state which` will show you the store path for the current project).
It contains the ordered workflow and the handoff your agent host should execute.

Useful next commands:

```bash
node src/cli.js flow "review this pull request" --path ../my-project
node src/cli.js skills scan
node src/cli.js list --path ../my-project
node src/cli.js state which --path ../my-project   # show the project's canonical store entry
node src/cli.js validate
```

## The pipeline

```
task description or folder README
  │
  ▼  router (keywords + what-the-playbook-does content match)
workflow folder
  │   agents[]         each: {name, file, tags, skills[]}
  │   baseline_skills[]   cross-cutting skills for the whole workflow
  │
  ▼  renderer (reads each agent .md + resolves skills against the live index + policy)
  │
  ├─► lean MARKDOWN instruction set  (what the AI consumes — token-cheap)
  │     one router README + one lazy-loaded detail file per agent + policy
  │
  └─► HTML render of the SAME structure  (human-browsable, expand-on-demand)
        summary index + collapsible per-agent sections
```

**Markdown is source; HTML is the render** of the same lean structure.

## Output structure (lean, progressive disclosure)

```
~/.dirf/projects/<slug>/attempts/<timestamp>-<name>/
├── attempt.json                        # portable attempt identity
├── workflow.json                       # resolved workflow snapshot
├── README.md                           # authoritative router and frontmatter
├── policy.md                           # the workflow policy (one level deep)
├── agents/
│   ├── frontend-developer.md           # lazy-loaded detail per agent
│   └── ...
└── instructions.html                   # self-contained human render (gitignored)
```

The AI loads `README.md` first, follows its ordered folder references, then
loads only the detail file required by the active stage.
Unread files cost zero tokens.

Each attempt carries its own `HANDOFF.md` (written by `build`) for resuming that
specific run. Separately, DIRF keeps one **canonical project handoff** in the
central store (`~/.dirf/projects/<slug>/HANDOFF.md`) — the single source of
truth a fresh agent session should read regardless of which checkout it starts
from. Manage it with `dirf state read-handoff` / `dirf state write-handoff`.

Status updates, validation summaries, and handoffs use **focused output** by
default: result first, concrete evidence, at most five list items, and one next
action. Disable it for a run with `--no-focused-output`. Hosts that expose
remaining context trigger the handoff at the context-reserve threshold;
otherwise the workflow checkpoints after each completed phase. A different
model can continue a specific attempt with `dirf resume <name-or-id> --path <project>`.

Each per-agent detail file is self-contained: role, **USE THESE SKILLS**
(resolved live from the host index, with installed/recommended status),
**YOUR JOB** (from the agent markdown), **NOT YOUR JOB** (boundary), and a
done-when checklist.

## CLI reference

```
# building workflows
dirf setup [path] [--tracker local] [--context single|multi] [--reserve-percent 5]
dirf build  <name> "<task>" [--path DIR] [--open]   full pipeline: route -> JSON -> md + html
dirf plan   <name> "<task>" [--path DIR] [--research] discovery through handoff, without implementation
dirf create <name> "<task>" [--path DIR]             route -> workflow JSON only
dirf render <name-or-id> [--path DIR] [--open]       render the latest matching attempt
dirf list [--path DIR]                               list a project's attempts
dirf resume <name-or-id> [--path DIR]                load one attempt's workflow + HANDOFF.md
dirf migrate [<name-or-id>]                          refresh legacy schema 2–5 attempt snapshots
                                                      (not the same as `state migrate-cleanup`)

# central state (canonical store — see "Canonical state" below)
dirf state which [--path DIR]                        what project am I in? (slug + store path)
dirf state list                                      list all registered projects
dirf state register [--path DIR]                     register a project explicitly
dirf state read-handoff [--path DIR|--slug S]        print the canonical project handoff
dirf state write-handoff --file FILE|- [...]         write the canonical project handoff
dirf state list-attempts [--path DIR|--slug S]       list attempts for a project
dirf state get-attempt <id> [...]                    show one attempt
dirf state import-handoff [--path DIR] [--force]     promote a local HANDOFF.md into the store
dirf state migrate-cleanup [--path DIR]              remove migration backup(s) once the store works

# portfolio (cross-project view — see "Portfolio" below)
dirf portfolio [--json]                              classify every project: active/stale/completed/archived/empty
dirf project <complete|reopen|archive|status> [...]  explicit project status override
dirf export obsidian [--out DIR]                     export the portfolio into an Obsidian vault (notes + canvas)
dirf export graphify [--out DIR] [--skip-render]     export the portfolio as a graphify graph (+ HTML render)

# inspection + registries
dirf skills scan [--path DIR]                        scan host, show installed skills + resolved refs
dirf inspect [<path>]                                detect a project's optimization stack + suggest gaps
dirf flow "<task>" [--path DIR]                      show the ordered skill flow for a task
dirf validate                                        validate registries + workflows
dirf validate <folder>                               validate one folder DAG
dirf graph <folder>                                  show deterministic execution order
dirf run <folder>                                    emit the execution handoff
dirf render <folder>                                 generate its human HTML view
```

Run `node src/cli.js` with no arguments for help.

### Plain language

Prefer sentences to subcommands? These natural-English forms do the same thing
(both always work):

```bash
dirf where am i                    # → state which
dirf show me the handoff           # → state read-handoff
dirf show me the attempts          # → state list-attempts
dirf show me the portfolio         # → portfolio
dirf start work on "fix the bug"   # → build <auto-name> "fix the bug"
dirf save the handoff --file h.md  # → state write-handoff --file h.md
dirf what can i do                 # → help
```

## Folder contract

DIRF uses four separate filesystem units with one small README-frontmatter
interface: `skills/`, `tools/`, `playbooks/`, and `workflows/`. Skills contain
bounded task directions; tools contain invocation and safety details; playbooks
compose reusable work; workflows bind a concrete task. References form an
ordered DAG, execute once, reject cycles, and lazy-load optional details.

This provides filesystem-first definitions, bounded context, modular execution,
approval before side effects, and traceable evidence. Markdown is source, HTML
is a generated human view, and the zero-dependency JavaScript CLI is the resolver.

The previous committed `workflows/user/*.json` files were generated snapshots,
not authored workflows, and were removed. `dirf migrate` (a one-off schema
refresh for very old snapshots) is unrelated to `dirf state migrate-cleanup`
(which removes `.dirf.migrating.*` backups left by the central-store cutover).

Generated attempts are host-neutral. Claude, Codex, another agent, or a person
can execute the same README. Repository and installation paths are discovered
for the current run only; snapshots retain capability names and provider hints.
DIRF coordination state is canonical and central (`~/.dirf/projects/<slug>/`).
Worktrees resolve to the same store entry automatically via `git-common-dir`,
so no per-worktree setup is needed and state cannot drift between checkouts. If
a task needs scratch isolation, keep it inside the worktree workspace.

## How skill mapping works (the heart of "right")

The kit ships a small editable vocabulary in `registry/skills.json` that enriches
discovered metadata. Playbooks request capabilities; they do not force skill names.
DIRF deterministically selects the best installed match for each stage and keeps
missing capabilities out of the executable flow.

```json
{"name": "impeccable", "category": "quality",
 "applies_to": ["frontend-developer", "ui-designer"],
"summary": "product-quality review using YAGNI, DRY, and KISS"}
```

At build time, `discover()` scans the host environment and resolves each
reference:

- **installed** — found in a scanned root (path included)
- **capability gap** — no installed match; DIRF asks before suggesting or creating anything

**Scan roots** (all optional): `~/.agents/skills/`, `~/.codex/skills/`,
`~/.claude/skills/`, `~/.zcode/.../skills/`, plus project-local equivalents.
Discovery reads `SKILL.md` first, falling back to `skill.json` then `README.md`
— so skills like `ui-ux-pro-max` (no `SKILL.md`) and `superpowers` (under a
plugin cache) are still found.

**Scoping with `--path`:** pass `--path <project>` to scan *that* project's
local skill folders in addition to the global roots, so the instruction set
reflects the target project's skills (e.g. a repo's own `.agents/skills/`).

### Agents follow the same contract

DIRF also discovers the **agents** installed on the host (`~/.agents/agents/`,
`~/.codex/agents/`, `~/.claude/agents/`, plus project-local equivalents and a
project `agents/` folder). Playbook roles are cast against that index — exact
name match first, then name/tag overlap. The 21 agent definitions bundled in
this repo's `agents/` folder are **defaults of last resort**: they fill a role
only when no installed agent matches, the role is labeled `bundled default` in
the roster, and when a host has no agents at all the workflow opens with an
explicit question asking whether to use them. Your own agents always win.

## Making it yours

- **Add an agent**: drop a markdown file in `agents/` (frontmatter: `name`,
  `description`, `tools`), add an entry to `registry/agents.json` with its
  `skills` refs.
- **Add a skill to the vocabulary**: add an entry to `registry/skills.json`.
  The kit resolves it against whatever's installed on each host.
- **Add a playbook**: create `playbooks/<name>/README.md`; the JSON registry is
  compatibility output, not the editable source.
- **Trust skill sources**: create `~/.dirf/trusted-sources.json` or
  `<project>/.dirf/trusted-sources.json` with a `sources` array. Each source may
  declare `name`, `url`, and `capabilities`. DIRF only suggests configured sources
  and always requires approval before installation or local derivation.
- Then run `node src/cli.js validate`.

## Project layout

```
src/             CLI, folder resolver, router, discovery, renderer, validation, state core, MCP server
playbooks/       authoritative reusable playbook folders
skills/          bounded task-oriented skill folders
tools/           isolated tool invocation folders
registry/        agents, skill metadata, and legacy compatibility JSON
agents/          bundled default agents (fallback-only — installed host agents always win)
policies/        workflow-policy.md (embedded in every instruction set)
tests/           <domain>.test.js files using node:test
scripts/         smoke.js integration check
workflows/       authored reusable workflow folders
~/.dirf/projects/<slug>/  central store: config, attempts, canonical handoff (per-user, not committed)
```

## Canonical state (central store)

DIRF coordination state — config, attempts, and the handoff — lives in a
central store at `~/.dirf/projects/<slug>/`, keyed by a slug derived from
`git rev-parse --git-common-dir`. Every worktree of a repo resolves to the
**same** store entry, so state cannot drift between checkouts.

Quick commands:

```bash
dirf state which                 # what project am I in? (slug + store path)
dirf state list                  # all registered projects
dirf state read-handoff          # print the canonical handoff
dirf state write-handoff --file new-handoff.md
```

Existing per-target `.dirf/` directories migrate into the store when you run
`dirf setup` or on first resolve — either way a backup copy is left at
`.dirf.migrating.<ts>/` until you run `dirf state migrate-cleanup`. A local
`HANDOFF.md` newer than the store's is never overwritten silently — run
`dirf state import-handoff` to promote it (it backs up the canonical copy first).

## Portfolio (cross-project overview)

`dirf portfolio` is the at-a-glance view of **every registered project**, from
anywhere on the machine. It derives a status for each project and its attempts:

| Status | Meaning |
|---|---|
| `active` | open work (in-progress/blocked attempts) or activity within the staleness threshold |
| `completed` | all tracked attempts done, or the handoff carries `## Status: Complete.` |
| `stale` | nothing open and no activity past the threshold — likely abandoned |
| `archived` | explicitly archived (`dirf project archive`) |
| `empty` | registered but no attempts yet |

Classification is **derived by default** (it can never drift from the store) and
optionally overridden per project:

```bash
dirf portfolio                    # text table
dirf portfolio --json             # full machine-readable snapshot (also feeds the flow-board app)
dirf project status --slug S      # why is this project classified this way?
dirf project complete --slug S    # explicit "done" override
dirf project archive --slug S     # explicit "parked" override
dirf project reopen --slug S      # clear the override, back to derived
dirf settings set --stale-project-days 30
```

**Status is also evidence-aware.** Attempts whose HANDOFF.md carries a
completion marker (`## Status: Complete.` or a filled-in `## Completed` section)
are reported as `done` even if the lifecycle was never updated — the store's
`attempt.json` is never modified by the view. When the lifecycle has genuinely
drifted (work happened, status stayed `planned`), promote the evidence:

```bash
dirf attempt sync-from-handoff              # whole project: backfill done from handoff evidence
dirf attempt sync-from-handoff <id>         # or one attempt
```

And to keep the lifecycle honest going forward: `dirf resume` auto-starts a
planned attempt, and `dirf record-progress --phase X` advances the attempt to
that phase (start → in_progress, in_progress → advance). Completion still
requires the explicit `dirf attempt complete` gate.

### Obsidian export

```bash
dirf export obsidian              # into your active Obsidian vault (auto-discovered)
dirf export obsidian --out D      # or anywhere explicit
```

Writes `DIRF Portfolio/` into the target: one markdown note per project and per
tracked attempt (frontmatter status + `[[wikilinks]]`), an index `README.md`,
and `DIRF Portfolio.canvas` — a JSON Canvas dashboard with projects grouped by
status, color-coded, with edges to their attempts. The Obsidian graph view
connects everything through the wikilinks. Regenerable: re-run the export any
time; the folder is rewritten from the store.

### graphify export

```bash
dirf export graphify              # writes graphify-out/ and renders HTML
dirf export graphify --skip-render
```

Writes `graphify-out/graph.json` in graphify's own schema — project and attempt
nodes with typed edges (`references`, `conceptually_related_to`), built
deterministically, no LLM or API key required. If the graphify CLI is
installed, it re-clusters and renders `graph.html` + `GRAPH_REPORT.md`
(`graphify cluster-only … --no-label`); otherwise the exact command is printed.

### Optional MCP server

For agent hosts that speak MCP (Claude, Cursor), DIRF ships an optional
stdio JSON-RPC server exposing the same operations as tools. Zero-dependency,
no SDK:

```jsonc
// in your MCP client config
{ "command": "node", "args": ["<path-to-amf-dirf>/src/mcp.js"] }
```

Tools: `dirf_resolve_project`, `dirf_list_projects`, `dirf_read_handoff`,
`dirf_write_handoff`, `dirf_list_attempts`, `dirf_get_attempt`. Every tool is
a thin call into the same `src/state.js` core as the CLI, so the two surfaces
return byte-identical results.

## Conventions

- **Zero dependencies.** Pure Node.js built-ins (no `node_modules`, no `npm install`, no CI). `npm run …` works as a script shortcut; nothing gets installed.
- **One entry point:** `src/cli.js`.
- **Names:** kebab-case folders, domain-named source files, and `<domain>.test.js` tests.
- **Generated output:** `.dirf/attempts/`, `graphify-out/`, and HTML renders stay untracked.
- **Markdown playbooks are source; generated attempts and HTML are disposable** (gitignored).
- **Validate before you commit:** `node src/cli.js validate`.

## Running the tests

```bash
npm test                                   # all unit tests (node:test)
npm run test:router                        # router matching
npm run test:skills                        # discovery + resolver
npm run test:renderer                      # markdown + HTML rendering
npm run smoke                              # full pipeline integration
npm run validate                           # registry consistency
```

These are just script shortcuts — `npm run` executes them, no `npm install`,
no dependencies, no test runner to add. Prefer raw Node? `node --test`,
`node scripts/smoke.js`, and `node src/cli.js validate` do the same thing.
No CI — everything runs locally.

## Commit hooks

This repo ships a pre-commit guard in `.githooks/`. It keeps generated,
machine-local content out of tracked files — chiefly the `<claude-mem-context>`
blocks that memory tooling injects into `AGENTS.md`, which are noise for anyone
without that tooling and have a habit of collecting unrelated session data.

It also ships a review gate, which refuses to merge a branch unless the
incoming tip carries a recorded review score of 9 or better. The score lives
in a git note on the `reviews` ref, so it travels with the commit and needs
no tracked file:

```bash
git notes --ref=reviews add -m 'score: 9' <sha>
```

Only the first `score:` line is read; everything after it is free-form
rationale for whoever reads the note later. Change the bar with
`git config dirf.reviewThreshold N`.

Git does not enable any of this automatically. Once per clone:

```bash
git config core.hooksPath .githooks
git config merge.ff false      # required — see below
```

`merge.ff false` is not optional. Git creates no merge commit for a
fast-forward, so there is no hook to run and the gate is skipped entirely —
the merge lands unreviewed and silently. The setting forces a real merge
commit so the gate has something to refuse.

What the gate does **not** cover — worth reading, because a gate you believe is
on is worse than none:

- **`git rebase` and `git cherry-pick`** replay commits onto the branch without
  creating a merge commit, so no hook runs and nothing is checked. Since
  `merge.ff false` above adds friction to merging, rebase is the obvious way
  around the gate — deliberately or by habit.
- **`git commit --amend` on a merge commit** does not re-run the gate. The hook
  fires, but `MERGE_HEAD` is gone by then, so the review branch is skipped. The
  amended merge keeps both parents and the note that certified the *pre-amend*
  tree, so arbitrary content can be added under a passing review.
- **The conflict resolution itself is never reviewed.** A note certifies the
  incoming head — the commit you merged — not the tree you resolved it to. On a
  conflicted merge the gate checks the branch tip and says nothing about the
  resolution you hand-wrote afterwards.
- **`git merge --squash`** lands as an ordinary commit with no recorded parent
  to attribute a review to.
- **`--no-verify`** bypasses everything.
- **`dirf.reviewThreshold 0`** makes every note pass regardless of its score,
  since any recorded score clears a bar of zero.

This is a local guard, not an enforcement boundary. For something unbypassable
the check belongs in CI, where the branch's own commits can be checked rather
than just the merge parent.

Notes are not fetched by default. To see reviews recorded on another machine:

```bash
git fetch origin 'refs/notes/reviews:refs/notes/reviews'
```

Bypass a specific commit with `git commit --no-verify`.

## License

MIT — see [LICENSE](LICENSE).
