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

### Option A — single file on your desktop (recommended)

A prebuilt, fully self-contained version lives at **`dist/amplitude.html`**. It
has the CSS, JavaScript, and serif font all embedded, so you can **just
double-click it** — no server, no network, no install. Audio files you open are
read locally and never uploaded.

To regenerate it after changing the source:

```bash
node build.js        # writes dist/amplitude.html
```

### Option B — the source folder

The multi-file source (`index.html` + `css/` + `js/`) also runs directly, but
some browsers restrict `file://` pages, so serve it over HTTP:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
# or:  npx serve .
```

Then drop in a song and hit **Download PNG**.

## Title style

The title renders as genuine **small caps** (toggle in the Text panel): letters
you type in lowercase become smaller capitals, while letters typed uppercase
stay full height. So `ACDC - Back in Black` keeps the acronym at full height and
sets the rest as small caps — matching the printed-poster look. Turn the toggle
off for plain all-uppercase.

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

## Fonts

The embedded title font is **Playfair Display** by Claus Eggers Sørensen,
distributed under the [SIL Open Font License 1.1](https://openfontlicense.org/).
Only the 700-weight Latin subset (~23 KB) is bundled, for offline use.

## License

App code: MIT — do what you like. The bundled font retains its own OFL license.
