/* ==========================================================================
   Amplitude — Waveform Art Generator
   Client-side only. Decodes an audio file with the Web Audio API, reduces it
   to per-bar peaks, and renders a poster on a <canvas> that can be exported
   as a high-resolution PNG. Preview and export share one render() function
   so the exported image always matches what you see.
   ========================================================================== */

(() => {
  "use strict";

  // ---- State -------------------------------------------------------------
  const state = {
    audioBuffer: null,  // decoded AudioBuffer (kept for bar-count recompute)
    peaks: null,        // { min:Float32Array, max:Float32Array, bars:int }
    duration: 0,        // seconds
    fileName: "",
  };

  // Cached texture bitmap, regenerated only when size/colour changes.
  let textureCache = { key: "", canvas: null };

  // ---- Elements ----------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const canvas = $("poster");
  const previewCtx = canvas.getContext("2d");

  const els = {
    fileInput: $("fileInput"), dropzone: $("dropzone"), dzStatus: $("dzStatus"),
    downloadBtn: $("downloadBtn"), downloadSvgBtn: $("downloadSvgBtn"), randomizeBtn: $("randomizeBtn"),
    barCount: $("barCount"), barCountVal: $("barCountVal"),
    gain: $("gain"), gainVal: $("gainVal"),
    barWidth: $("barWidth"), barWidthVal: $("barWidthVal"),
    roundCaps: $("roundCaps"), mirror: $("mirror"), smallCaps: $("smallCaps"),
    title: $("title"), description: $("description"), metadata: $("metadata"),
    waveColor: $("waveColor"), bgColor: $("bgColor"), textColor: $("textColor"),
    paperTexture: $("paperTexture"), frame: $("frame"),
    aspect: $("aspect"), exportWidth: $("exportWidth"),
    hint: $("hint"),
  };

  // ======================================================================
  //  Audio decoding + peak extraction
  // ======================================================================
  async function loadAudioFile(file) {
    if (!file) return;
    setStatus(`Decoding “${file.name}”…`, false);
    try {
      const arrayBuf = await file.arrayBuffer();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      const audioBuf = await audioCtx.decodeAudioData(arrayBuf);
      audioCtx.close();

      state.audioBuffer = audioBuf;
      state.duration = audioBuf.duration;
      state.fileName = file.name;
      computePeaks(audioBuf, +els.barCount.value);

      if (!els.title.value.trim()) els.title.value = fileNameToTitle(file.name);
      maybeFillLength();

      setStatus(`Loaded · ${formatTime(audioBuf.duration)} · ${audioBuf.numberOfChannels}ch · ${(audioBuf.sampleRate / 1000).toFixed(1)}kHz`, false);
      els.downloadBtn.disabled = false;
      els.downloadSvgBtn.disabled = false;
      els.hint.style.display = "none";
      render();
    } catch (err) {
      console.error(err);
      setStatus("Could not decode that file. Try a different format (MP3/WAV/M4A).", true);
    }
  }

  /**
   * Reduce an AudioBuffer to `bars` min/max peaks. Keeping both the min and
   * max of each bucket reproduces the asymmetric top/bottom look of a real
   * waveform. Values are normalized so the loudest peak reaches ±1.
   */
  function computePeaks(audioBuf, bars) {
    const chCount = audioBuf.numberOfChannels;
    const channels = [];
    for (let c = 0; c < chCount; c++) channels.push(audioBuf.getChannelData(c));
    const length = audioBuf.length;
    const per = length / bars;

    const min = new Float32Array(bars);
    const max = new Float32Array(bars);
    let globalPeak = 0;

    for (let b = 0; b < bars; b++) {
      const start = Math.floor(b * per);
      const end = Math.min(length, Math.floor((b + 1) * per));
      let lo = 0, hi = 0;
      for (let i = start; i < end; i++) {
        let s = 0;
        for (let c = 0; c < chCount; c++) s += channels[c][i];
        s /= chCount;
        if (s < lo) lo = s;
        if (s > hi) hi = s;
      }
      min[b] = lo; max[b] = hi;
      const p = Math.max(Math.abs(lo), hi);
      if (p > globalPeak) globalPeak = p;
    }
    if (globalPeak > 0) {
      for (let b = 0; b < bars; b++) { min[b] /= globalPeak; max[b] /= globalPeak; }
    }
    state.peaks = { min, max, bars };
  }

  // ======================================================================
  //  Rendering — one function used for both preview and export.
  //  `c` is a 2D context; W/H are that canvas's pixel dimensions.
  // ======================================================================
  function render(c = previewCtx, W = null, H = null) {
    if (c === previewCtx) {
      const aspect = parseFloat(els.aspect.value);
      W = 1600;
      H = Math.round(W / aspect);
      canvas.width = W;
      canvas.height = H;
    }

    const bg = els.bgColor.value;
    const wave = els.waveColor.value;
    const ink = els.textColor.value;

    // Background
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    if (els.paperTexture.checked) drawTexture(c, W, H, bg);

    const M = Math.round(W * 0.05);

    // Title
    const title = els.title.value.trim();
    if (title) {
      c.fillStyle = ink;
      c.textBaseline = "alphabetic";
      drawTitle(c, title, W / 2, Math.round(H * 0.14), W - M * 2, Math.round(H * 0.085));
    }

    drawWaveform(c, W, H, wave);
    drawDescription(c, W, H, ink);
    drawMetadata(c, W, H, ink);
    if (els.frame.checked) drawFrame(c, W, H);
  }

  function drawWaveform(c, W, H, color) {
    if (!state.peaks) return;
    const { min, max, bars } = state.peaks;

    const M = Math.round(W * 0.055);
    const areaW = W - M * 2;
    const centerY = H * 0.5;
    const maxAmp = H * 0.30;
    const gain = parseFloat(els.gain.value);
    const slotW = areaW / bars;
    const barW = Math.max(1, slotW * parseFloat(els.barWidth.value));
    const mirror = els.mirror.checked;
    const round = els.roundCaps.checked;

    c.fillStyle = color;
    c.strokeStyle = color;

    for (let b = 0; b < bars; b++) {
      const x = M + b * slotW + (slotW - barW) / 2;
      let up, down;
      if (mirror) {
        const amp = Math.max(Math.abs(min[b]), max[b]) * gain;
        up = down = amp * maxAmp;
      } else {
        up = max[b] * gain * maxAmp;
        down = -min[b] * gain * maxAmp;
      }
      const topY = centerY - up;
      const h = Math.max((centerY + down) - topY, 1);
      if (round) { roundRect(c, x, topY, barW, h, Math.min(barW / 2, h / 2)); c.fill(); }
      else { c.fillRect(x, topY, barW, h); }
    }

    // Center baseline
    c.lineWidth = Math.max(1, W * 0.0006);
    c.beginPath();
    c.moveTo(M, centerY);
    c.lineTo(W - M, centerY);
    c.stroke();
  }

  function drawDescription(c, W, H, color) {
    const text = els.description.value.trim();
    if (!text) return;
    const size = Math.round(H * 0.017);
    c.fillStyle = color;
    c.textAlign = "left";
    c.textBaseline = "top";
    c.font = `400 ${size}px "Inter", system-ui, sans-serif`;
    const lines = wrapText(c, text, W * 0.32);
    const lineH = size * 1.4;
    let y = H - Math.round(H * 0.055) - lines.length * lineH;
    const x = Math.round(W * 0.05);
    for (const line of lines) { c.fillText(line, x, y); y += lineH; }
  }

  function drawMetadata(c, W, H, color) {
    const raw = els.metadata.value.split("\n").map(s => s.trim()).filter(Boolean);
    if (!raw.length) return;
    const size = Math.round(H * 0.018);
    c.fillStyle = color;
    c.textAlign = "right";
    c.textBaseline = "top";
    c.font = `500 ${size}px "Inter", system-ui, sans-serif`;
    const lineH = size * 1.55;
    let y = H - Math.round(H * 0.055) - raw.length * lineH;
    const rightX = W - Math.round(W * 0.05);
    for (const line of raw) { c.fillText(line, rightX, y); y += lineH; }
  }

  function drawFrame(c, W, H) {
    const t = Math.round(W * 0.018);
    c.fillStyle = "#0a0a0a";
    c.fillRect(0, 0, W, t);
    c.fillRect(0, H - t, W, t);
    c.fillRect(0, 0, t, H);
    c.fillRect(W - t, 0, t, H);
    c.strokeStyle = "rgba(255,255,255,.08)";
    c.lineWidth = 1;
    c.strokeRect(t + .5, t + .5, W - t * 2 - 1, H - t * 2 - 1);
  }

  function drawTexture(c, W, H, bg) {
    const key = `${W}x${H}`;
    if (textureCache.key !== key) {
      const tc = document.createElement("canvas");
      tc.width = W; tc.height = H;
      const tctx = tc.getContext("2d");
      const img = tctx.createImageData(W, H);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 16;
        d[i] = d[i + 1] = d[i + 2] = 128 + n;
        d[i + 3] = 10;
      }
      tctx.putImageData(img, 0, 0);
      tctx.globalAlpha = 0.04;
      tctx.strokeStyle = "#000";
      for (let y = 0; y < H; y += 3) { tctx.beginPath(); tctx.moveTo(0, y); tctx.lineTo(W, y); tctx.stroke(); }
      tctx.globalAlpha = 1;
      textureCache = { key, canvas: tc };
    }
    c.drawImage(textureCache.canvas, 0, 0);
  }

  // ======================================================================
  //  Text helpers
  // ======================================================================
  /**
   * Draw the poster title. In small-caps mode (default) each character is drawn
   * as a capital: letters that were typed lowercase render as smaller capitals,
   * while already-uppercase letters and non-letters stay at full cap height —
   * genuine small-caps, e.g. "Back in Black" → B‑ACK ‑IN‑ B‑LACK, and an
   * acronym like "ACDC" stays full height. Falls back to plain uppercase when
   * the small-caps toggle is off.
   */
  const TITLE_FAMILY = `"Playfair Display", Georgia, serif`;
  const TITLE_WEIGHT = "700";
  const SMALL_CAP = 0.74; // small-cap height relative to full caps

  /**
   * Compute the title layout once so the canvas and SVG exporters render it
   * identically. Returns either an uppercase layout or a per-glyph small-caps
   * layout. `c` is any 2D context used only for text measurement.
   */
  function computeTitleLayout(c, text, cx, baseline, maxWidth, startSize) {
    if (!els.smallCaps.checked) {
      const upper = text.toUpperCase();
      const size = fitText(c, upper, maxWidth, startSize, TITLE_WEIGHT, "Playfair Display");
      return { smallCaps: false, text: upper, size, cx, baseline };
    }

    const runs = Array.from(text).map((ch) => {
      const isLower = ch.toLowerCase() === ch && ch.toUpperCase() !== ch;
      return { glyph: ch.toUpperCase(), small: isLower };
    });
    const widthAt = (full) => {
      let w = 0;
      for (const r of runs) {
        c.font = `${TITLE_WEIGHT} ${(r.small ? full * SMALL_CAP : full)}px ${TITLE_FAMILY}`;
        w += c.measureText(r.glyph).width;
      }
      return w;
    };
    let size = startSize;
    while (size > 8 && widthAt(size) > maxWidth) size -= 2;

    const glyphs = [];
    let x = cx - widthAt(size) / 2;             // absolute x of each glyph
    for (const r of runs) {
      const s = r.small ? size * SMALL_CAP : size;
      c.font = `${TITLE_WEIGHT} ${s}px ${TITLE_FAMILY}`;
      glyphs.push({ glyph: r.glyph, size: s, x });
      x += c.measureText(r.glyph).width;
    }
    return { smallCaps: true, glyphs, baseline };
  }

  function drawTitle(c, text, cx, baseline, maxWidth, startSize) {
    const L = computeTitleLayout(c, text, cx, baseline, maxWidth, startSize);
    if (!L.smallCaps) {
      c.font = `${TITLE_WEIGHT} ${L.size}px ${TITLE_FAMILY}`;
      c.textAlign = "center";
      c.fillText(L.text, L.cx, L.baseline);
      return;
    }
    c.textAlign = "left";
    for (const g of L.glyphs) {
      c.font = `${TITLE_WEIGHT} ${g.size}px ${TITLE_FAMILY}`;
      c.fillText(g.glyph, g.x, L.baseline);
    }
  }

  function fitText(c, text, maxWidth, startSize, weight, family) {
    let size = startSize;
    c.font = `${weight} ${size}px "${family}", serif`;
    while (c.measureText(text).width > maxWidth && size > 8) {
      size -= 2;
      c.font = `${weight} ${size}px "${family}", serif`;
    }
    return size;
  }

  function wrapText(c, text, maxWidth) {
    const words = text.replace(/\s+/g, " ").split(" ");
    const lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (c.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
      else { line = test; }
    }
    if (line) lines.push(line);
    return lines;
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // ======================================================================
  //  Export — render straight to an offscreen canvas at target resolution.
  // ======================================================================
  function download() {
    const W = parseInt(els.exportWidth.value, 10);
    const H = Math.round(W / parseFloat(els.aspect.value));
    const off = document.createElement("canvas");
    off.width = W; off.height = H;
    const octx = off.getContext("2d");
    render(octx, W, H);           // vector-crisp at full resolution
    textureCache = { key: "", canvas: null };  // invalidate (size differed)
    render();                     // restore preview at its own size

    off.toBlob((blob) => saveBlob(blob, "png"), "image/png");
  }

  // ======================================================================
  //  SVG / vector export — a true resolution-independent copy of the poster,
  //  built from the same layout math as the canvas renderer.
  // ======================================================================
  const xmlEscape = (s) => String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  async function downloadSVG() {
    // Coordinate space matches the preview (W=1600); vectors scale freely.
    const W = 1600;
    const H = Math.round(W / parseFloat(els.aspect.value));
    const fontUri = await getFontDataUri();      // embed for a portable file
    const svg = buildSVG(W, H, fontUri);
    saveBlob(new Blob([svg], { type: "image/svg+xml" }), "svg");
  }

  function buildSVG(W, H, fontUri) {
    const c = previewCtx;                        // used only for measurement
    const bg = els.bgColor.value;
    const wave = els.waveColor.value;
    const ink = els.textColor.value;
    const parts = [];

    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);

    // Embedded font (falls back to Georgia/serif if unavailable).
    const face = fontUri
      ? `@font-face{font-family:'Playfair Display';font-weight:700;font-style:normal;src:url(${fontUri}) format('woff2');}`
      : "";
    parts.push(`<defs><style>${face}</style>` + texturePaperDef() + `</defs>`);

    // Background
    parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="${xmlEscape(bg)}"/>`);
    if (els.paperTexture.checked) {
      parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#808080" filter="url(#paper)" opacity="0.06"/>`);
    }

    // Title
    const title = els.title.value.trim();
    if (title) {
      const M = Math.round(W * 0.05);
      const L = computeTitleLayout(c, title, W / 2, Math.round(H * 0.14), W - M * 2, Math.round(H * 0.085));
      if (!L.smallCaps) {
        parts.push(`<text x="${L.cx}" y="${L.baseline}" text-anchor="middle" font-family="${TITLE_FAMILY_ATTR}" font-weight="700" font-size="${L.size}" fill="${xmlEscape(ink)}">${xmlEscape(L.text)}</text>`);
      } else {
        const spans = L.glyphs.map((g) =>
          `<tspan x="${round2(g.x)}" font-size="${round2(g.size)}">${xmlEscape(g.glyph)}</tspan>`).join("");
        parts.push(`<text y="${L.baseline}" text-anchor="start" font-family="${TITLE_FAMILY_ATTR}" font-weight="700" fill="${xmlEscape(ink)}">${spans}</text>`);
      }
    }

    parts.push(svgWaveform(W, H, wave));
    parts.push(svgDescription(c, W, H, ink));
    parts.push(svgMetadata(W, H, ink));
    if (els.frame.checked) parts.push(svgFrame(W, H));

    parts.push(`</svg>`);
    return parts.join("\n");
  }

  const TITLE_FAMILY_ATTR = "&apos;Playfair Display&apos;, Georgia, serif";
  const INTER_ATTR = "&apos;Inter&apos;, system-ui, sans-serif";
  const round2 = (n) => Math.round(n * 100) / 100;

  function texturePaperDef() {
    // Vector-native paper grain via turbulence (renders in browsers/Illustrator).
    return `<filter id="paper"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>`;
  }

  function svgWaveform(W, H, color) {
    if (!state.peaks) return "";
    const { min, max, bars } = state.peaks;
    const M = Math.round(W * 0.055);
    const areaW = W - M * 2;
    const centerY = H * 0.5;
    const maxAmp = H * 0.30;
    const gain = parseFloat(els.gain.value);
    const slotW = areaW / bars;
    const barW = Math.max(1, slotW * parseFloat(els.barWidth.value));
    const mirror = els.mirror.checked;
    const rx = els.roundCaps.checked ? Math.min(barW / 2, 999) : 0;

    let rects = "";
    for (let b = 0; b < bars; b++) {
      const x = M + b * slotW + (slotW - barW) / 2;
      let up, down;
      if (mirror) { const amp = Math.max(Math.abs(min[b]), max[b]) * gain; up = down = amp * maxAmp; }
      else { up = max[b] * gain * maxAmp; down = -min[b] * gain * maxAmp; }
      const topY = centerY - up;
      const h = Math.max((centerY + down) - topY, 1);
      const r = rx ? ` rx="${round2(Math.min(rx, h / 2))}"` : "";
      rects += `<rect x="${round2(x)}" y="${round2(topY)}" width="${round2(barW)}" height="${round2(h)}"${r}/>`;
    }
    const lw = Math.max(1, W * 0.0006);
    return `<g fill="${xmlEscape(color)}">${rects}</g>` +
      `<line x1="${M}" y1="${centerY}" x2="${W - M}" y2="${centerY}" stroke="${xmlEscape(color)}" stroke-width="${round2(lw)}"/>`;
  }

  function svgDescription(c, W, H, color) {
    const text = els.description.value.trim();
    if (!text) return "";
    const size = Math.round(H * 0.017);
    c.font = `400 ${size}px "Inter", system-ui, sans-serif`;
    const lines = wrapText(c, text, W * 0.32);
    const lineH = size * 1.4;
    const x = Math.round(W * 0.05);
    let y = H - Math.round(H * 0.055) - lines.length * lineH;
    // Canvas uses textBaseline "top"; approximate with a baseline nudge.
    const spans = lines.map((ln) => {
      const ty = round2(y + size * 0.82); y += lineH;
      return `<tspan x="${x}" y="${ty}">${xmlEscape(ln)}</tspan>`;
    }).join("");
    return `<text font-family="${INTER_ATTR}" font-weight="400" font-size="${size}" fill="${xmlEscape(color)}">${spans}</text>`;
  }

  function svgMetadata(W, H, color) {
    const raw = els.metadata.value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!raw.length) return "";
    const size = Math.round(H * 0.018);
    const lineH = size * 1.55;
    const rightX = W - Math.round(W * 0.05);
    let y = H - Math.round(H * 0.055) - raw.length * lineH;
    const spans = raw.map((ln) => {
      const ty = round2(y + size * 0.82); y += lineH;
      return `<tspan x="${rightX}" y="${ty}">${xmlEscape(ln)}</tspan>`;
    }).join("");
    return `<text text-anchor="end" font-family="${INTER_ATTR}" font-weight="500" font-size="${size}" fill="${xmlEscape(color)}">${spans}</text>`;
  }

  function svgFrame(W, H) {
    const t = Math.round(W * 0.018);
    return `<g fill="#0a0a0a">` +
      `<rect x="0" y="0" width="${W}" height="${t}"/>` +
      `<rect x="0" y="${H - t}" width="${W}" height="${t}"/>` +
      `<rect x="0" y="0" width="${t}" height="${H}"/>` +
      `<rect x="${W - t}" y="0" width="${t}" height="${H}"/></g>` +
      `<rect x="${t + 0.5}" y="${t + 0.5}" width="${W - t * 2 - 1}" height="${H - t * 2 - 1}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`;
  }

  // Obtain the title font as a data: URI so the SVG is self-contained.
  // Order: an already-embedded @font-face (single-file bundle) → the local
  // asset (served version) → null (SVG falls back to system serif).
  let _fontUri = undefined;
  async function getFontDataUri() {
    if (_fontUri !== undefined) return _fontUri;
    // 1) Look for an inline @font-face data URI already in the document.
    try {
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch (_) { continue; }
        for (const rule of rules) {
          if (rule.cssText && /Playfair Display/i.test(rule.cssText)) {
            // Browsers may re-serialize the src as url("data:...") with quotes.
            const m = rule.cssText.match(/url\(\s*["']?(data:font[^)"']+)["']?\s*\)/);
            if (m) return (_fontUri = m[1]);
          }
        }
      }
    } catch (_) {}
    // 2) Fetch the local asset and encode it.
    try {
      const res = await fetch("assets/fonts/playfair-display-700-latin.woff2");
      if (res.ok) {
        const buf = await res.arrayBuffer();
        let bin = ""; const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return (_fontUri = "data:font/woff2;base64," + btoa(bin));
      }
    } catch (_) {}
    return (_fontUri = null);
  }

  function saveBlob(blob, ext) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (els.title.value.trim() || "waveform").replace(/[^\w\-]+/g, "_") + "." + ext;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ======================================================================
  //  Wiring
  // ======================================================================
  function setStatus(msg, isError) {
    els.dzStatus.textContent = msg;
    els.dzStatus.classList.toggle("error", !!isError);
  }

  function maybeFillLength() {
    if (!state.duration) return;
    const meta = els.metadata.value;
    if (!/length/i.test(meta)) {
      els.metadata.value = (meta ? meta.replace(/\s*$/, "") + "\n" : "") + `${formatTime(state.duration)} length`;
    }
  }

  function bind() {
    els.fileInput.addEventListener("change", (e) => loadAudioFile(e.target.files[0]));
    ["dragenter", "dragover"].forEach(evt =>
      els.dropzone.addEventListener(evt, (e) => { e.preventDefault(); els.dropzone.classList.add("drag"); }));
    ["dragleave", "drop"].forEach(evt =>
      els.dropzone.addEventListener(evt, (e) => { e.preventDefault(); els.dropzone.classList.remove("drag"); }));
    els.dropzone.addEventListener("drop", (e) => {
      const f = e.dataTransfer.files[0];
      if (f) loadAudioFile(f);
    });

    const rerender = () => render();
    [els.title, els.description, els.metadata, els.waveColor, els.bgColor,
     els.textColor, els.aspect].forEach(el => el.addEventListener("input", rerender));
    [els.paperTexture, els.frame, els.roundCaps, els.mirror, els.smallCaps].forEach(el =>
      el.addEventListener("change", rerender));
    els.aspect.addEventListener("change", () => { textureCache = { key: "", canvas: null }; render(); });

    els.barCount.addEventListener("input", () => { els.barCountVal.textContent = els.barCount.value; });
    els.barCount.addEventListener("change", () => {
      if (state.audioBuffer) computePeaks(state.audioBuffer, +els.barCount.value);
      else if (state.peaks) loadDemo();   // resize synthetic demo too
      render();
    });
    els.gain.addEventListener("input", () => {
      els.gainVal.textContent = parseFloat(els.gain.value).toFixed(2) + "×"; render();
    });
    els.barWidth.addEventListener("input", () => {
      els.barWidthVal.textContent = parseFloat(els.barWidth.value).toFixed(2); render();
    });

    els.downloadBtn.addEventListener("click", download);
    els.downloadSvgBtn.addEventListener("click", downloadSVG);
    els.randomizeBtn.addEventListener("click", loadDemo);
  }

  // Synthetic waveform so the layout can be explored without a file.
  function loadDemo() {
    const bars = +els.barCount.value;
    const min = new Float32Array(bars), max = new Float32Array(bars);
    for (let b = 0; b < bars; b++) {
      const t = b / bars;
      const env = Math.sin(Math.PI * t) * (0.55 + 0.45 * Math.sin(t * 6.28 * 1.5));
      const noise = (Math.random() * 0.9 + 0.1);
      const v = Math.min(1, Math.abs(env) * noise);
      max[b] = v;
      min[b] = -v * (0.7 + Math.random() * 0.6);
    }
    state.audioBuffer = null;
    state.peaks = { min, max, bars };
    state.duration = 255;
    if (!els.title.value) els.title.value = "Your Artist - Track Title";
    if (!els.description.value) els.description.value = "Add a short description of the track here. This block wraps to the width of the lower-left column, just like the printed posters that inspired this layout.";
    if (!els.metadata.value) els.metadata.value = "4:15 length\n120 BPM\n4/4 signature\nAlbum Name (album)\n1980 released\nLabel (label)";
    els.downloadBtn.disabled = false;
    els.downloadSvgBtn.disabled = false;
    els.hint.style.display = "none";
    setStatus("Demo waveform loaded (synthetic).", false);
    render();
  }

  // ======================================================================
  //  Utils
  // ======================================================================
  function formatTime(sec) {
    sec = Math.round(sec);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  }
  function fileNameToTitle(name) {
    return name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
  }

  // Ensure custom fonts are ready before the first paint so title metrics fit.
  bind();
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => render());
  }
  render();
})();
