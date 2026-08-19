# Episode 1 audio and cue sheet

## Registered narration

- Source supplied by the project owner: `dirf.wma`
- Source content: MP3 audio in a WMA-named container path
- Production asset: `.media/audio/voice/voice_001.mp3`
- Format: MP3, 48 kHz, stereo, 192 kb/s
- Duration: 3:21.12
- Source SHA-256: `2037af26cca12e8e1cce88dd9f1b536a05800105ed5a956c86772a39e7b48314`
- Production SHA-256: `cc61af97c7032ea53b3a4b3ad7d002a8d1fea5f4ce62e07e6f0eba3ffe58e57e`

The original file was not modified. The production derivative was normalized
from approximately -37.9 LUFS to -16.0 LUFS integrated, with a -1.5 dBTP true
peak. It is registered as `voice_001` in `.media/manifest.jsonl`.

## HyperFrames cue map

The authored seven-part chapter proportions were projected onto the measured
audio duration, then each cut was moved to the nearest detected breath or
silence. This avoids changing screens in the middle of a spoken phrase.

| Scene | Start | End | Duration |
|---|---:|---:|---:|
| 01 — Archaeological site | 0:00.00 | 0:15.49 | 15.49s |
| 02 — Wrong route | 0:15.49 | 0:58.42 | 42.93s |
| 03 — Context drift | 0:58.42 | 1:38.39 | 39.97s |
| 04 — Completion fog | 1:38.39 | 2:05.65 | 27.26s |
| 05 — Route / Record / Finish line | 2:05.65 | 2:43.23 | 37.58s |
| 06 — Honest boundaries | 2:43.23 | 3:08.99 | 25.76s |
| 07 — First command | 3:08.99 | 3:21.12 | 12.13s |

## Music pass, later

Keep narration dominant. A restrained, lyric-free technical pulse can sit near
-27 LUFS under speech, duck 3–5 dB on dense phrases, and fade before the final
command resolves. Music sourcing and licensing remain a separate approval gate.
