/* ==========================================================================
   Build a single, self-contained amplitude.html.

   Inlines css/style.css and js/app.js into index.html, and embeds the
   Playfair Display font as a base64 data URI so the result works fully
   offline (double-click the file — no server, no network). The audio still
   never leaves the browser; File objects are read locally.

   Usage:  node build.js
   Output: dist/amplitude.html
   ========================================================================== */

const fs = require("fs");
const path = require("path");

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const html = read("index.html");
const css = read("css/style.css");
// Scripts inlined in load order.
const scripts = ["js/app.js", "js/spotify.js"];

// Embed the font as a data URI.
const fontB64 = fs
  .readFileSync(path.join(root, "assets/fonts/playfair-display-700-latin.woff2"))
  .toString("base64");
const fontFace = `
    @font-face {
      font-family: 'Playfair Display';
      font-style: normal;
      font-weight: 700;
      font-display: swap;
      src: url(data:font/woff2;base64,${fontB64}) format('woff2');
    }`;

let out = html;

// Drop the Google Fonts <link>/<preconnect> tags — the font is now embedded.
out = out.replace(
  /\s*<link rel="preconnect"[^>]*>/g, ""
);
out = out.replace(
  /\s*<link href="https:\/\/fonts\.googleapis\.com[^>]*>/g, ""
);

// Replace the external stylesheet link with an inline <style> (font + app CSS).
out = out.replace(
  /\s*<link rel="stylesheet" href="css\/style\.css"\s*\/?>/,
  `\n  <style>${fontFace}\n${css}\n  </style>`
);

// Replace each external script with an inline <script>, preserving order.
for (const src of scripts) {
  const tag = new RegExp(`\\s*<script src="${src.replace(/[/.]/g, "\\$&")}"><\\/script>`);
  out = out.replace(tag, `\n  <script>\n${read(src)}\n  </script>`);
}

const outDir = path.join(root, "dist");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "amplitude.html");
fs.writeFileSync(outPath, out);

const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`Wrote ${path.relative(root, outPath)} (${kb} KB, fully self-contained)`);

// Sanity checks: nothing external should remain.
const leaks = [];
if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(out)) leaks.push("google fonts reference");
if (/<link[^>]+href=|<script[^>]+src=/.test(out)) leaks.push("external link/script tag");
if (leaks.length) { console.error("WARNING — external refs remain:", leaks.join(", ")); process.exit(1); }
console.log("OK — no external references remain.");
