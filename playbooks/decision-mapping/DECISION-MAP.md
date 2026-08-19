# Decision map

Create one low-resolution map for a genuinely large, unclear effort. Keep the
detail of each accepted answer in its authoritative DIRF artifact; the map links
to that answer and records only its consequence.

## Map shape

```markdown
# <effort>

## Destination
<what must become clear before existing specification and delivery ticketing>

## Exit condition
<how to prove unresolved uncertainty can no longer change the specification>

## Decisions so far
- [<decision name>](artifact) — <one-line consequence>

## Open decisions
- <stable local name>
  - Question: <one precise question>
  - Prerequisites: <decision names or none>
  - Authority: <named human authority when required, otherwise none>

## Ready now
<open decisions whose prerequisites are all accepted; derive, do not store>

## Not yet specified
<in-scope uncertainty that cannot yet be phrased as one precise question>

## Out of scope
<boundaries that will not graduate into this effort>
```

## Rules

- A decision answers a question; a delivery ticket implements an accepted
  specification. Never mix them.
- Keep unclear in-scope work under **Not yet specified**. Do not manufacture a
  vague ticket merely to make the map look complete.
- Derive **Ready now** from prerequisites each time the map is read. It is a
  view, not another state field.
- A human-owned decision names its authority. An agent must not simulate that
  person's answer.
- When an answer exposes, removes, or sharpens another question, update the map.
- Exit when no open or unspecified item can still change the destination's
  specification. Then hand off to the existing specification and delivery-
  ticket workflow.

The first experiment uses ordinary Markdown and existing artifact acceptance.
Do not add provider labels, assignment semantics, graph storage, scheduling, or
locking. Add those only after observed concurrent work demonstrates a concrete
failure that the map cannot represent.
