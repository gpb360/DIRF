---
name: unslop
kind: skill
description: "Review prose for filler, vague claims, formulaic language, and weak concrete detail while preserving meaning and tone"
uses: []
details: []
inputs: ["draft prose", "intended audience", "required meaning"]
outputs: ["clearer prose with an explicit self-review"]
capabilities: ["prose editing"]
---

# Unslop

Use this as an optional final pass on human-facing prose.

1. Remove filler, puffery, vague attribution, and generic conclusions.
2. Prefer concrete actors, actions, evidence, and ordinary words.
3. Cut repeated ideas, forced lists, synonym cycling, and formulaic framing.
4. Vary sentence length when it improves the reader's understanding.
5. Preserve the author's meaning, audience, and intended tone.
6. Self-audit once. Keep a stylistic preference optional unless the repository
   explicitly requires it.

Do not rewrite code, invent evidence, apply a global vocabulary ban, or add a
dependency. Report any claim that cannot be checked instead of polishing it
into certainty.
