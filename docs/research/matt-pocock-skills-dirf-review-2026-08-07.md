# DIRF research review — mattpocock/skills + the skills ecosystem

**Date:** 2026-08-07 · **Method:** two parallel research agents (repo anatomy via
GitHub API; ecosystem usage via web) + local grounding (installed copies of
`setup-matt-pocock-skills` and `writing-great-skills`, DIRF's `src/skills.js` /
`src/flow.js`) · **Purpose:** understand where and how skills are used, what
makes them effective for agents, and what DIRF can adopt — **while staying
non-opinionated** (map what's installed; never endorse or hardcode skills).

---

## TL;DR

- **Matt's repo is the reference implementation of the Agent Skills ecosystem:**
  ~208k stars, 35 skills in buckets, actively pushed. Every skill is a
  **workflow/process** skill — no tech-domain skills at all. Routing axis is
  **invocation class**, not technology.
- **The master routing attribute is `disable-model-invocation`.** Model-invoked
  skills carry "Use when…" trigger descriptions (the always-loaded pointer);
  user-invoked skills strip descriptions from the model (zero context load,
  human is the index) — "The description is the entire routing surface."
- **Prose `/skill` references are the de-facto dependency mechanism** (a 7-line
  wrapper: "Run a `/grilling` session.") — the exact surface DIRF's
  "referenced-but-absent" flagging should parse.
- **DIRF gap confirmed:** `src/flow.js` `selectCapability` scores every skill
  description as a routing hint — but user-invoked descriptions are
  human-facing *by design*, so DIRF currently misroutes against them.
- Highest-value imports: **invocation-class indexing**, **disclosure-file
  indexing**, **prose-reference graph**, **mechanical description linting**
  (spec-level heuristics), **token-budget surfacing**.

---

## 1. What the repo is today

`github.com/mattpocock/skills` — "Skills for Real Engineers." 35 SKILL.md
files: `engineering/` ×18 + `productivity/` ×7 **promoted**; `misc/` ×4 and
`in-progress/` ×6 kept back. Distributed as a Claude Code plugin
(`.claude-plugin/plugin.json`, official marketplace) **or** `npx skills add
mattpocock/skills` (editable copies, harness-neutral) — "pick one, never
both." Skills have no version stamp inside SKILL.md; versioning is
repo-level (changesets, CHANGELOG, plugin manifest). Every skill ships an
`agents/openai.yaml` shim (`policy.allow_implicit_invocation: false` for
user-invoked) — "user-invoked in both harnesses or neither."

## 2. The canonical skill anatomy

- **Frontmatter:** `name`, `description` (phrasing depends on invocation
  mode), `disable-model-invocation: true` (user-invoked), custom
  `argument-hint` on argument-taking skills. Nothing else — no tags/keywords.
- **Body:** 7–140 lines (median ~75). No mandatory template. Common: "what
  this is" preamble, numbered `## Process` steps, anti-pattern lists,
  checklists, "Done when:" criteria, `/skill` invocations.
- **Satellites:** co-located reference files pushed one level deep
  (`tests.md`, `mocking.md`, `*FORMAT.md`, `template.sh`, `GLOSSARY.md`) —
  progressive disclosure, loaded only when pointed at.
- **Examples:** `grill-me` = 7 lines ("Run a `/grilling` session."); `tdd` =
  38 lines with trigger-branch description; `diagnosing-bugs` = 140 lines with
  checkbox completion gates ("No red-capable command, no Phase 2.").

## 3. Pattern library

### 3.1 Invocation and routing (the master axis)

- **P1 Invocation classes.** `disable-model-invocation: true` = user-invoked
  (human-facing one-line description, triggers stripped, zero context load) vs
  model-invoked (rich trigger phrasing, description sits in the window every
  turn). The cost model: **context load** (tokens every turn) vs **cognitive
  load** (human must remember the slash command).
- **P2 "Use when…" trigger-branch descriptions.** One distinct trigger per
  branch; synonyms renaming one branch are duplication. The description's
  wording, not the body, decides whether auto-invocation fires. Negative
  guardrails only when paired with a positive target ("Don't invoke this for
  steps the agent can perform itself").
- **P3 Router skill.** When user-invoked skills multiply, one user-invoked
  skill names the others (`ask-matt`, 90 lines: "A flow is a path through the
  skills"). It "can only hint, never fire them." A router that lies is called
  out as a failure mode.
- **P4 Thin wrappers over shared primitives.** Dependencies expressed as
  `/skill` prose invocation; shared reference lives inside the owning skill;
  other skills reach it by invoking, not by cross-folder links. A user-invoked
  skill may invoke model-invoked ones, never another user-invoked one.

### 3.2 Content discipline (what makes skills effective)

- **P5 Progressive disclosure.** Steps in file, reference pushed out:
  in-skill step → in-skill reference → disclosed reference behind a context
  pointer. "Branching is the cleanest disclosure test: inline what every
  branch needs, push behind a pointer what only some branches reach." Unread
  files cost zero tokens (DIRF's ponytail principle, practiced).
- **P6 Checkable, exhaustive completion criteria.** "Can the agent tell done
  from not-done?" against *premature completion*; "every modified model
  accounted for" forces legwork where "produce a change list" does not.
- **P7 Leading words.** One pretrained token (_red_ loop, _tight_, _seam_,
  _fog of war_) instead of a sentence; recruits priors, anchors invocation and
  execution, fewer tokens.
- **P8 Positive instructions.** "Steering by prohibition drags the forbidden
  behaviour into context and makes it more available" — prompt the positive.
- **P9 Human-facing docs layer.** Each promoted skill has a `docs/` page —
  `## What it does` (the defining constraint), `## When to reach for it`,
  `## It's working if` (checkable without opening SKILL.md) — relieves the
  cognitive load user-invoked skills create. Agent gets the runbook, human
  gets the map.

### 3.3 Ecosystem facts (agentskills.io spec, Anthropic, tooling)

- **Open standard (agentskills.io):** `name` must match the parent directory;
  `description` 1–1024 chars, "what it does + when to use it" with keywords;
  three disclosure tiers (~100 tokens metadata always loaded / SKILL.md <5000
  tokens on activation / resources on demand); references one level deep;
  `skills-ref validate` is the validator.
- **Anthropic:** "The description is critical for skill selection: Claude uses
  it to choose from 100+ skills." Third person, ≤1024 chars, no XML, gerund
  naming, freedom levels (high/medium/low specificity), copyable checklists.
  Claude Code extras: `when_to_use` (appended, truncated at 1536), six-field
  portability boundary outside Claude Code (hard packaging error otherwise).
- **Measured failure modes:** silent non-triggering (description over budget
  dropped with no warning); over-triggering (~300k tokens injected into an
  unrelated task); O(n) re-injection (~25K tokens per tool call at 160+
  skills); **routing ceiling ~32–36 skills**; progressive disclosure ≈93.8%
  token savings vs eager loading; ToxicSkills study: ~13.4% of third-party
  skills carry critical issues — trust matters.
- **Tooling norms:** `npx skills` (Vercel Labs) walks ≤3 levels, "shallower
  SKILL.md shadows nested," `metadata.internal: true` hides a skill; per-agent
  path mapping (`.claude/skills/`, `.cursor/skills/`, `.codex/skills/`,
  `.agents/skills/` canonical); multi-root scanning + name dedup is the norm;
  plugin skills are namespaced `plugin:skill`.

---

## 4. Gap map — DIRF today vs the findings

| DIRF component (today) | Finding | Gap / update |
|---|---|---|
| `src/skills.js` — scans SKILL.md/skill.json/README.md, extracts name + description | Invocation classes are the master routing attribute | **Index `disable-model-invocation` / `user-invocable`**; classify each skill model- vs user-invoked |
| `src/flow.js` `selectCapability` — scores all descriptions as routing hints | User-invoked descriptions are human-facing by design | **Exclude user-invoked descriptions from routing scores**; they misroute today |
| `src/skills.js` — description extraction (first-found-wins) | Spec: name must match parent dir; description is the whole routing surface | **Warn (non-fatal) on name ≠ dir, missing/short/first-person/trigger-less descriptions, vague names** (helper/utils/tools) |
| `src/skills.js` — indexes the skill only | Progressive disclosure: satellites one level deep | **Index satellite files per skill** (disclosures) and surface them as lazy-load pointers; shape signal (wrapper ≤10 lines vs reference) |
| `src/flow.js` — referenced-but-absent flagging | Prose `/skill` references are the dependency mechanism | **Build the inter-skill graph from `/name` prose** → referenced-but-absent parsing, router detection, installed-but-unreferenced mirror signal |
| `src/skills.js` / renderer — description only | Metadata tier is what's always loaded (~100 tokens/skill) | **Token-budget estimates per skill** (metadata + body + references) surfaced in scan/attempts |
| `skills scan` — name/status/path | Ecosystem prints richer views; routing ceiling ~32–36 | **Set-wide warnings**: total always-loaded cost, skill count vs ceiling, overlapping descriptions |
| `registry/` — agents/skills/playbooks JSON | `agents/openai.yaml` + plugin.json are derivable shims | Note per-harness sync as a health signal only — never canonical |
| renderer — skill flow with reason + done-when | Completion criteria, checklists, freedom levels | Adopt **checkable-criterion + copyable-checklist** language in generated steps (authoring guidance) |
| `docs/AGENT_GUIDE.md` + policy | writing-for-agents vocabulary (predictability, leading words, no negation) | **Docs: skill/playbook authoring guidance** using this vocabulary |

---

## 5. Ranked update proposals

### P0 — skills.js: invocation + disclosure awareness (small, high value)

1. **Invocation-class indexing.** Parse `disable-model-invocation` /
   `user-invocable` into the skill index as `invocation: "model"|"user"` (flag
   absent → classify heuristically from description: "Use when…" trigger
   phrases ⇒ model). Exclude `user`-invoked descriptions from
   `selectCapability` scoring in flow.js; keep them indexed and shown in
   `skills scan` as human-only affordances.
2. **Disclosure-file indexing.** Record co-located files (siblings one level
   deep: `*.md`, `scripts/`, `templates`) per skill as `disclosures`; renderer
   emits them as lazy-load details (ponytail: unread files cost zero tokens).
   Also derive a shape hint: wrapper (≤10 lines + `/x` invocation) vs
   reference.

### P1 — validation + graph intelligence

3. **Mechanical description linting** in `dirf validate` (all spec-level
   heuristics, non-fatal warnings — DIRF never fails on absent skills):
   missing description; `name` ≠ parent directory; length >1024; first-person
   prefixes ("I can…"); no trigger phrasing ("use when"/"mentions"); vague
   names (`helper`, `utils`, `tools`); XML tags in description.
4. **Prose-reference graph.** Scan SKILL.md bodies for `/skill-name`
   invocations, resolve against the index → strengthens referenced-but-absent
   (existing principle, now body-parsed), detects router skills, and adds the
   mirror signal: **installed-but-unreferenced** (dead weight paying context
   load).
5. **Token-budget surfacing.** Per-skill estimate (metadata ~100 + body +
   summed references) in `skills scan`; set-level warning when total
   always-loaded metadata approaches ~1–2% of a typical window or the skill
   count exceeds the ~32–36 routing ceiling.

### P2 — rendering + docs

6. **Render skills the way agents consume them.** Generated skill-flow steps
   already carry reason + done-when; add: descriptions quoted verbatim as the
   routing surface (quote, don't rewrite), one-level-deep reference pointers,
   and a copyable checklist for complex steps.
7. **`skills scan` richer output:** invocation mode, disclosure files,
   description snippet, staleness (git last-touch per folder — the host's own
   history, no DIRF versioning scheme).
8. **Authoring guidance doc** (`docs/writing-great-playbooks.md`?): the
   vocabulary that survives contact with agents — predictability, checkable +
   exhaustive completion criteria, positive prompting, leading words,
   progressive disclosure — sourced from writing-for-agents and applied to
   DIRF playbooks/agents.

---

## 6. Deliberate non-imports (stay non-opinionated)

- **No skill library, no endorsements.** DIRF maps what's installed; it never
  ships or prefers skills.
- **Lint = warn, never fail.** Missing/invalid skill metadata is a warning
  (DIRF's "referenced-but-absent is never fatal" principle extended to
  metadata quality).
- **Invocation classification is a read, not a rule.** Model-invoked =
  routable, user-invoked = human-only — but scoring still falls back to
  description matching when the flag is absent.
- **No per-harness manifest parsing as canonical** (`agents/openai.yaml`,
  `.claude-plugin/plugin.json` are derivable; note sync state only).
- **No imposed token budgets** — surface estimates, let hosts decide.
- **No auto-generated routers** — detect them, don't prescribe them.

---

## 7. Open questions (for Gary)

1. P0 first (invocation indexing + disclosure indexing), or all three tiers in
   one pass?
2. Should `selectCapability` *exclude* user-invoked skills outright, or just
   downweight them (fallback when nothing else matches)?
3. How noisy should validate warnings be — every lint, or only high-signal
   ones (name ≠ dir, missing description)?
4. Dogfood: should DIRF render its generated instruction sets in a shape
   `skills-ref validate` would pass (installable-as-a-skill output)?

---

## Sources

- Repo: [github.com/mattpocock/skills](https://github.com/mattpocock/skills)
  (GitHub API: root tree, all 35 SKILL.md frontmatter blocks, 14 skills read
  in full, `.agents/` meta-docs, plugin.json; fetched 2026-08-07)
- Local installed copies: `C:\Users\garyp\.zcode\skills\writing-great-skills\SKILL.md`
  (verbatim), `setup-matt-pocock-skills\SKILL.md`, `skill-installer\SKILL.md`
- Spec + best practices: [agentskills.io/specification](https://agentskills.io/specification),
  [Anthropic skill best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices),
  [Claude Code skills docs](https://code.claude.com/docs/en/skills),
  [Anthropic skills announcement](https://claude.com/blog/skills)
- Tooling: [vercel-labs/skills](https://github.com/vercel-labs/skills) +
  [skills.sh](https://www.skills.sh); failure-mode data from anthropics/claude-code
  issues #28660/#81059 and Bosch/CMU 40k-skills study (search-derived);
  ToxicSkills security stats (search-derived)
- **Verification note:** all quotes trace to the cited sources; 404s flagged
  in the agent reports (incl. `writing-great-skills` absent from the main
  branch path — local copy used instead). No repos cloned.
