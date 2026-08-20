# Production workflow

## Recommended production route

Record narration locally first, then let the approved track define timing.
Capture live terminal evidence in a clean recording worktree at one exact DIRF
commit. Build only the explanatory motion sections in HyperFrames or the chosen
motion tool. Assemble voice, terminal, diagram, motion, captions, and music in
the existing editor used by the team.

This route keeps product evidence honest and avoids recreating a terminal demo
as animation.

## Phase 0 — recording-day truth gate

Before any screen capture:

1. Fetch the remote and create a clean, isolated recording worktree from the
   chosen release or exact `origin/main` commit.
2. Record the commit SHA and `package.json` version in the episode manifest.
3. Run the full repository validation gate documented at that commit.
4. Run every command used in the script and save its raw output.
5. Remove or mask user names, private paths, project secrets, customer data,
   and unreleased identifiers.

Research began with the primary checkout four commits behind `origin/main`.
It briefly reconciled at
`86347bb49706a87e798231d7826418e29b3ab292`; by the 2026-08-11 production
resume, `origin/main` had advanced four commits to
`886a7627f471bf03f7b1db454fbdaf16c4e38cbc`. Package metadata still reports
v0.26.1. The published v0.26.1 release resolves to
`34267f30b04eb74d3ffd9997f8b3d6ece499e88f` and does not contain the
governed-action CLI used in episode five. The recommended baseline is exact
current `main`, explicitly labeled unreleased and validated in a clean
recording worktree after Gate A/B approval. Do not mix release and main output.

## Phase 1 — voice test

Record the first 60 seconds of episode one locally. Check intelligibility,
warmth, pace, editability, and trust. Keep all audio outside Git; commit only
the text script and timing notes.

## Phase 2 — narration

- Record in paragraphs, not one full take.
- Leave one second of room tone before and after each paragraph.
- Say commands once at natural speed, then let the on-screen text carry syntax.
- Mark any line that feels unnatural while reading. Rewrite the line before
  recording the next section.
- Export clean 48 kHz WAV when possible.

## Phase 3 — screen capture

Use one terminal profile for the series:

- 16:9 canvas
- large monospace font
- no transparent background
- no unrelated tabs or notifications
- shell prompt reduced to project and branch
- mouse pointer hidden unless it teaches a UI action

Capture each command as a separate clip with three beats: ready state, command,
result. Leave two seconds of stillness after the result for editing.

## Phase 4 — motion and diagram assets

The five videos are longer, multi-scene pieces, so the general-video route is
appropriate when production begins. At that time:

1. update the installed general-video workflow as its skill requires;
2. scaffold one reusable DIRF series project;
3. write an approved `BRIEF.md` with companion flow and storyboard review;
4. adopt the final voice, terminal clips, logo, diagram PNG/SVG, and music with
   provenance recorded;
5. create reusable compositions for the opener, route animation, handoff
   transition, comparison lanes, lower thirds, and end card;
6. run the workflow's lint/check and final-preview gates before rendering.

Use `visuals/dirf-operational-precision-master.png` as the polished 16:9 visual
reference. Keep `visuals/dirf-operational-precision.excalidraw` for editable
technical walkthroughs and close-up teaching crops. The old
`dirf-route-record-finish.*` set is a superseded draft and should not appear in
the final videos unless it is intentionally shown as a before/after example.

Build three close-up motion crops from the production master: signal
convergence, route/record/verify, and the canonical handoff crossing the
session/worktree boundary.

## Phase 5 — edit

- Put visible proof under every product claim.
- Change the visual every 8–20 seconds, but do not cut away while the viewer is
  reading a command result.
- Use motion to explain relationships, not to decorate silence.
- Keep chapter transitions under three seconds.
- Put source names on screen for comparison claims and link them in the
  description.
- End with the episode's one command and one next-video recommendation.

## Phase 6 — QA

### Product truth

- commit and version match the manifest
- all commands are readable and reproduce the spoken result
- no future feature is presented as released
- internal operating proof is not labeled customer proof

### Visual

- terminal is readable at 1080p on a laptop-sized player
- diagrams have no clipped text or crossing arrows
- highlights meet contrast requirements
- sensitive paths and data are absent or masked
- thumbnail remains legible at small size

### Audio and captions

- narration is consistent and free of clipped words
- music never competes with commands or definitions
- captions match product names and command syntax
- chapters align with the final edit

### Channel package

- title and thumbnail describe the same promise
- first 20 seconds fulfill that promise
- description contains repository, command, playlist, and source links
- related long-form video is attached to each Short when available

## Episode manifest template

```yaml
episode: 1
title_version: A
recorded_commit: ""
package_version: ""
recorded_at: ""
voice: founder
source_script: scripts/01-why-agent-work-falls-apart.md
commands: []
terminal_clips: []
motion_renders: []
music_source: ""
caption_file: ""
qa_owner: ""
status: planned
```

## Approval gates

- Gate A: positioning and episode order
- Gate B: final scripts and public project naming
- Gate C: voice test and visual treatment
- Gate D: recording-day commit and demo data
- Gate E: final preview per episode
- Gate F: publish or schedule action

Each gate is separate. Approval of this plan does not authorize generation,
render spend, upload, scheduling, or publication.
