# Episode 4 — Agnostic agent workflows

## Production card

**Primary title:** One Agent Workflow Across Codex, Claude, and Cursor

**Alternative title:** Agent Skills, AGENTS.md, MCP, and the Portable Workflow

**Thumbnail A:** `ONE ROUTE. MANY HOSTS.`

**Thumbnail B:** `AGNOSTIC, PROVEN`

**Target runtime:** 9–11 minutes

**Primary framework:** FAB, edited through ACCA

**Test first:** Alternative title for a standards-aware audience; primary title
for broader search. Use the same finished video and test packaging rather than
changing the promise inside the episode.

**CTA:** Run `dirf skills scan --path <project>`.

## Alternate cold opens

### Version A — mechanism-led

During research on this machine, DIRF discovered 321 installed skills. Loading
all 321 bodies would be absurd. DIRF loaded the metadata tier, selected the
capabilities this task needed, and left the rest on disk.

### Version B — standards-led

AGENTS.md gives the repository stable instructions. Agent Skills provide
reusable procedures. MCP connects tools and data. DIRF uses those pieces to
build and preserve a task-specific operating route.

## Chapters

| Time | Chapter |
|---|---|
| 00:00 | Agnostic needs proof |
| 00:45 | Four layers people mix up |
| 02:10 | How DIRF discovers skills |
| 04:00 | Routing by capability |
| 05:35 | Progressive disclosure |
| 06:45 | Portable output and human HTML |
| 08:00 | MCP and the one-core rule |
| 09:10 | The portability limit |

## Voiceover and visual direction

### 00:00 — Agnostic needs proof

**VOICEOVER**

“Agnostic” is one of those software words that can mean anything after a few
meetings.

For DIRF, it has to show up in observable behavior.

During research on this machine, DIRF discovered 321 installed skills across
the roots it scanned. It did not load 321 instruction bodies into this task.
It used the metadata tier to decide what was relevant, routed the required
capabilities, and left unrelated detail on disk.

In this episode, I will show the four layers people often mix together: project
instructions, reusable skills, external tools, and the task-specific workflow.

**VISUAL**

- Start with the live skills-scan summary from recording day.
- Hundreds of metadata labels stay small; three selected skills expand.
- Display research snapshot date beside any number.

### 00:45 — Four layers

**VOICEOVER**

Layer one is project instruction.

AGENTS.md is an open format for telling coding agents how to work in a
repository: setup commands, test rules, style, security notes, and contribution
conventions. The closest relevant file can provide more specific instruction.

Layer two is reusable procedure.

The Agent Skills specification defines a skill folder with a `SKILL.md` file and
optional scripts, references, and assets. The description helps the agent decide
when to load the full instructions.

Layer three is connection.

MCP gives an agent a standard way to reach tools, data, and external systems.

Layer four is the operating route for this task.

That is DIRF's main job. It reconciles the task, repository, playbook, roles,
capabilities, checks, and handoff into one attempt.

Those layers can cooperate. They should not be flattened into one giant prompt.

**VISUAL**

- Four stacked layers with distinct shapes.
- AGENTS.md remains under the project.
- Skills fan into the route.
- MCP connects from the side.
- Attempt and handoff continue to the right.

### 02:10 — Discovery

**VOICEOVER**

DIRF scans common project and user locations for skills and agent definitions.
It reads the lightweight metadata first. It can recognize `SKILL.md`, and the
current implementation also has fallbacks for other documented skill shapes.

The project path matters. A global security skill may exist on the machine,
while a repository-local release skill applies only to this codebase. Passing
`--path` lets DIRF inspect both the host and the target project.

Discovery is not an endorsement. A found skill can still be poorly written,
outdated, or unsafe. DIRF reports metadata warnings and trusted-source gaps; it
does not turn “installed” into “verified good.”

Missing optional capabilities are reported as gaps. DIRF should ask before
suggesting an installation or local derivation. It should never invent a path
to a tool that is not there.

**VISUAL**

