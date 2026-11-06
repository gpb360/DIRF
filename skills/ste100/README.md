---
name: ste100
kind: skill
description: "Edit human-facing prose to the ASD-STE100 Simplified Technical English writing rules and check it with dirf ste check"
uses: []
details: []
inputs: ["draft prose", "intended audience", "optional approved word list"]
outputs: ["prose that follows the STE writing rules, with the checker result"]
capabilities: ["controlled language"]
---

# Write to ASD-STE100

ASD-STE100 is the Simplified Technical English (STE) standard. Use these rules
for documentation, reports, handoffs, and pull-request text.

1. Write procedural sentences of 20 words or fewer.
2. Write descriptive sentences of 25 words or fewer.
3. Put 6 sentences or fewer in a descriptive paragraph.
4. Write one instruction in each step. Use a numbered list for steps.
5. Use the imperative in instructions. Write "Run the tests".
6. Use the active voice. Name the person or thing that does the action.
7. Use one word for one meaning. Do not change words for variety.
8. Use the simple verb tenses: past, present, and future.
9. Start a warning or a caution with a short command. Give the reason after it.
10. Use approved STE words with their approved meanings, and technical names.
    When the project supplies an approved word list, use only those words.
11. Do not use contractions or semicolons.

Then run the checker:

```bash
dirf ste check <file-or-dir> [--words approved-words.txt]
```

The checker tests rules 1 to 4, 6, and 10. It uses heuristics, so read each
finding before you change the text. Do not change a correct technical term to
make the checker pass.

Do not rewrite code, commands, logs, quotations, machine-readable data, or
verbatim source. Do not invent evidence.

## Approved word list

DIRF does not include the STE dictionary. ASD owns it. To use a dictionary,
put the project's approved words in a text file, one word on each line. Give
the file to `--words`. The checker accepts numbers, code, acronyms, and
capitalized names without a list entry.
