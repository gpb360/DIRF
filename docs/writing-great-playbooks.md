# Writing great playbooks and agents

The vocabulary that survives contact with agents — distilled from the Agent
Skills ecosystem (mattpocock/skills, agentskills.io spec, Anthropic guidance;
see `docs/research/matt-pocock-skills-dirf-review-2026-08-07.md`) and applied
to DIRF's own authoring surface: playbook `config` frontmatter, `agents/*.md`
definitions, and the workflow policy.

A skill/playbook exists to wrangle determinism out of a stochastic system.
**Predictability** — the agent taking the same *process* every run, not
producing the same output — is the root virtue; every rule below serves it.

## Descriptions are routing hints

The description is the entire routing surface: it's what the agent sees when
deciding whether to load the playbook/skill. Write it for that job:

- **Front-load the leading word.** The first word does the invocation work.
- **One trigger per branch.** "…build features test-first, mentions
  red-green-refactor, or wants integration tests" — each branch distinct.
  Synonyms that rename one branch are duplication; collapse them.
- **Third person, always.** "Use when the user…", never "I" or "You" —
  inconsistent point of view breaks discovery.
- **Cut identity already in the body.** The description holds triggers, plus
  any "when another skill needs…" reach clause. Nothing else.
- **Keep it under 1024 chars.** Over-budget descriptions get dropped silently.

**Two routing surfaces — don't confuse them.** A *skill's* description is the
entire routing surface; write it as triggers. A *playbook* routes by
**keywords** (DIRF's router matches keywords, not descriptions) — its
description is identity + scope ("Research a topic, competitor, technology,
or market and synthesize recommendations"), and trigger phrasing is optional
there. Put the one-trigger-per-branch discipline into the keyword list
instead. Auditing the kit found zero playbook-description issues: the
heuristic only applies to model-invoked skills.

## Completion criteria: checkable and exhaustive

Every step ends on a completion criterion. Two levers:

- **Checkable** — can the agent tell done from not-done? "The loop is
  red-capable, deterministic, and fast" beats "make a good loop".
- **Exhaustive, where it matters** — "every modified model accounted for"
  forces legwork; "produce a change list" invites **premature completion**
  (the agent rushing to *being done*).

DIRF's Verification Contract policy pairs with this: name the verify command
before work starts; done means its output.

## Progressive disclosure

Steps live in the file; reference is pushed out behind pointers, one level
deep. **Branching is the cleanest disclosure test**: inline what every branch
needs, push behind a pointer what only some branches reach. Unread files cost
zero tokens. In DIRF: `details:` arrays (one level deep, never recursed),
`skill_flow.steps[].output` as the terse checkpoint, and keep SKILL.md /
playbook bodies under ~500 lines.

## Prompt the positive

Steering by prohibition drags the forbidden behavior into context and makes
it more available. State the target behavior; keep a prohibition only as a
hard guardrail you can't phrase positively, and pair it with what to do
instead.

## Leading words

A compact concept already living in the model's pretraining — *red* (loop),
*tight*, *seam*, *fog of war* — anchors behavior in fewer tokens than a
sentence of restatement, and the same word in prompts/docs makes the
playbook fire more reliably. Hunt for passages begging to collapse into one
token.

## Invocation classes

`disable-model-invocation: true` means the description is **human-facing**
(triggers stripped — the human is the index); model-invoked descriptions are
agent-facing trigger blocks. DIRF reads the flag and keeps user-invoked
skills out of autonomous routing — but it never imposes the choice. A
user-invoked skill may invoke model-invoked ones, never another user-invoked
one; when they multiply, add a router.

## Failure modes to prune

- **Premature completion** — vague completion criteria.
- **Duplication** — one meaning in several places (maintenance + tokens).
- **Sediment** — stale layers that settle because adding feels safe.
- **Sprawl** — too long even when every line is live. Cure: disclose down.
- **No-op** — a line the model obeys by default. Test: does it change
  behavior versus the default?
- **Negation** — prohibition as the primary steering mechanism.

## Authoring checklist (copy this into your draft and tick it off)

- [ ] Description: leading word first, one trigger per branch, third person,
      under 1024 chars, no identity already in the body
- [ ] Every step ends on a checkable (and where it matters, exhaustive)
      completion criterion
- [ ] Reference pushed one level deep behind pointers; body under ~500 lines
- [ ] Positive phrasing; prohibitions only as paired guardrails
- [ ] Leading words recruited where a sentence restates one idea
- [ ] Invocation class chosen deliberately (and declared, if user-invoked)
- [ ] `dirf validate` passes; gates declared on non-final phases only
