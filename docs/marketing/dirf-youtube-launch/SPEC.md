# DIRF five-video launch specification

## Outcome

Produce a connected five-episode YouTube series that teaches the operating
problem, demonstrates DIRF end to end, positions it fairly beside adjacent
methods, proves its host-neutral design, and shows multi-project continuity.
The series should leave a qualified viewer able to explain DIRF in one sentence
and run one relevant command.

## Campaign promise

**Keep your agent stack. Give it a route, a record, and a finish line.**

DIRF inspects the task, target repository, and capabilities available on the
current host. It creates a lean operating workflow, preserves canonical state,
and makes completion evidence explicit.

## Format contract

- Five 16:9 videos at 8–12 minutes each
- 1440p or 4K screen capture, delivered at 1080p or higher
- Founder voice preferred; approved existing narrator is the fallback
- Chapters on every episode
- Captions generated from the final voice track and manually corrected for
  DIRF, Codex, Claude, Cursor, BMAD, GSD, MCP, AGENTS.md, and command names
- One CTA per episode
- Five planned Shorts per episode
- One reusable opening, lower-third, terminal treatment, and end card

## Episode architecture

### Episode 1 — The problem

**Primary title:** Your AI Coding Agent Forgot the Plan. Again.

**Alternative title:** Why AI Agent Work Falls Apart Between Sessions

**Promise:** Diagnose context drift, wrong-workflow selection, and unsupported
“done” claims, then show DIRF's route, record, and finish-line model.

**Runtime:** 8–10 minutes

**Framework:** ACCA. The viewer needs to understand the category before the
product earns conviction.

**Proof moment:** live canonical handoff plus exact next action.

**CTA:** Open the DIRF repository and read the first-run example.

### Episode 2 — The full walkthrough

**Primary title:** DIRF Tutorial: From One Task to a Verified Handoff

**Alternative title:** I Gave DIRF a Messy Task. Here Is the Workflow It Built.

**Promise:** Show task routing, skill discovery, attempt creation, lean files,
phase progress, evidence, and resume behavior in one continuous example.

**Runtime:** 11–14 minutes

**Framework:** AIDA with a product-led demonstration.

**Proof moment:** `dirf flow`, `dirf plan`, attempt README, and `dirf resume`.

**CTA:** Run `dirf flow` against one real task before installing anything else.

### Episode 3 — The landscape

**Primary title:** DIRF vs Spec Kit, BMAD, GSD, and Superpowers

**Alternative title:** Which AI Coding Workflow Should You Use in 2026?

**Promise:** Give a fair decision guide and demonstrate that DIRF can complement
rather than replace the viewer's chosen method.

**Runtime:** 9–12 minutes

**Framework:** QUEST. Qualify the viewer, acknowledge their current setup,
educate on each method, then transition to the compatibility layer.

**Proof moment:** route a task into an installed capability from another method.

**CTA:** Keep the method you use and test whether DIRF can route into it.

### Episode 4 — Agnostic by design

**Primary title:** One Agent Workflow Across Codex, Claude, and Cursor

**Alternative title:** Agent Skills, AGENTS.md, MCP, and the Portable Workflow

**Promise:** Explain capability names, skill discovery, progressive disclosure,
portable Markdown, the human HTML render, and the optional MCP shell.

**Runtime:** 9–11 minutes

**Framework:** FAB, edited through ACCA. Technical features are translated into
operator outcomes and bounded by what portability does not guarantee.

**Proof moment:** live `skills scan` metadata tier and routed flow.

**CTA:** Run `dirf skills scan --path <project>` and inspect what DIRF can use.

### Episode 5 — Real operating proof

**Primary title:** How I Manage Multiple AI Projects Without Losing the Handoff

**Alternative title:** DIRF Across Worktrees, Projects, and Agent Sessions

**Promise:** Show canonical project state, attempt history, portfolio rollups,
worktree continuity, and governed execution using real founder-operated work.

**Runtime:** 10–13 minutes

**Framework:** STAR Story plus proof. The episode follows a real “before, action,
result, operating method” arc without turning internal use into customer proof.

**Proof moment:** live portfolio, project handoff, and a worktree resolution
explanation; governed execution is labeled as an advanced layer.

**CTA:** Register one active project and write its first canonical handoff.

## Visual system

### Concept angle

DIRF turns a pile of agent capabilities and project context into one bounded
route, then carries proof forward into the next session.

### Core visual motif

Use the Operational Precision master as the production anchor and its editable
Excalidraw companion for technical walkthroughs:

`task + repository + installed capabilities → DIRF route → attempt → evidence → canonical handoff`

The left side should feel scattered. The center should feel selective. The
right side should feel calm and inspectable.

### Screen language

- Terminal footage is evidence, not wallpaper. Highlight one line at a time.
- Use 120–140% terminal zoom and a large, high-contrast font.
- Replace real user paths in polished motion graphics with `<project>` while
  keeping live capture honest.
- Use DIRF blue for route and state, amber for decisions, green for verified
  evidence, red only for denied or blocked actions.
- Show no secret, token, private customer data, or personal path not approved
  for publication.

### Motion language

- Route construction: loose inputs converge into a thin ordered spine.
- Progressive disclosure: only the active role expands; inactive detail stays
  collapsed.
- Handoff continuity: one state artifact crosses a session or worktree boundary
  while runtime-specific paths fall away.
- Evidence gates: a check remains amber until a real command/result turns it
  green.
- Comparisons: parallel lanes, not a winner podium.

## Audio system

- Founder narration at a natural 135–155 words per minute
- Minimal music, if any, under terminal explanations
- Short, consistent sound marks for route selection, verified evidence, and a
  context switch
- No synthetic “tech trailer” voice
- Normalize the final narration before timing motion

## Claim contract

Every product claim must be one of:

1. verified from the exact recorded commit;
2. demonstrated in the video;
3. cited to an official external source; or
4. labeled as an opinion, design goal, or future direction.

Never claim universal host compatibility, automatic production safety,
customer adoption, time savings, token percentages, or quality improvement
without direct evidence.

## Description template

```text
[Two-sentence problem and episode promise]

DIRF is a preflight, routing, continuity, and evidence layer for agent work.
It uses the project and capabilities already available on your machine to build
a lean workflow with boundaries, checks, and a handoff.

Repository: [current public URL]
Episode command: [one command]
Series playlist: [playlist URL after publishing]

Chapters
[timestamps from final edit]

Sources and compared projects
[official links used by this episode]
```

## Acceptance checks

- Every spoken product behavior matches the exact recorded commit.
- Each episode shows at least one real DIRF output before minute two.
- Each script can be read aloud without unexplained jargon or banned hype.
- Each title and thumbnail promise is fulfilled in the first 20 seconds.
- Each comparison uses official descriptions and names a best-fit use case.
- Every episode has one CTA and five usable short-form extraction points.
- Final captions, audio, terminal readability, and source links pass manual QA.
