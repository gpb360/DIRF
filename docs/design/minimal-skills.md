# Minimal skills

Status: slices 1-5 built. Slice 2 is checked after two weeks of use.

## Problem

A review of recorded attempts found:

- `discover` scans every home root, so the index holds far more skills than
  any flow uses.
- Skill lists are a fixed template per playbook. Most fullstack-feature
  attempts got the same skills.
- Tasks with no UI got UI skills.
- The render says "Load and apply the selected skills", yet handoffs rarely
  name the skills that were used.
- Same-name skills exist in several roots with different content. DIRF bound
  the `.codex` copy also in Claude sessions.

Skills cost tokens and teach agents to skip DIRF instructions. Target: a skill
appears in a flow only when the task needs it, and the agent is free to skip it.

## Causes in code

| Cause | Where |
| --- | --- |
| `ui` branch turns on when the playbook lists a frontend agent, so every fullstack-feature task gets frontend design | `src/flow.js` `branchesFor` (agent check) |
| `product quality` step has no branch, so `impeccable` binds on every feature | `playbooks/fullstack-feature/README.md` `skill_flow` |
| All four home roots scanned, zcode cache recursed | `src/skills.js` `HOME_ROOT_NAMES`, `skillRoots` |
| First root wins a name clash, not the running host | `src/skills.js` `discover`/`scanFlat` order |
| Word-overlap scoring binds skills that never declared the capability | `src/flow.js` `selectCapability` |
| Mandatory wording | `src/renderer.js` skill-flow text (two places), `policies/workflow-policy.md` |

## Slices

Each slice is one PR with its own tests. Order is by value per change.

1. **No UI skills without UI work.** Remove the agent-based `ui` inference in
   `branchesFor`; the task text alone turns on `ui`. Put the fullstack-feature
   `product quality` step on the `ui` branch. Tests: a non-UI fullstack task
   has no `frontend design` or `product quality` step; a UI task keeps both.
2. **Skills are optional.** Change render and policy text to: "Skills available
   for these steps. Use one when the step needs it. Name each skill you used in
   the handoff." Tests: renderer output and policy text.
3. **Host-scoped scan.** Scan the project roots and the running host's home
   root only (`~/.claude/skills` under Claude Code, `~/.codex/skills` under
   Codex, `~/.agents/skills` for both). Other home roots and the zcode cache
   need opt-in (`--skills-scope all` or project config). On a name clash the
   host root wins; `dirf skills scan` warns when same-name copies differ.
   Tests: scan with fake homes for each host; clash resolution; warning.
   Built: opt-in is `--skills-scope all` or `DIRF_SKILLS_SCOPE=all`, not
   project config. Host comes from `DIRF_HARNESS`, `CODEX_THREAD_ID`, or
   `CLAUDECODE`; an unknown host scans the three host roots without the zcode
   cache. Project roots still win over home roots.
4. **Declared match only.** `selectCapability` binds a skill only when it
   declares the capability or its name equals the capability. Word overlap
   alone no longer binds. Unmatched steps stay plain text, with no gap
   question. Tests: overlap-only candidate does not bind; declared does.
   Built: unmatched steps go to `skill_flow.unbound` (no question), which
   `dirf setup` still reports as capability gaps. A gap with a question
   stays only when a trusted source declares the capability. Overlap still
   picks the engine among the references of a router the user named.
5. **Pinning uses the existing profile.** Document `--profile` (skills
   allow-list) as the way a repo pins skills. No new mechanism.
   Built: `docs/reference.md` "How skill mapping works" now covers declared
   matching, unbound steps, optional skills, profile pinning, and host-scoped
   scan roots.

Out of scope: attempt churn (superseded and stale attempts). That needs
its own attempt: draft-until-confirmed routing and janitor closure.

## Verification gates

- Per slice: the named tests, then `npm run check:release`.
- Replay check after slices 1-4: rebuild flows for a fixed sample of 50
  recorded task strings (kept outside the repo) and compare with today.
  - UI-branch skills on tasks with no UI words: 0.
  - Median skill steps per flow: at most 3.
  - Steps bound to a copy from another host's root: 0.
  - Result after slices 1-4: UI-branch skills on tasks with no UI words
    dropped sharply, and no other host's copy was bound. What remains comes
    from tasks routed to UI playbooks, where the quality step is
    unconditional. That is playbook misrouting, out of scope. The median
    stays above 3 because most steps now bind by declared capability.
- Slice 2 is checked after two weeks of use: share of used skills named in
  handoffs. No fixed target; the number tells which skills to keep.

## Open decisions

- Slice 3 default: host-scoped (proposed) or project-only, with home roots
  opt-in.
- Slice 4 removes overlap matching completely (proposed) or keeps it behind a
  flag.
