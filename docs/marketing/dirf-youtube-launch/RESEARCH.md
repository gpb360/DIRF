# DIRF market and channel research

Research date: 2026-08-10 (America/Toronto)

## Executive finding

Agent-assisted development has moved from isolated code generation toward
structured workflows, reusable skills, subagents, persistent context, and
human oversight. DIRF should not claim to invent that shift. It has a credible
place inside it: DIRF reconciles a task, a repository, and the capabilities
already installed on a machine into a small operating route, then preserves the
attempt and its evidence across sessions and worktrees.

The strongest launch wedge is **repeatable agent work without vendor reset**.
The viewer can keep Codex, Claude, Cursor, AGENTS.md, Agent Skills, MCP tools,
Spec Kit, BMAD, GSD, or Superpowers. DIRF supplies the preflight and continuity
contract around the work.

## Market signals

### 1. Specifications and structured workflows are mainstreaming

GitHub Spec Kit describes an intent-driven harness with a default
`Spec → Plan → Tasks → Implement` path and support for many coding-agent
integrations. BMAD describes a scale-adaptive agile suite with specialized
roles and dozens of workflows. GSD documents a cross-runtime command and
workflow architecture. Superpowers packages a development methodology as
composable agent skills.

Implication: a generic “plan before code” message will blend in. DIRF needs to
show its distinct mechanism: live capability discovery, portable routed output,
canonical state, evidence gates, and compatibility with the methods viewers
already use.

### 2. Portable instruction and skill formats are becoming shared plumbing

AGENTS.md presents itself as an open, agent-neutral instruction format. The
Agent Skills specification standardizes `SKILL.md` plus optional scripts,
references, and assets, with progressive disclosure. GitHub's current Copilot
documentation supports skills, custom agents, subagents, MCP servers, hooks,
and multiple project/personal skill locations.

Implication: “agnostic” is timely, but only if the video demonstrates it. Show
DIRF scanning multiple skill roots and routing by capability instead of merely
saying it works everywhere.

### 3. Context continuity is an active operator pain

Recent workflow discussions repeatedly describe session handoffs, externalized
state, context receipts, and work that survives compaction or a host switch.
This is qualitative evidence, not a market-size estimate, but it matches the
failure mode DIRF's canonical handoff was built to prevent.

Implication: lead with the human situation: “The agent said done yesterday.
Today nobody knows what passed, what changed, or what happens next.” Then show
the canonical handoff and exact next action.

### 4. Trust and verification remain central

Current industry research emphasizes the gap between AI-generated output and
developer trust. DIRF should avoid borrowing unverified survey percentages for
promotional copy. Its stronger proof is local and reproducible: completion
checks, recorded evidence, focused handoffs, explicit decisions, and governed
execution on the current main branch.

Implication: every episode should contain a “proof, not claim” moment: open the
attempt, inspect the selected capability, show the handoff, or replay the gate.

## Competitive landscape

| Product/method | Core public promise | Strongest use | DIRF relationship |
|---|---|---|---|
| GitHub Spec Kit | Intent and specification-driven workflows with structured artifacts | Teams that want a Spec → Plan → Tasks → Implement path | DIRF can route a task into specification work, preserve the attempt, and surround it with live capability mapping and handoff state |
| BMAD Method | Scale-adaptive agile workflows with specialist agent roles | Broad, guided product-delivery lifecycle | DIRF can sit before a BMAD workflow or use installed BMAD capabilities without requiring BMAD as the universal route |
| GSD | Opinionated cross-runtime planning and execution workflows | Developers who want a deep project/milestone delivery system | DIRF can recognize and route into installed GSD skills, then keep project-wide canonical continuity |
| Superpowers | Composable skills plus an opinionated software-development methodology | Strong behavioral discipline inside supported agent hosts | DIRF can discover those installed skills and choose them for relevant stages |
| AGENTS.md | Open repository guidance for coding agents | Stable project instructions and conventions | AGENTS.md constrains the work; DIRF adds task-specific routing, attempt state, and completion evidence |
| Agent Skills | Portable skill folders with progressive loading | Reusable domain procedures | DIRF scans, enriches, and resolves installed skills into a task-specific flow |
| MCP | Standard connection surface for tools and data | Giving an agent external capabilities | DIRF offers an optional MCP shell over the same state core; MCP connects capabilities while DIRF structures the attempt |

### Fair differentiation

DIRF's defensible combination is:

1. It starts from the live host and target repository, not a hardcoded skill
   catalog.
2. It separates a lean router from lazy-loaded role detail.
3. It stores one canonical project handoff keyed to Git's common directory, so
   related worktrees resolve to the same coordination state.
4. It renders the same workflow as Markdown for agents and HTML for people.
5. It treats completion, approval, and evidence as explicit workflow concepts.

Each component exists elsewhere in some form. The value is their small,
vendor-neutral composition.

## Audience and jobs to be done

### Primary: multi-agent operator

**Situation:** uses Codex for one task, Claude for another, and Cursor or a
terminal agent for daily work. Has accumulated project instructions and skill
folders.

**Job:** “Help me start the right workflow quickly and let the next session know
exactly where the last one stopped.”

**Proof that converts:** run `dirf flow`, open the attempt README, switch context,
then run `dirf resume` and show the exact next action.

### Secondary: technical team lead

**Situation:** wants repeatability and review evidence without mandating one
model or IDE across the team.

