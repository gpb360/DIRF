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

# Edit for clarity

Use this as an optional final pass on human-facing prose.

1. Remove filler, puffery, vague attribution, and generic conclusions.
2. Prefer concrete actors, actions, evidence, and ordinary words.
3. Cut repeated ideas, forced lists, synonym cycling, and formulaic framing.
4. Keep sentences within the ASD-STE100 limits: 20 words for a procedural
   sentence and 25 words for a descriptive sentence. Use the active voice.
5. Preserve the author's meaning, audience, and intended tone.
6. Self-audit once. Run `dirf ste check` on the changed prose files. Keep a
   stylistic preference optional unless the repository explicitly requires it.

Do not rewrite code, invent evidence, or add a dependency. Follow the
approved-word rules in the workflow policy. Do not add a vocabulary ban of your
own. Report any claim that you cannot check. Do not polish it into certainty.
