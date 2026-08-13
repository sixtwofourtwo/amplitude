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
    downloadBtn: $("downloadBtn"), randomizeBtn: $("randomizeBtn"),
    barCount: $("barCount"), barCountVal: $("barCountVal"),
    gain: $("gain"), gainVal: $("gainVal"),
    barWidth: $("barWidth"), barWidthVal: $("barWidthVal"),
    roundCaps: $("roundCaps"), mirror: $("mirror"),
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
      const upper = title.toUpperCase();
      c.fillStyle = ink;
      c.textAlign = "center";
      c.textBaseline = "alphabetic";
      const size = fitText(c, upper, W - M * 2, Math.round(H * 0.085), "700", "Playfair Display");
      c.font = `700 ${size}px "Playfair Display", Georgia, serif`;
      c.fillText(upper, W / 2, Math.round(H * 0.14));
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

    off.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (els.title.value.trim() || "waveform").replace(/[^\w\-]+/g, "_") + ".png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, "image/png");
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
    [els.paperTexture, els.frame, els.roundCaps, els.mirror].forEach(el =>
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
