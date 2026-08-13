/* ==========================================================================
   Amplitude — Spotify metadata autofill (optional)

   Uses the Authorization Code + PKCE flow so the app stays purely front-end
   (no client secret). It requests no scopes — the public catalog /tracks
   endpoint is all it needs — and fills the Title, Album, Year and Length
   fields by dispatching 'input' events, which the main app already re-renders
   on. It never touches the audio waveform.

   Requirements (explained in the UI):
     • a free Spotify app Client ID
     • the app served over http(s); the OAuth redirect can't return to file://
   ========================================================================== */

(() => {
  "use strict";

  const AUTH = "https://accounts.spotify.com/authorize";
  const TOKEN = "https://accounts.spotify.com/api/token";
  const API = "https://api.spotify.com/v1";
  const LS_CLIENT = "amp_spotify_client_id";
  const SS_VERIFIER = "amp_spotify_verifier";
  const SS_TOKEN = "amp_spotify_token";        // { access_token, expires_at }

  const $ = (id) => document.getElementById(id);
  const els = {
    panel: $("spotifyPanel"), intro: $("spotifyIntro"),
    clientId: $("spotifyClientId"), redirect: $("spotifyRedirect"),
    connect: $("spotifyConnect"), conn: $("spotifyConn"),
    trackUrl: $("spotifyTrackUrl"), fetch: $("spotifyFetch"),
    status: $("spotifyStatus"),
  };
  if (!els.panel) return; // panel not present

  // The redirect URI is this page's own URL (no query/hash).
  const redirectUri = location.origin + location.pathname;
  const servedOverHttp = location.protocol === "http:" || location.protocol === "https:";

  // ---- helpers -----------------------------------------------------------
  const setStatus = (msg, kind) => {
    els.status.textContent = msg || "";
    els.status.classList.toggle("error", kind === "error");
  };
  const setConn = (msg, cls) => {
    els.conn.textContent = msg;
    els.conn.className = "conn-state" + (cls ? " " + cls : "");
  };
  const setField = (id, value) => {
    const el = $(id);
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true })); // triggers re-render
  };

  const b64url = (bytes) =>
    btoa(String.fromCharCode(...new Uint8Array(bytes)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const randomVerifier = () => {
    const bytes = new Uint8Array(48);
    crypto.getRandomValues(bytes);
    return b64url(bytes); // 64 url-safe chars, within the 43–128 spec range
  };

  const sha256 = async (str) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));

  const parseTrackId = (input) => {
    const m = String(input).match(/track[/:]([A-Za-z0-9]{22})/);
    return m ? m[1] : null;
  };

  const getToken = () => {
    try {
      const t = JSON.parse(sessionStorage.getItem(SS_TOKEN) || "null");
      if (t && t.expires_at > Date.now() + 5000) return t.access_token;
    } catch (_) {}
    return null;
  };

  // ---- OAuth: begin ------------------------------------------------------
  async function connect() {
    const clientId = els.clientId.value.trim();
    if (!clientId) { setStatus("Enter your Client ID first.", "error"); return; }
    localStorage.setItem(LS_CLIENT, clientId);

    const verifier = randomVerifier();
    sessionStorage.setItem(SS_VERIFIER, verifier);
    const challenge = b64url(await sha256(verifier));

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      code_challenge_method: "S256",
      code_challenge: challenge,
      scope: "",                 // public catalog data needs no scopes
    });
    location.assign(`${AUTH}?${params}`);
  }

  // ---- OAuth: complete on redirect back ---------------------------------
  async function completeAuthIfReturning() {
    const url = new URL(location.href);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if (error) {
      setStatus(`Spotify authorization failed: ${error}`, "error");
      cleanUrl();
      return;
    }
    if (!code) return;

    const clientId = (els.clientId.value || localStorage.getItem(LS_CLIENT) || "").trim();
    const verifier = sessionStorage.getItem(SS_VERIFIER);
    if (!clientId || !verifier) { cleanUrl(); return; }

    setStatus("Finishing sign-in…");
    try {
      const body = new URLSearchParams({
        client_id: clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      });
      const res = await fetch(TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.error || "token exchange failed");

      sessionStorage.setItem(SS_TOKEN, JSON.stringify({
        access_token: data.access_token,
        expires_at: Date.now() + (data.expires_in - 30) * 1000,
      }));
      sessionStorage.removeItem(SS_VERIFIER);
      setStatus("Connected to Spotify.");
    } catch (e) {
      setStatus("Sign-in failed: " + e.message, "error");
    } finally {
      cleanUrl();
      reflectConnection();
    }
  }

  const cleanUrl = () =>
    history.replaceState({}, document.title, redirectUri);

  // ---- Track lookup ------------------------------------------------------
  async function autofill() {
    const token = getToken();
    if (!token) { setStatus("Connect to Spotify first.", "error"); return; }
    const id = parseTrackId(els.trackUrl.value.trim());
    if (!id) { setStatus("That doesn’t look like a Spotify track link.", "error"); return; }

    setStatus("Fetching track…");
    try {
      const res = await fetch(`${API}/tracks/${id}`, {
        headers: { Authorization: "Bearer " + token },
      });
      if (res.status === 401) {
        sessionStorage.removeItem(SS_TOKEN);
        reflectConnection();
        throw new Error("session expired — connect again");
      }
      if (!res.ok) throw new Error(`Spotify returned ${res.status}`);
      const t = await res.json();

      const artists = t.artists.map((a) => a.name).join(", ");
      const year = (t.album.release_date || "").slice(0, 4);
      const length = msToTime(t.duration_ms);

      setField("title", `${artists} - ${t.name}`);
      mergeMetaLine("album", `${t.album.name} (album)`);
      if (year) mergeMetaLine("released", `${year} released`);
      mergeMetaLine("length", `${length} length`);

      setStatus(`Filled from “${t.name}”. BPM & signature stay manual.`);
    } catch (e) {
      setStatus("Lookup failed: " + e.message, "error");
    }
  }

  const msToTime = (ms) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  /**
   * Replace an existing metadata line matching `keyword` (case-insensitive),
   * otherwise append the new line. Keeps any manual lines (e.g. BPM) intact.
   */
  function mergeMetaLine(keyword, line) {
    const box = $("metadata");
    const lines = box.value.split("\n");
    const re = new RegExp(keyword, "i");
    const idx = lines.findIndex((l) => re.test(l));
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
    // Drop blank lines so autofill doesn't leave gaps, then re-join.
    box.value = lines.map((l) => l.trim()).filter(Boolean).join("\n");
    box.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // ---- UI state ----------------------------------------------------------
  function reflectConnection() {
    const token = getToken();
    if (token) { setConn("connected", "ok"); els.fetch.disabled = false; }
    else { setConn("not connected", ""); els.fetch.disabled = true; }
  }

  function init() {
    els.redirect.textContent = redirectUri;
    els.clientId.value = localStorage.getItem(LS_CLIENT) || "";

    if (!servedOverHttp) {
      // file:// — OAuth redirect can't work here.
      els.panel.classList.add("disabled");
      els.connect.disabled = true;
      els.fetch.disabled = true;
      setConn("unavailable on file://", "err");
      setStatus("Spotify autofill needs the app served over http(s). Run a local server (see README) to use it.", "error");
      return;
    }

    els.connect.addEventListener("click", connect);
    els.fetch.addEventListener("click", autofill);
    els.clientId.addEventListener("change", () =>
      localStorage.setItem(LS_CLIENT, els.clientId.value.trim()));

    completeAuthIfReturning();
    reflectConnection();
  }

  init();
})();
