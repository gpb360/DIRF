---
name: cast-panel-polish
kind: workflow
description: "Bring the live Cast slide-out panel + tile grid up to the approved mock on the desktop breakpoint (commit f1189114 → e08517a6 follow-up)."
uses: ["../fullstack-feature"]
details: []
inputs: ["docs/OfficialMobileandDEsktopDEsign.html — Cast section at 1440px+ desktop", "DIRF project observations #33, #34, #35, #36"]
outputs: ["features/story/cast/components/CharacterSlideOutPanel/CharacterSlideOutPanel.tsx (slide-out polish)", "features/story/cast/components/CastAssetManager/CastAssetManager.tsx (tile sizing + Needs confirm)", "features/story/cast/components/CharacterSlideOutPanel/CharacterSlideOutPanel.test.tsx (regression tests)"]
capabilities: ["design conformance", "AGENTS.md color discipline", "mock-driven UI work"]
---

# Cast Panel Polish

Bring the live Cast slide-out panel + tile grid up to the approved mock on the
desktop breakpoint.

## Mock reference

`docs/OfficialMobileandDEsktopDEsign.html` — Cast section, desktop viewport
(1440px+). Three character tiles (MV / EV / HB), each with a small green
status dot top-right. Clicking a tile opens a side panel showing
**PICK AN ANGLE** with five buttons, **PROMPT ANCHOR** field, **ALIASES**,
and **CAST** linked-scene rail. Above the cast grid is a
**SUGGESTED FROM AUDIT** row.

## Phases (cycle 1)

1. **Item 1 — Cast tile sizing.** Enlarge character tiles from 68×68px to
   ~140–160px squares with white initials centered. Match the mock
   footprint. Touch `CastAssetManager.tsx` only.
2. **Item 2 — "Needs confirm" badge style.** Switch from bold orange
   tracked-uppercase to regular-weight light-purple text. Use the
   catalogued `needs-attention` or a cooler violet text color, NOT raw
   orange. Touch `CastAssetManager.tsx` and any shared status-chip
   helper.
3. **Item 3 — "Pick an angle" menu.** Replace the single "Add Angle" button
   in the slide-out with a `PICK AN ANGLE` section offering 5 buttons
   (Full Sheet, Front three-quarter, Side/profile, Back three-quarter,
   Back) + helper text "Defaults to the 3-way split. Poses render
   against the same identity reference." Touch `CharacterSlideOutPanel.tsx`.
4. **Item 4 — Edit Prompt form.** Add a clean form at the top of the
   slide-out panel with: Name, Story Function combobox (Lead / Supporting
   / Background / No label), Appearance textarea, Skin tone chips
   (Light / Medium-light / Medium / Medium-deep / Deep), Personality
   textarea, Cancel + Save brief buttons. Touch
   `CharacterSlideOutPanel.tsx`. The helper text from the mock:
   "These fields build the character's fixed prompt — the full prompt
   itself can't be typed over."

## Acceptance gate

- ✅ Mock parity at the 1440px+ breakpoint for items 1, 2, 3, 4
- ✅ Canonical design-token hex values only — no raw Tailwind palette
- ✅ Existing tests still pass; new regression tests for the new menu + form
- ✅ No console errors, no TypeScript errors

## Handoff

```bash
node ../dirf/src/cli.js run ../dirf/workflows/cast-panel-polish
```

(`dirf run` does not accept `--slug`; the path is the only argument.)