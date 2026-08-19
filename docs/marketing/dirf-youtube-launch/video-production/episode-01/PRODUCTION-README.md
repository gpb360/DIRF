# DIRF Episode 1 video package

## What is ready

- HyperFrames 3:21.12 narrated landscape cut: `index.html`
- HyperFrames five-variant 9:16 template: `shorts/index.html`
- Short data set and future batch-render manifest: `shorts/rows.json`
- Remotion 8:00 master plus five registered Short compositions: `remotion/src/`
- Two custom ChatGPT-generated atmospheric plates with recorded provenance
- Registered, loudness-normalized long-form narration and Short recording copy

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

The previous silent compositions passed `hyperframes check --snapshots`. The
narrated master must pass that gate again after audio synchronization. MP4
rendering is deliberately held until the narrated preview is approved.

## Remotion review

```powershell
cd docs/marketing/dirf-youtube-launch/video-production/episode-01/remotion
npm run studio
```

The Studio exposes `DIRF-Episode-01` and five compositions in the
`Episode-01-Shorts` folder. `npm run check` passes TypeScript validation and
composition enumeration.

## Voice integration

The supplied voice track is integrated into HyperFrames at 48 kHz stereo and
3:21.12. The production copy is normalized to -16 LUFS integrated and -1.5 dBTP.
See `AUDIO.md` for provenance, treatment, and the waveform-aligned cut map.

The Remotion mirror remains at its original 8:00 timing and is intentionally
unchanged because this pass targets the HyperFrames screens. Short voiceovers
remain ready to record from `VOICEOVER.md`.

## Current boundary

No music, final MP4, upload, publish, or scheduling has been run.