- Show global and project-local skill roots.
- Live `dirf skills scan --path <project>`.
- Highlight installed, gap, warning, and user-invoked-only states.

### 04:00 — Routing by capability

**VOICEOVER**

A playbook asks for capabilities, not a vendor shopping list.

A pull-request review may need code review, security review, and testing. A
research plan may need discovery, domain modeling, primary-source research,
specification synthesis, ticketing, and handoff.

DIRF matches those needs against the discovered index. Exact identity can win
where appropriate. Otherwise descriptions, tags, and capability metadata help
choose the best installed match.

The generated attempt keeps the capability name and a provider hint. It does
not make an absolute path on Gary's Windows machine part of the workflow's
identity.

That is the practical meaning of host-neutral output: the route describes what
the stage needs. The current host resolves how it can supply it.

**VISUAL**

- Task terms enter a playbook.
- Capability requests move into the discovered index.
- Selected provider paths fade into provider hints in the saved attempt.

### 05:35 — Progressive disclosure

**VOICEOVER**

Portability does not help if every useful instruction floods the context.

DIRF uses a small router and one level of lazy detail. The top README tells the
agent which stage comes next. The active role file includes its job, boundaries,
skills, and done-when checks. A referenced skill can then load its own focused
detail.

The important constraint is one level at a time. A chain of references that
opens the entire library would recreate the problem under a nicer folder name.

On the research machine, the scan estimated a very large eager total and a much
smaller metadata tier. Treat that as an inspectable snapshot, not a universal
token benchmark. The product mechanism is stable: unread files stay unread.

**VISUAL**

- Metadata labels visible, bodies closed.
- Router opens one role; role opens one required reference.
- Show “snapshot, not benchmark” beside any token estimate.

### 06:45 — Two reading surfaces

**VOICEOVER**

DIRF saves Markdown as the authoritative instruction set. That is the agent
surface and the portable artifact.

It also renders an HTML view of the same structure. That is the human surface.
The person can inspect the objective, phases, roles, and detail without reading
raw frontmatter or asking the model to summarize its own instructions.

The HTML is regenerable. It does not become a second source of truth.

This sounds small. It prevents a common problem: the agent follows one artifact
while the person approves another slide deck that drifted last Tuesday.

**VISUAL**

- Markdown and HTML side by side.
- Same objective and phase highlight on both.
- A single source arrow points from Markdown to HTML.

### 08:00 — MCP and one core

**VOICEOVER**

DIRF also ships an optional MCP server for hosts that speak MCP.

The CLI and MCP server are thin shells over the same state module. Reading a
handoff through MCP and reading it through the CLI should return the same state.

That “one core, two shells” rule matters more than having two interfaces. If the
CLI and MCP implementations each owned their own project resolution or handoff
logic, portability would create drift instead of preventing it.

MCP connects the host to DIRF's state operations. DIRF still owns the workflow
and attempt contract. They solve different layers.

**VISUAL**

- `src/state.js` in the center.
- CLI and MCP as two thin edges.
- Same handoff bytes exit both sides.

### 09:10 — Honest limit and close

**VOICEOVER**

Host-neutral Markdown is not a promise that every host supports every skill,
tool, permission model, or subagent feature.

DIRF can preserve the requested capability, provider hint, boundaries, and
completion checks. The active environment still needs to resolve and execute
them. When it cannot, the workflow should surface the gap instead of pretending
the stage happened.

That is why the first useful command is a scan.

Run `dirf skills scan --path <project>`. Look at what is installed, what is only
recommended, which descriptions route cleanly, and which warnings need work.

In the final episode, I will zoom out from one task to multiple projects,
worktrees, handoffs, portfolio state, and approval-aware execution.

**VISUAL**

- Command card: `dirf skills scan --path <project>`
- End card to episode 5.

## Shorts extraction markers

1. “Agnostic needs proof” with the 321-skill snapshot.
2. AGENTS.md versus Agent Skills versus MCP versus DIRF.
3. Installed does not mean verified good.
4. Metadata tier versus lazy detail.
5. “One core, two shells.”

