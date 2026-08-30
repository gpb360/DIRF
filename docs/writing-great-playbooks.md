# Writing great playbooks and agents

This guide covers the authoring surface for DIRF: playbook frontmatter,
`agents/*.md` definitions, and workflow policy.

A skill or playbook gives an agent a repeatable process. The goal is
predictable behavior, not identical wording on every run.

## Descriptions are routing hints

An agent uses a skill description to decide whether to load it. Write the
description for that decision:

- Put the leading word first. It helps the description trigger the right use.
- Give each branch one trigger. Collapse synonyms that describe the same
  branch.
- Use third person. Write "Use when the user...", not "I" or "You".
- Keep identity in the body. The description needs triggers and any reach
  clause for another skill, not a second summary of the skill.
- Keep the description below 1024 characters. Longer descriptions may be
  dropped silently.

Skills and playbooks route differently. A skill routes from its description.
A playbook routes from keywords because DIRF's router matches keywords, not
playbook descriptions. Put trigger phrases in the keyword list.

## Completion criteria are checkable

Every step needs a clear definition of done:

- Make completion observable. "The loop is deterministic and fast" is weaker
  than a check that reports those properties.
- Be exhaustive where it matters. "Every modified model is accounted for"
  prevents an incomplete handoff. "Produce a change list" does not.

DIRF's Verification Contract requires the workflow to name its verify command
before work begins. The command's output is the evidence of completion.

## Progressive disclosure

Keep each step focused. Put details behind one-level pointers when only one
branch needs them. Unread files cost no tokens.

In DIRF, use `details:` arrays, keep
`skill_flow.steps[].output` as a short checkpoint, and keep `SKILL.md` and
playbook bodies below about 500 lines.

## Prompt the positive

State the behavior you want. A prohibition can make the forbidden behavior
more salient. Keep a prohibition only when it is a necessary guardrail, and
state the permitted behavior beside it.

## Optional prose pass

Before publishing a playbook, remove filler and vague claims. Name the actor
and the evidence when they matter. Preserve the intended meaning and tone.
Read the result once as a skeptical user. Cut formulaic phrasing, add a
concrete example when a rule is abstract, and keep stylistic preferences
optional unless the repository requires them.

## Leading words

A short, familiar concept can replace a sentence of explanation. Use words
such as *red*, *tight*, or *seam* when they accurately name the behavior. If a
sentence repeats one idea, replace the repetition with the useful term.

## Invocation classes

`disable-model-invocation: true` marks a human-facing skill in Claude Code.
Codex uses `policy.allow_implicit_invocation: false` under
`agents/openai.yaml`. DIRF treats either declaration as human-only, so its
triggers are not used for automatic routing. Other skills are model-facing and
use their descriptions as trigger blocks.

DIRF respects this choice. A user-invoked skill may call a model-invoked skill,
but it should not call another user-invoked skill. Add a router when several
user-invoked skills need to work together.

When a user names a human-only router explicitly, DIRF preserves that user
checkpoint. If the router points to exactly one installed model-invoked skill,
DIRF can use that skill as the executable engine. A generic task may select the
engine directly. Keep the router small and put the repeatable process in the
engine.

## One capability, five connected views

Treat an adopted capability as one behavior with five connected views:

| View | Question it answers |
|---|---|
| Workflow | What happens, in what order, and where does work stop? |
| Playbook | When should DIRF route here, and which gates apply? |
| Agent | Who owns the action, decision, verification, and handoff? |
| Code | What is validated, selected, persisted, or rendered deterministically? |
| Documentation | How can a person understand and use it in ordinary language? |

Do not copy the same instructions into five files. Keep one authoritative rule
and make the other views point to or enforce it. For example, a plan interview
has a one-question workflow, routes through the existing planning playbook,
assigns question order to the workflow orchestrator while decisions remain
user-owned, enforces the confirmation gate in code, and documents the normal
and stateful variants once.

## Failure modes to prune

- **Premature completion:** the completion rule is too vague to verify.
- **Duplication:** one meaning appears in several places, increasing upkeep.
- **Sediment:** stale guidance remains because deleting it feels risky.
- **Sprawl:** the body is too long even though every line is relevant. Move
  branch-specific detail behind a pointer.
- **No-op guidance:** the line does not change the agent's default behavior.
- **Negation:** a prohibition is doing the work of positive direction.

## Authoring checklist

- [ ] Description starts with the leading word, has one trigger per branch,
      uses third person, stays below 1024 characters, and avoids repeating the
      body.
- [ ] Every step has a checkable completion criterion and covers all important
      cases.
- [ ] Branch-specific reference is one level deep and the body stays below
      about 500 lines.
- [ ] Guidance states the desired behavior and pairs necessary prohibitions
      with guardrails.
- [ ] Short leading words replace repeated explanations where they improve
      clarity.
- [ ] The invocation class is deliberate and declared for user-invoked skills.
- [ ] `dirf validate` passes and non-final phases declare their gates.
