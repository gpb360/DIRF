# ADR-001: Position DIRF as an agent-work preflight and continuity layer

## Status

Proposed for campaign approval.

## Context

The current market already contains strong methods for specification-driven
development, agile agent teams, opinionated delivery lifecycles, and composable
skills. Positioning DIRF as a broader or “better” replacement would be hard to
prove and would hide its most unusual behavior.

DIRF inspects the project and capabilities installed on the current machine,
routes a task into a lean workflow, renders agent and human views, stores
canonical cross-session state, requires evidence at workflow gates, and can sit
beside existing methods. Current agent standards also favor portable Markdown,
Agent Skills, AGENTS.md, and MCP rather than one closed runtime.

## Decision

Position DIRF as:

> The preflight, routing, continuity, and evidence layer for agent work.

Use this campaign line:

> Keep your agent stack. Give it a route, a record, and a finish line.

Explain “agnostic” through observable behavior:

- DIRF scans installed skills and agents rather than requiring a fixed vendor
  catalog.
- Generated workflows preserve capability names and provider hints rather than
  machine-specific installation paths.
- Markdown remains authoritative; the HTML view is a human render.
- Codex, Claude, Cursor, another compatible host, or a person can execute the
  same operating instructions.
- Canonical state follows the repository across worktrees and sessions.

## Consequences

- Competitor videos become comparison and compatibility education, not attack
  content.
- The product demo must show an existing skill stack being discovered and used.
- Claims focus on mechanisms and visible output, not unsupported percentages.
- Live process monitoring, autonomous deployment, and issue tracking remain
  explicitly outside the promise.
- The launch serves experienced operators first; beginner onboarding becomes a
  later, shorter series after the core category is understood.

## Rejected alternatives

### “The complete AI development framework”

Too broad. BMAD, GSD, Spec Kit, and Superpowers already make credible lifecycle
or methodology claims. DIRF can compose with them.

### “The universal agent operating system”

Memorable but inaccurate. DIRF does not host or monitor live agent processes.

### “The token-saving tool”

Progressive disclosure is valuable, but token savings alone reduce DIRF to one
implementation detail and invite benchmark claims the launch does not yet have.

### “Governance for every agent action”

Governed execution is a strong advanced capability on current `origin/main`,
but it should not bury the more immediate route, state, and completion story.

