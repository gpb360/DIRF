# DIRF Episode 1 video package

## What is ready

- HyperFrames provisional 3:21.12 visual landscape cut: `index.html`
- HyperFrames five-variant 9:16 template: `shorts/index.html`
- Short data set and future batch-render manifest: `shorts/rows.json`
- Remotion 8:00 master plus five registered Short compositions: `remotion/src/`
- Two custom ChatGPT-generated atmospheric plates with recorded provenance
- Narration and Short recording copy ready for local recording

## HyperFrames review

```powershell
cd docs/marketing/dirf-youtube-launch/video-production/episode-01
npm run dev
```

For Shorts:

```powershell
cd docs/marketing/dirf-youtube-launch/video-production/episode-01/shorts
npm run dev
```

The silent compositions passed `hyperframes check --snapshots`. The final
master must pass that gate again after approved local narration is recorded
and synchronized. MP4 rendering is held until that preview is approved.

## Remotion review

```powershell
cd docs/marketing/dirf-youtube-launch/video-production/episode-01/remotion
npm run studio
```

The Studio exposes `DIRF-Episode-01` and five compositions in the
`Episode-01-Shorts` folder. `npm run check` passes TypeScript validation and
composition enumeration.

## Voice integration

No narration asset is committed. Record the test from `VOICEOVER.md` locally,
approve it at Gate C, then synchronize both HyperFrames and the Remotion mirror.
`AUDIO.md` records the local-only boundary.

## Current boundary

No music, final MP4, upload, publish, or scheduling has been run.