**Job:** “Give the team a shared operating contract while letting each person
use approved tools.”

**Proof that converts:** portable capability names, explicit decision gates,
project instructions taking precedence, and human-readable HTML.

### Secondary: agency or consultant

**Situation:** repeats audits, feature work, content work, and releases across
many repositories.

**Job:** “Reuse the workflow without copying stale task state from one client to
another.”

**Proof that converts:** project-keyed store, attempt history, portfolio view,
and separate canonical and attempt-scoped handoffs.

### Secondary: workflow and skill author

**Situation:** has useful skills but no reliable way to ensure the right one is
selected without loading everything.

**Job:** “Make my capability discoverable at the right time and cheap when it is
irrelevant.”

**Proof that converts:** metadata scan, capability routing, missing-capability
gaps, and progressive disclosure.

## Content gap and launch opportunity

Most adjacent product education naturally starts with installation and its own
method. DIRF should start one step earlier: the viewer's existing stack is
already messy and valuable. The launch question is not “Which framework wins?”
It is “How do I keep the useful parts and make the work repeatable?”

That produces five search-friendly but category-building topics:

1. AI coding agent context loss and false completion
2. A full DIRF task-to-handoff tutorial
3. DIRF compared with Spec Kit, BMAD, GSD, and Superpowers
4. Agent Skills, AGENTS.md, MCP, and vendor-neutral workflow design
5. Managing multiple AI projects and worktrees with canonical state

## YouTube strategy from official guidance

YouTube describes performance in terms of appeal, engagement, and satisfaction.
It also states that title, thumbnail, description, and the actual video content
help establish search relevance, while the opening should immediately deliver
the promise made by the title and thumbnail.

Application to this series:

- Package every episode around one recognizable problem, not the product name
  alone.
- Put the proof in the first 20 seconds: an actual route, handoff, comparison,
  or portfolio screen.
- Keep the logo sting under two seconds or omit it.
- Use chapters because each episode teaches a multi-step technical concept.
- Compare long-form only with long-form and Shorts only with Shorts in Studio;
  audience behavior differs by format.
- Track Shorts with `engaged views` and “chose to view,” not raw starts alone.
- Attach each Short to its source episode using YouTube's related-video path
  when available.

## Packaging recommendations

### Title language to test

- “AI coding agent workflow”
- “AI agent context loss”
- “spec-driven development tools”
- “Claude Code / Codex workflow”
- “Agent Skills and AGENTS.md”
- “multi-agent development workflow”

Avoid stuffing every vendor into every title. Use comparison terms only on the
comparison episode and descriptions.

### Thumbnail system

- One large problem phrase, four words maximum
- One visible artifact: routed flow, handoff, comparison map, or portfolio
- DIRF blue as the recurring anchor
- No tiny terminal text
- No generic robot face

### Measurement plan

For each long-form episode, review after 7 and 28 days:

- impressions and click-through rate by traffic source
- first 30-second retention and the first major drop
- average percentage viewed and chapter-level retention
- search terms, suggested-video sources, and returning viewers
- repository visits or tracked installation-page clicks

For each Short, review engaged views, chose-to-view rate, average percentage
viewed, rewatches, subscribers, and clicks into the related long-form episode.

Do not set universal “good” percentages before the channel has its own baseline.
Use the first five episodes as that baseline.

## Risks and mitigations

- **Feature drift:** local `main` was four commits behind `origin/main` during
  research. Record every episode against one exact commit and update commands
  before capture.
- **Category confusion:** viewers may assume DIRF replaces other methods. Repeat
  the compatibility explanation with a concrete example.
- **Overclaiming agnosticism:** host-neutral Markdown does not guarantee every
  host supports every tool. Say “portable operating instructions” and name
  tested hosts separately.
- **Founder-only proof:** internal use across multiple projects is meaningful
  operational evidence but not customer traction. Label it correctly.
- **Production sprawl:** five episodes can become a film project. Reuse one
  design system, one diagram, one lower-third package, and one capture template.

## Sources

### Official or primary product sources

- GitHub Spec Kit: https://github.github.io/spec-kit/
- BMAD Method repository: https://github.com/bmad-code-org/BMAD-METHOD
- BMAD workflow map: https://docs.bmad-method.org/reference/workflow-map/
- GSD architecture: https://github.com/gsd-build/get-shit-done/blob/main/docs/ARCHITECTURE.md
- Superpowers repository: https://github.com/obra/superpowers
- AGENTS.md open format: https://agents.md/
- Agent Skills specification: https://agentskills.io/specification
- GitHub Copilot Agent Skills: https://docs.github.com/en/copilot/concepts/agents/about-agent-skills
- Model Context Protocol: https://modelcontextprotocol.io/

### Official YouTube sources

- Recommendation performance: https://support.google.com/youtube/answer/16559650
- YouTube search: https://support.google.com/youtube/answer/16090438
- Audience retention: https://support.google.com/youtube/answer/9313698
- Shorts analytics: https://support.google.com/youtube/answer/12942217
- Shorts overview and engaged views: https://support.google.com/youtube/answer/10059070
- Shorts-to-long-form related videos: https://blog.youtube/creator-and-artist-stories/youtube-related-videos-traffic-guide/

### Qualitative operator signal

- Recent workflow discussions about durable handoffs and externalized state were
  used only to validate the problem language, not to estimate market size.

