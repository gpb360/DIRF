# DIRF — Do It Right First

![A DIRF workflow ending in a verified check](docs/assets/dirf-hero.png)

DIRF turns a task into a small workflow for your coding agent. It inspects the
project, finds the available skills and agents, and records the steps,
boundaries, checks, and next action. You get Markdown instructions and an HTML
view of the same workflow.

Each run is saved as an **attempt**. A later session can read its workflow and
handoff to continue the work. DIRF prepares and records the work; your agent
host executes it, and you control consequential actions.

Requires Node.js 22 or newer and Git. The CLI has no runtime dependencies.

## Start using DIRF

```bash
git clone https://github.com/gpb360/DIRF.git
cd DIRF
node src/cli.js --help

# Set up your project once, then create a workflow.
node src/cli.js setup "../my-project"
node src/cli.js build first-run "fix the checkout timeout" --path "../my-project"
```

Open the saved attempt's `README.md` and give it to your agent as its operating
workflow. Setup may add missing support documents and a Git ignore rule to the
target project. Review those changes before committing them.

For a `dirf` command available across projects, run `npm install -g .` from an
intentional, tested checkout. This may link the command to that checkout: later
edits or branch switches can change the installed command. Use `dirf doctor`
to check the executable, revision, and project store.

See [Project integration](docs/integration.md) for CLI, MCP, updates, and
team setup.

## Continue a task

From the project checkout, start with:

```bash
dirf state active
```

- **Active:** follow the reported attempt and its next action.
- **Idle:** create a workflow for new work.
- **Conflict:** resolve which attempt owns the checkout before continuing.

Use `dirf resume <attempt-id>` to claim a named planned attempt. Do not select
an attempt by recency alone. Record progress against its ID and actual phase:

```bash
dirf record-progress "What changed and what passed" \
  --attempt <attempt-id> --phase "<workflow phase>" --next "One concrete action"
```

Coordination state lives in `~/.dirf/projects/<slug>/`. Worktrees of the same
repository share that store, while each attempt keeps its own handoff and
checkout responsibility.

## Common tasks

```bash
dirf build fix-login "fix the login timeout"
dirf build review-change "review this pull request"
dirf build architecture-audit "read-only architecture audit; use unslop"
dirf plan next-feature "plan a new export format"
dirf flow "review this pull request"
dirf learn https://example.com/article
```

`flow` previews the route. `build` saves a workflow. `plan` records decisions
and implementation steps. A read-only audit can finish with unresolved
findings and recommendations.

`learn` saves a supplied article, file, transcript, or pasted text with its
source hash. Source content remains untrusted reference material. Analysis
stops at a human decision before implementation. See the
[learning and workflow reference](docs/reference.md).

PR reviews use the [`pr-review` playbook](playbooks/pr-review/README.md) and
[`code-review` skill](skills/code-review/README.md). A review is complete only
after findings are resolved, the corrected behavior is verified, and a fresh
review covers the current revision. A mock score or green build cannot prove
merge readiness.

## Skills and agent hosts

DIRF maps required capabilities to skills and agents available on the current
host. Missing optional capabilities appear as gaps. It works with Codex,
Claude, Cursor, other hosts, or a person reading the workflow.

Public skill IDs remain stable so saved workflows keep resolving. Headings
and descriptions explain what a skill does. Optional
[model suggestions](skills/model-advice/README.md) use a host-supplied catalog;
they do not invoke models or authorize spending.

## Documentation

- [Agent guide](docs/AGENT_GUIDE.md): operate DIRF in a project.
- [Project integration](docs/integration.md): install, connect MCP, and update.
- [Reference](docs/reference.md): commands, planning modes, governance, exports,
  state, and optional local hooks.
- [Authoring guide](docs/writing-great-playbooks.md): write skills, agents, and playbooks.
- [Shared state design](docs/design/central-state.md): how worktrees share state.
- [ZCode prompt](docs/dirf-zcode-system-prompt.md): host configuration example.
- [Changelog](CHANGELOG.md): changes and retired interfaces.

## Contribute

Read [AGENTS.md](AGENTS.md), then install the development-only tools:

```bash
npm ci --ignore-scripts
npm run check:release
```

The release check runs registry validation, JavaScript syntax checks,
incremental type checks, the full tests, CLI smoke, and repository/package
publication screening. GitHub CI runs those checks on Node.js 22.

Type checking currently covers JavaScript modules marked with `@ts-check`,
including public HTTPS intake, publication screening, and check scripts. It
does not yet cover every source module. The other JavaScript files receive
syntax checks and regression tests.

Keep generated attempts, personal host configuration, and secrets outside the
published tree. Sanitized `.env.example`, `.env.sample`, and `.env.template`
files are allowed, but are still scanned for secret patterns. Publication
screening is a limited check, not a guarantee that no private data exists.

MIT license — see [LICENSE](LICENSE).
