# Amplitude — Waveform Art Generator

A browser app that turns an audio file into a printable waveform poster in the
style of the "soundwave art" prints — a mirrored waveform across a center line,
a serif title, a description block, and a right-aligned metadata column.

Everything runs **entirely in your browser**. Audio is decoded locally with the
Web Audio API and never uploaded anywhere.

![example layout: title on top, waveform in the middle, description bottom-left, metadata bottom-right](docs/example.png)

## Features

- **Drop in any audio file** (MP3, WAV, FLAC, M4A, OGG…) — the real waveform is
  extracted from the decoded PCM.
- **Live editing** of title, description, and a metadata column, with instant
  preview.
- **Style controls:** bar count, amplitude, bar width, rounded caps,
  symmetric/asymmetric waveform, colors, paper texture, black frame, and aspect
  ratio.
- **One-click PNG export** at up to 4000px wide — rendered fresh at full
  resolution so text and bars stay crisp for printing.
- **Demo mode** generates a synthetic waveform so you can explore the layout
  without a file.
- Auto-fills the title from the filename and the track length from the audio
  duration.

## Run it

No build step and no dependencies. Because browsers restrict `file://` pages,
serve the folder over HTTP:

```bash
# any static server works — for example:
python3 -m http.server 8000
# then open http://localhost:8000
```

or

```bash
npx serve .
```

Then open the printed URL, drop in a song, and hit **Download PNG**.

## How the waveform is built

`computePeaks()` walks the decoded samples in `bars` equal buckets. For each
bucket it records the minimum and maximum sample value (channels mixed to
mono), which is what gives a real waveform its uneven top/bottom shape. The
peaks are normalized so the loudest point reaches the full bar height, then
`drawWaveform()` paints one thin bar per bucket around a center baseline.

Preview and export call the **same** `render()` function with different canvas
sizes, so the downloaded PNG always matches the on-screen poster.

## Project layout

```
index.html      markup + control panel
css/style.css   dark editor UI
js/app.js       audio decoding, peak extraction, canvas rendering, PNG export
```

## Notes on Spotify

Spotify's Web API does **not** expose a track's raw audio or PCM, so it can't
produce a true waveform. The one endpoint that came close (`audio-analysis`,
per-segment loudness) was deprecated in November 2024 for newly-created apps.
Spotify is still useful for **metadata** (title, album, year, duration) via the
standard `/tracks` endpoint — that could be wired into the Text panel later as
an optional autofill, but the waveform itself needs the actual audio file.

## License

MIT — do what you like.
