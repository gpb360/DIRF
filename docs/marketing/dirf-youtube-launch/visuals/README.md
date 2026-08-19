# DIRF visual system

## Production recommendation

Use `dirf-operational-precision-master.png` as the 16:9 hero frame, opener
reference, and motion-design keyframe. It is the polished production direction.

Use `dirf-operational-precision.excalidraw` only when the video needs an
editable technical explainer. Excalidraw is useful for live teaching, but it
should not carry the full brand identity by itself.

## Current assets

- `dirf-operational-precision-master.png` — production master, 1920 × 1080
- `dirf-operational-precision.excalidraw` — editable technical source
- `OPERATIONAL-PRECISION.md` — design philosophy and visual rules
- `dirf-route-record-finish.*` — superseded first draft; retain only for
  comparison until the final motion package is approved

## Visual argument

Scattered task, repository, and capability signals converge through a single
DIRF aperture. The selected route becomes a visible proof spine—route, record,
verify—before crossing a session/worktree boundary as a canonical handoff.

The master includes real product evidence:

- `dirf flow "review this PR"`
- routed `code-review → security-review → tests`
- `node --test` as specific verification
- one exact next action in the canonical handoff

## Validation

- Canvas master rendered at 1920 × 1080 in headless Chrome
- Visually inspected at original resolution in two refinement passes
- No clipped text, unintended overlap, or off-canvas elements
- Excalidraw JSON parses with 48 unique elements
- The official Excalidraw PNG renderer still times out waiting for its remote
  `esm.sh` module; this is a renderer dependency failure, not a JSON failure

