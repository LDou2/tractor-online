/*!
 * Panda R-6 — a retro AM / FM / MP3 radio as a drop-in web component.
 *
 *   <script src="radio.js"></script>
 *   <retro-radio></retro-radio>                                  standalone
 *   <retro-radio floating corner="bottom-left" scale="0.7"></retro-radio>   overlay on any app
 *   <retro-radio floating mini corner="bottom-right"></retro-radio>         compact pill
 *
 * Attributes: floating, corner (top-left|top-right|bottom-left|bottom-right),
 *             mini, scale (number), finish (ivory|graphite|sage|cherry)
 * Floating:   starts as the mini bar, 1.5 inch below the top on the right (until the user changes it).
 *             Drag the handle, speaker or mini bar and let go anywhere — it stays there (remembered).
 *             On phones/tablets it shrinks to fit the screen; the ⤡ button toggles the mini bar.
 * Events:     "radio-change" (detail: {power, band, freq, station, track})
 */
(() => {
  'use strict';
  if (customElements.get('retro-radio')) return;

  const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=Share+Tech+Mono&display=swap';
  const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  const API_HOSTS = ['https://de1.api.radio-browser.info', 'https://fi1.api.radio-browser.info', 'https://de2.api.radio-browser.info'];
  const LS_KEY = 'retro-radio:v1';
  const POS_KEY = 'retro-radio:pos';
  const FLOAT_KEY = 'retro-radio:float';
  const TOUCH = () => matchMedia('(any-pointer:coarse)').matches;
  const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm)$/i;
  const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', webm: 'audio/webm' };

  const BANDS = {
    fm: { min: 87.5, max: 108.0, step: 0.1, unit: 'MHz', dec: 1, slotStart: 87.9, slotStep: 0.2, ghost: '888.8' },
    am: { min: 530, max: 1700, step: 10, unit: 'kHz', dec: 0, slotStart: 540, slotStep: 10, ghost: '8888' },
  };

  // Used only if the station directory can't be reached.
  const FALLBACK = {
    fm: [
      ['Radio Paradise', 'https://stream.radioparadise.com/mp3-128', 'eclectic'],
      ['KEXP 90.3 Seattle', 'https://kexp-mp3-128.streamguys1.com/kexp128.mp3', 'indie'],
      ['Radio Paradise Mellow', 'https://stream.radioparadise.com/mellow-128', 'mellow'],
      ['Radio Paradise Rock', 'https://stream.radioparadise.com/rock-128', 'rock'],
      ['Radio Paradise Global', 'https://stream.radioparadise.com/global-128', 'world'],
      ['FIP', 'https://icecast.radiofrance.fr/fip-midfi.mp3', 'eclectic'],
      ['Jazz Radio', 'https://jazz-wr04.ice.infomaniak.ch/jazz-wr04-128.mp3', 'jazz'],
    ],
    am: [
      ['BBC World Service', 'https://stream.live.vc.bbcmedia.co.uk/bbc_world_service', 'news'],
      ['NPR News', 'https://npr-ice.streamguys1.com/live.mp3', 'news'],
      ['WNYC', 'https://fm939.wnyc.org/wnycfm', 'talk'],
      ['franceinfo', 'https://icecast.radiofrance.fr/franceinfo-midfi.mp3', 'news'],
    ],
  };

  const REGIONS = ['world', 'US', 'GB', 'CA', 'AU', 'IE', 'NZ', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'CH', 'AT', 'SE', 'NO', 'PL', 'PT', 'GR', 'TR', 'JP', 'KR', 'CN', 'TW', 'HK', 'SG', 'IN', 'BR', 'MX', 'AR', 'ZA', 'NG'];

  const ICON = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M6 5h2.4v14H6zM20 5v14L9 12z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M15.6 5H18v14h-2.4zM4 5v14l11-7z"/></svg>',
    seekL: '<svg viewBox="0 0 24 24"><path d="M11.5 6v12L3 12zM21 6v12l-8.5-6z"/></svg>',
    seekR: '<svg viewBox="0 0 24 24"><path d="M12.5 6v12l8.5-6zM3 6v12l8.5-6z"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3c4.5 0 6.5 10 11 10h3M3 17h3c1.6 0 2.8-1.3 3.8-3M14.2 10c1-1.7 2.2-3 3.8-3h2M18 4l3 3-3 3M18 14l3 3-3 3"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11V9a3 3 0 0 1 3-3h12M16 3l3 3-3 3M20 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
    shrink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 12h12"/></svg>',
    power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0"/></svg>',
  };

  /* ---------------- small helpers ---------------- */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } };
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const roundTo = (band, f) => band === 'fm' ? Math.round(f * 10) / 10 : Math.round(f / 10) * 10;
  const fmtFreq = (band, f) => band === 'fm' ? f.toFixed(1) : String(Math.round(f));
  const fmtTime = (s) => { if (!isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60); return `${String(m).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`; };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function ensureFont() {
    if (document.querySelector('link[data-retro-radio-font]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = FONT_HREF; l.dataset.retroRadioFont = '';
    document.head.appendChild(l);
  }

  let jszipPromise = null;
  function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (!jszipPromise) {
      jszipPromise = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = JSZIP_URL; s.onload = () => res(window.JSZip); s.onerror = () => { jszipPromise = null; rej(new Error('Could not load the zip reader')); };
        document.head.appendChild(s);
      });
    }
    return jszipPromise;
  }

  /* ---------------- IndexedDB song store ---------------- */
  const store = {
    _db: null,
    open() {
      if (this._db) return this._db;
      this._db = new Promise((res, rej) => {
        const r = indexedDB.open('retro-radio', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('tracks', { keyPath: 'id' });
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return this._db;
    },
    async tx(mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction('tracks', mode);
        const out = fn(t.objectStore('tracks'));
        t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
        t.onerror = () => rej(t.error);
      });
    },
    all() { return this.tx('readonly', (s) => s.getAll()); },
    put(rec) { return this.tx('readwrite', (s) => s.put(rec)); },
    del(id) { return this.tx('readwrite', (s) => s.delete(id)); },
  };

  /* ---------------- ID3 tags (title / artist / album) ---------------- */
  function decodeText(d) {
    const enc = d[0]; let body = d.subarray(1); let label = 'utf-8';
    if (enc === 0) {
      label = 'latin1';
      // Older Chinese MP3s store GBK bytes while claiming Latin-1.
      if (body.some((x) => x >= 0x80)) {
        try { const g = new TextDecoder('gbk', { fatal: true }).decode(body); if (/[㐀-鿿]/.test(g)) return g.split('\0')[0].trim(); } catch (e) { /* not GBK */ }
      }
    }
    else if (enc === 1) { label = body[0] === 0xFE && body[1] === 0xFF ? 'utf-16be' : 'utf-16le'; }
    else if (enc === 2) label = 'utf-16be';
    try { return new TextDecoder(label).decode(body).replace(/^﻿/, '').split('\0')[0].trim(); } catch (e) { return ''; }
  }
  async function readTags(blob) {
    try {
      const h = new Uint8Array(await blob.slice(0, 10).arrayBuffer());
      if (h[0] !== 0x49 || h[1] !== 0x44 || h[2] !== 0x33) return {};
      const ver = h[3];
      const size = ((h[6] & 127) << 21) | ((h[7] & 127) << 14) | ((h[8] & 127) << 7) | (h[9] & 127);
      const b = new Uint8Array(await blob.slice(10, 10 + Math.min(size, 1500000)).arrayBuffer());
      const ss = (p) => ((b[p] & 127) << 21) | ((b[p + 1] & 127) << 14) | ((b[p + 2] & 127) << 7) | (b[p + 3] & 127);
      const be = (p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
      const out = {}; let p = 0;
      if (ver >= 3 && (h[5] & 0x40)) p = ver === 4 ? ss(0) : be(0) + 4;
      const map = ver === 2 ? { TT2: 'title', TP1: 'artist', TAL: 'album' } : { TIT2: 'title', TPE1: 'artist', TALB: 'album' };
      const hl = ver === 2 ? 6 : 10;
      while (p + hl < b.length) {
        const idLen = ver === 2 ? 3 : 4;
        const id = String.fromCharCode(...b.subarray(p, p + idLen));
        if (!/^[A-Z0-9]+$/.test(id)) break;
        const fs = ver === 2 ? (b[p + 3] << 16) | (b[p + 4] << 8) | b[p + 5] : ver === 4 ? ss(p + 4) : be(p + 4);
        if (!fs) break;
        if (map[id]) out[map[id]] = decodeText(b.subarray(p + hl, p + hl + fs));
        p += hl + fs;
      }
      return out;
    } catch (e) { return {}; }
  }
  function nameToMeta(file) {
    let n = file.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/^\s*\d{1,3}\s*[-.)]?\s+/, '').trim();
    let parts = n.split(/\s+[-–—]\s+/);
    if (parts.length < 2 && /^[^-]{1,24}-[^-]+$/.test(n)) parts = n.split('-'); // "黑鸭子-小城故事"
    return parts.length > 1 ? { artist: parts[0], title: parts.slice(1).join(' - ') } : { title: n };
  }

  /* ---------------- station directory ---------------- */
  async function apiGet(path) {
    const hosts = [...API_HOSTS].sort(() => Math.random() - 0.5);
    for (const host of hosts) {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 7000);
      try {
        const r = await fetch(host + path, { signal: ctl.signal });
        clearTimeout(t);
        if (r.ok) return await r.json();
      } catch (e) { clearTimeout(t); }
    }
    throw new Error('station directory unreachable');
  }
  function cleanStations(rows, limit) {
    const seen = new Set(); const out = [];
    for (const r of rows) {
      const url = r.url_resolved || r.url || '';
      const name = (r.name || '').trim().replace(/\s+/g, ' ');
      if (!name || !/^https:/i.test(url) || /\.m3u8|\.pls|\.m3u(\?|$)/i.test(url) || r.hls === 1) continue;
      if (!/mp3|aac/i.test(r.codec || 'mp3')) continue;
      const key = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 18);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: r.stationuuid || url, name: name.slice(0, 60), url, tag: (r.tags || '').split(',')[0] || '', country: r.countrycode || '' });
      if (out.length >= limit) break;
    }
    return out;
  }
  async function fetchStations(band, region) {
    const key = `retro-radio:st:${band}:${region}`;
    const cached = lsGet(key);
    if (cached && Date.now() - cached.t < 12 * 3600e3 && cached.list.length >= 3) return cached.list;
    const cc = region === 'world' ? '' : `&countrycode=${region}`;
    const base = `/json/stations/search?hidebroken=true&is_https=true&order=clickcount&reverse=true${cc}`;
    let list = [];
    if (band === 'fm') {
      const rows = await apiGet(`${base}&limit=220`);
      const talk = /news|talk|sport|speech|politic|information|religio|christian|islam|church/i;
      list = cleanStations(rows.filter((r) => !talk.test(r.tags || '')), 56);
    } else {
      const [a, b] = await Promise.all([
        apiGet(`${base}&tag=news&limit=90`).catch(() => []),
        apiGet(`${base}&tag=talk&limit=60`).catch(() => []),
      ]);
      list = cleanStations([...a, ...b].sort((x, y) => (y.clickcount || 0) - (x.clickcount || 0)), 40);
    }
    if (list.length < 3) throw new Error('too few stations');
    lsSet(key, { t: Date.now(), list });
    return list;
  }
  function placeOnDial(list, band) {
    const B = BANDS[band]; const slots = [];
    for (let f = B.slotStart; f <= B.max + 1e-6; f += B.slotStep) slots.push(roundTo(band, f));
    const sorted = [...list].sort((a, b) => hash(a.id) - hash(b.id));
    const n = Math.min(sorted.length, slots.length); const sp = slots.length / n;
    return sorted.slice(0, n).map((s, i) => {
      const jitter = sp >= 2 ? hash(s.id + 'j') % Math.floor(sp) : 0;
      return { ...s, f: slots[Math.min(slots.length - 1, Math.floor(i * sp) + jitter)] };
    }).sort((a, b) => a.f - b.f);
  }

  function silentWavUrl() {
    const n = 800; const buf = new ArrayBuffer(44 + n * 2); const v = new DataView(buf);
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  /* ---------------- styles ---------------- */
  const NOISE_TEX = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .22 0 0 0 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

  const CSS = `
  :host{all:initial;display:inline-block;font-family:Inter,system-ui,-apple-system,sans-serif;color-scheme:light;
    --body:#ece3cf;--body2:#d6c9ad;--edge:#b5a685;--ink:#463b2c;--label:#6e5f48;
    --vfd:#86f7df;--vfd-dim:rgba(134,247,223,.08);--amber:#ffab4c;-webkit-tap-highlight-color:transparent}
  :host([finish=graphite]){--body:#4a4d53;--body2:#2e3034;--edge:#1c1d20;--ink:#ece6da;--label:#b8b1a3}
  :host([finish=sage]){--body:#c9d5bf;--body2:#a8b89c;--edge:#86977c;--ink:#2f3b2a;--label:#4f5d48}
  :host([finish=cherry]){--body:#bf3d31;--body2:#962b22;--edge:#6e1b15;--ink:#fff0e4;--label:#f6cfbd}
  :host([floating]){position:fixed;z-index:2147483000}
  :host([movable]:not([floating])){position:relative;left:var(--rr-mx,0px);top:var(--rr-my,0px)}
  :host([movable]:not([floating])) .handle,:host([movable]:not([floating])) .speaker{cursor:grab;touch-action:none}
  :host([floating]:not([corner])),:host([floating][corner=bottom-left]){left:16px;bottom:16px}
  :host([floating][corner=bottom-right]){right:16px;bottom:16px}
  :host([floating][corner=top-left]){left:16px;top:16px}
  :host([floating][corner=top-right]){right:16px;top:16px}
  *{box-sizing:border-box}
  button{font:inherit;color:inherit;cursor:pointer;border:0;padding:0;background:none;-webkit-tap-highlight-color:transparent}
  button:focus-visible,.knob:focus-visible,canvas:focus-visible{outline:2px solid var(--amber);outline-offset:3px}
  svg{display:block}
  /* size via zoom on the inner box: the outer element keeps plain screen pixels in every browser (Safari included) */
  .radio{position:relative;width:520px;zoom:var(--rr-zoom,1);user-select:none;-webkit-user-select:none}
  .full{display:flex;flex-direction:column}
  :host([mini]) .full{display:none}
  :host([mini]) .radio{width:auto}
  .mini-bar{display:none}
  :host([mini]) .mini-bar{display:flex}

  /* handle */
  .handle{position:relative;height:44px;margin:0 86px -8px;z-index:0}
  :host([floating]) .handle,:host([floating]) .mini-bar,:host([floating]) .speaker{cursor:grab;touch-action:none}
  :host([floating]) .handle::before{content:'';position:absolute;inset:-16px -24px 0}
  /* floating over another app: a bright button that stands out on any background */
  :host([floating]) .minbtn{background:var(--amber);color:#2a1d10;box-shadow:0 0 0 2px #fff,0 2px 6px rgba(0,0,0,.45)}
  :host([floating]) .minbtn:hover{color:#000;background:#ffc06e}
  @media (any-pointer:coarse){
    :host([floating]) .handle{height:58px}
    :host([floating]) .strap{height:66px;border-width:18px}
    :host([floating]) .handle::before{inset:-26px -40px 0}
    :host([floating]) .minbtn{right:-84px;top:2px;width:56px;height:56px}
    :host([floating]) .minbtn svg{width:24px;height:24px}
    :host([floating]) .mb{width:42px;height:42px}
    :host([floating]) .mb svg{width:18px;height:18px}
    :host([floating]) .mini-bar{width:380px;height:72px}
  }
  .strap{position:absolute;left:12px;right:12px;top:2px;height:52px;border:11px solid #3b2a1f;border-bottom:0;border-radius:26px 26px 0 0;
    box-shadow:inset 0 2px 0 rgba(255,255,255,.07),0 -1px 0 rgba(0,0,0,.35),0 6px 10px -4px rgba(0,0,0,.3)}
  .strap::after{content:'';position:absolute;inset:-6px -6px 0;border:1.5px dashed rgba(236,205,160,.45);border-bottom:0;border-radius:21px 21px 0 0}
  .lug{position:absolute;bottom:0;width:34px;height:22px;border-radius:7px 7px 2px 2px;background:linear-gradient(90deg,#8e8e8e,#f4f4f4 42%,#c9c9c9 62%,#9a9a9a);box-shadow:0 1px 2px rgba(0,0,0,.45),inset 0 1px 0 #fff}
  .lug.l{left:0}.lug.r{right:0}
  .minbtn{position:absolute;right:-78px;top:6px;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;color:var(--label);
    background:rgba(0,0,0,.06);box-shadow:inset 0 1px 2px rgba(0,0,0,.25)}
  .minbtn svg{width:14px;height:14px}
  .minbtn:hover{color:var(--ink)}

  /* chassis */
  .chassis{position:relative;z-index:1;border-radius:28px;padding:18px 16px 16px;
    background:${NOISE_TEX},linear-gradient(180deg,color-mix(in srgb,var(--body) 80%,#fff) 0%,var(--body) 22%,var(--body2) 100%);
    box-shadow:inset 0 2px 0 rgba(255,255,255,.55),inset 0 -4px 0 rgba(0,0,0,.12),inset 0 0 0 1px rgba(255,255,255,.15),
      0 0 0 1px var(--edge),0 40px 60px -24px rgba(0,0,0,.6),0 14px 22px -10px rgba(0,0,0,.4)}
  .chassis::before{content:'';position:absolute;left:22px;right:22px;top:7px;height:4px;border-radius:2px;
    background:linear-gradient(90deg,transparent,rgba(255,255,255,.85) 20%,#fff 50%,rgba(255,255,255,.85) 80%,transparent);opacity:.55}
  .top{display:grid;grid-template-columns:212px 1fr;gap:14px}

  .speaker{position:relative;height:200px;border-radius:16px;padding:9px;
    background:repeating-linear-gradient(91deg,rgba(0,0,0,.10) 0 1px,transparent 1px 6px),repeating-linear-gradient(87deg,rgba(255,220,180,.07) 0 2px,transparent 2px 14px),linear-gradient(180deg,#8d5733,#5e351c 60%,#4a2914);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.22),inset 0 -2px 5px rgba(0,0,0,.45),0 1px 0 rgba(255,255,255,.6),0 -1px 0 rgba(0,0,0,.15)}
  .grille{height:100%;border-radius:10px;
    background:radial-gradient(circle,#15110d 0 1.55px,transparent 2px) 0 0/7px 7px,radial-gradient(circle,#15110d 0 1.55px,transparent 2px) 3.5px 3.5px/7px 7px,
      linear-gradient(155deg,#e2ddd3,#a59e92 40%,#d6d0c5 66%,#958e82);
    box-shadow:inset 0 3px 7px rgba(0,0,0,.6),inset 0 0 0 1px rgba(0,0,0,.4)}
  .badge{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);padding:6px 14px 5px;border-radius:5px;text-align:center;
    background:linear-gradient(180deg,#fafafa,#bdbdbd 48%,#e6e6e6 52%,#a7a7a7);box-shadow:0 2px 4px rgba(0,0,0,.5),inset 0 1px 0 #fff}
  .badge b{display:block;font:800 13px/1 Inter;letter-spacing:.42em;margin-right:-.42em;color:#3a3a3a;text-shadow:0 1px 0 #fff}
  .badge span{display:block;white-space:nowrap;margin-top:3px;font:600 6.5px/1 Inter;letter-spacing:.24em;color:#666}

  .side{display:flex;flex-direction:column;gap:12px;min-width:0}
  .lcd{position:relative;height:112px;border-radius:11px;padding:9px 12px 0;overflow:hidden;color:var(--vfd);
    font-family:'Share Tech Mono',ui-monospace,Menlo,monospace;
    background:radial-gradient(130% 150% at 50% 0%,#18211f 0%,#0a0e0d 70%);
    box-shadow:inset 0 3px 8px rgba(0,0,0,.85),inset 0 0 0 1px rgba(255,255,255,.04),0 1px 0 rgba(255,255,255,.55),0 0 0 3px rgba(0,0,0,.08)}
  .lcd::after{content:'';position:absolute;inset:0;pointer-events:none;
    background:linear-gradient(158deg,rgba(255,255,255,.10),rgba(255,255,255,0) 42%),repeating-linear-gradient(0deg,rgba(0,0,0,.18) 0 1px,transparent 1px 3px)}
  .lcd .glow{text-shadow:0 0 6px rgba(134,247,223,.55),0 0 1px rgba(134,247,223,.9)}
  .lcd > *{transition:opacity .4s}
  .radio:not(.on) .lcd > *:not(.boot){opacity:0}
  .l1{display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.08em}
  .l-band{padding:1px 5px;border:1px solid currentColor;border-radius:3px;line-height:1.1}
  .l-flags{display:flex;gap:7px;flex:1}
  .l-flags i{font-style:normal;opacity:.09}
  .l-flags i.on{opacity:1}
  .l-sig{display:flex;align-items:flex-end;gap:2px;height:11px}
  .l-sig b{width:3px;background:currentColor;opacity:.1}
  .l-sig b:nth-child(1){height:3px}.l-sig b:nth-child(2){height:5px}.l-sig b:nth-child(3){height:7px}.l-sig b:nth-child(4){height:9px}.l-sig b:nth-child(5){height:11px}
  .l-sig b.on{opacity:1}
  .l2{position:relative;display:flex;align-items:baseline;gap:8px;height:46px;margin-top:2px}
  .l2 .num{position:relative;font-size:46px;line-height:46px;letter-spacing:.02em}
  .l2 .ghost{color:var(--vfd-dim);text-shadow:none}
  .l2 .main{position:absolute;right:0;top:0;white-space:nowrap}
  .l-unit{font-size:13px;letter-spacing:.1em}
  .l3{height:18px;overflow:hidden;white-space:nowrap;font-size:13px;letter-spacing:.06em;margin-top:2px}
  .l3 span{display:inline-block}
  .l3.scroll span{animation:marq var(--marq,10s) linear infinite;padding-left:100%}
  @keyframes marq{from{transform:translateX(0)}to{transform:translateX(-100%)}}
  .vu{position:absolute;left:12px;right:12px;bottom:6px;width:calc(100% - 24px);height:14px}
  .boot{position:absolute;inset:0;display:grid;place-items:center;font-size:22px;letter-spacing:.3em;opacity:0;pointer-events:none}
  .boot.show{animation:boot 1.1s ease}
  @keyframes boot{0%{opacity:0}20%{opacity:1}75%{opacity:1}100%{opacity:0}}

  .knobs{display:flex;justify-content:space-around;align-items:flex-start;padding-top:2px}
  .kw{display:flex;flex-direction:column;align-items:center;gap:8px}
  .kw label{font:700 8.5px/1 Inter;letter-spacing:.22em;color:var(--label);margin-right:-.22em}
  .knob{position:relative;width:62px;height:62px;border-radius:50%;touch-action:none;cursor:grab;outline:none}
  .knob:active{cursor:grabbing}
  .knob::before{content:'';position:absolute;inset:-7px;border-radius:50%;
    background:repeating-conic-gradient(from -1deg,var(--label) 0 2deg,transparent 2deg 22.5deg);
    -webkit-mask:radial-gradient(circle,transparent 34px,#000 35px 38px,transparent 38.5px);mask:radial-gradient(circle,transparent 34px,#000 35px 38px,transparent 38.5px);opacity:.55}
  .rot{position:absolute;inset:0;border-radius:50%;background:repeating-conic-gradient(#7a7a7a 0 3deg,#efefef 3deg 6deg);
    box-shadow:0 7px 10px rgba(0,0,0,.35),0 2px 3px rgba(0,0,0,.45)}
  .cap{position:absolute;inset:7px;border-radius:50%;
    background:radial-gradient(circle at 34% 26%,rgba(255,255,255,.95),rgba(255,255,255,0) 42%),conic-gradient(from 15deg,#d4d4d4,#fafafa,#a6a6a6,#ececec,#9c9c9c,#f4f4f4,#d4d4d4);
    box-shadow:inset 0 -2px 3px rgba(0,0,0,.28),inset 0 2px 2px rgba(255,255,255,.85),0 0 0 1px rgba(0,0,0,.18)}
  .ind{position:absolute;inset:7px;border-radius:50%;pointer-events:none}
  .ind i{position:absolute;top:5px;left:50%;width:6px;height:6px;margin-left:-3px;border-radius:50%;background:#c8372a;box-shadow:inset 0 1px 1px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.4)}

  .dial{position:relative;margin-top:14px;height:80px;border-radius:13px;padding:4px;
    background:linear-gradient(180deg,#f7f7f7,#a2a2a2 48%,#dcdcdc 52%,#eaeaea);box-shadow:0 1px 0 rgba(255,255,255,.7),0 2px 5px rgba(0,0,0,.35)}
  .dial canvas{display:block;width:100%;height:100%;border-radius:9px;cursor:ew-resize;touch-action:none;outline:none;
    background:linear-gradient(#17120e,#0c0907)}
  .radio.on .dial canvas{background:radial-gradient(ellipse 75% 130% at 50% 115%,rgba(255,158,64,.45),transparent 70%),linear-gradient(#24190f,#110b07)}
  .glass{position:absolute;inset:4px;border-radius:9px;pointer-events:none;
    background:linear-gradient(176deg,rgba(255,255,255,.17),rgba(255,255,255,0) 40%),linear-gradient(0deg,rgba(0,0,0,.25),transparent 30%);
    box-shadow:inset 0 2px 6px rgba(0,0,0,.75)}

  .keys{display:flex;gap:6px;margin-top:14px;padding:6px;border-radius:11px;background:rgba(0,0,0,.13);box-shadow:inset 0 2px 4px rgba(0,0,0,.28),0 1px 0 rgba(255,255,255,.45)}
  .key{position:relative;flex:1;height:42px;border-radius:7px;font:700 10.5px/1 Inter;letter-spacing:.14em;color:#3a3a3a;padding-top:8px;
    background:linear-gradient(180deg,#fdfdfd,#dedede 55%,#c4c4c4);box-shadow:0 4px 0 #8a8a8a,0 6px 7px rgba(0,0,0,.32),inset 0 1px 0 #fff;
    transition:transform .07s,box-shadow .07s,background .07s}
  .key:active,.key.on{transform:translateY(3px);box-shadow:0 1px 0 #8a8a8a,0 2px 3px rgba(0,0,0,.3),inset 0 2px 4px rgba(0,0,0,.22);background:linear-gradient(180deg,#e7e7e7,#cdcdcd)}
  .key .led{position:absolute;top:6px;left:50%;width:14px;height:3px;margin-left:-7px;border-radius:2px;background:#6d6259;box-shadow:inset 0 1px 1px rgba(0,0,0,.5)}
  .key.on .led{background:var(--amber);box-shadow:0 0 6px var(--amber)}
  .k-power{flex:.85;color:#9d2c22}
  .k-power .led{background:#b3261e;box-shadow:0 0 5px #e53b2f}
  .radio.on .k-power .led{background:#4ee08a;box-shadow:0 0 6px #4ee08a}
  .k-bt .led{background:#6d6259}
  .k-bt.paired .led{background:#4aa3ff;box-shadow:0 0 6px #4aa3ff}
  .key svg{display:inline-block;width:11px;height:11px;vertical-align:-1px;margin-right:4px}

  .row{display:flex;align-items:center;gap:9px;margin-top:14px;height:38px}
  .r-mp3{display:none}
  .radio.mp3 .r-radio{display:none}
  .radio.mp3 .r-mp3{display:flex}
  .lbl{font:700 8.5px/1 Inter;letter-spacing:.22em;color:var(--label);writing-mode:vertical-rl;transform:rotate(180deg);height:34px;text-align:center}
  .presets{display:flex;gap:7px}
  .bak{color:#eadfc8;background:radial-gradient(circle at 35% 28%,#5a5650,#1d1b19 68%);box-shadow:0 3px 0 #0b0a09,0 5px 7px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.16);transition:transform .07s,box-shadow .07s,color .2s}
  .bak:active{transform:translateY(2px);box-shadow:0 1px 0 #0b0a09,0 2px 3px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.1)}
  .pre{position:relative;width:34px;height:34px;border-radius:50%;font:600 13px/1 'Share Tech Mono',monospace}
  .pre.set::after{content:'';position:absolute;bottom:4px;left:50%;width:4px;height:4px;margin-left:-2px;border-radius:50%;background:var(--amber);box-shadow:0 0 4px var(--amber)}
  .pre.cur{color:var(--amber)}
  .seek{margin-left:auto;display:flex;gap:6px}
  .sq{width:46px;height:34px;border-radius:9px;display:grid;place-items:center}
  .sq svg{width:16px;height:16px;fill:currentColor}
  .sq.big{width:58px}
  .sq.big svg{width:18px;height:18px}
  .pill{height:30px;padding:0 11px;border-radius:15px;display:flex;align-items:center;gap:6px;font:700 8.5px/1 Inter;letter-spacing:.16em;color:var(--ink);
    background:rgba(0,0,0,.1);box-shadow:inset 0 1px 2px rgba(0,0,0,.28),0 1px 0 rgba(255,255,255,.45)}
  .pill svg{width:13px;height:13px}
  .pill.on{background:#2a2420;color:var(--amber);box-shadow:inset 0 1px 3px rgba(0,0,0,.6)}
  .r-mp3 .pill.first{margin-left:auto}

  /* drawers */
  .drawer{display:grid;grid-template-rows:0fr;transition:grid-template-rows .35s ease;margin:0 20px;position:relative;z-index:0}
  .drawer.open{grid-template-rows:1fr}
  :host([floating][corner^=bottom]) .drawer{order:-1}
  .dw{min-height:0;overflow:hidden;background:#1f1c19;color:#efe6d4;border-radius:0 0 15px 15px;font:500 12px/1.4 Inter;
    box-shadow:inset 0 10px 12px -10px rgba(0,0,0,.9),0 14px 24px -12px rgba(0,0,0,.55)}
  :host([floating][corner^=bottom]) .dw{border-radius:15px 15px 0 0;box-shadow:inset 0 -10px 12px -10px rgba(0,0,0,.9),0 -8px 24px -12px rgba(0,0,0,.55)}
  .di{padding:14px 16px 16px}
  .dh{display:flex;align-items:center;gap:8px;margin-bottom:10px}
  .dh b{font:700 11px/1 Inter;letter-spacing:.2em;text-transform:uppercase;color:var(--amber)}
  .dh .count{color:#a99f8d;font-size:11px}
  .sp{flex:1}
  .dbtn{height:26px;padding:0 10px;border-radius:13px;background:#37312b;color:#efe6d4;font:600 11px/1 Inter}
  .dbtn:hover{background:#463e36}
  .x{width:26px;height:26px;border-radius:50%;font-size:18px;line-height:1;color:#a99f8d}
  .x:hover{color:#fff;background:#37312b}
  .tracks{list-style:none;margin:0;padding:0;max-height:228px;overflow:auto;scrollbar-width:thin;scrollbar-color:#4a423a transparent}
  .tracks li{display:grid;grid-template-columns:24px 1fr auto 24px;gap:8px;align-items:center;padding:6px 6px;border-radius:7px;cursor:pointer}
  .tracks li:hover{background:#2c2723}
  .tracks li.cur{background:#332a20;color:var(--amber)}
  .tracks .n{font:12px 'Share Tech Mono',monospace;color:#7d7466;text-align:right}
  .tracks li.cur .n{color:var(--amber)}
  .tracks .t{min-width:0}
  .tracks .t b{display:block;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tracks .t span{display:block;font-size:11px;color:#a99f8d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .tracks .d{font:12px 'Share Tech Mono',monospace;color:#7d7466}
  .tracks .del{width:22px;height:22px;border-radius:50%;color:#7d7466;font-size:15px;opacity:0}
  .tracks li:hover .del{opacity:1}
  .tracks .del:hover{color:#fff;background:#4a2a24}
  .empty{color:#a99f8d;padding:6px 2px 2px}
  .progress{height:3px;border-radius:2px;background:#37312b;margin:0 0 10px;overflow:hidden;display:none}
  .progress.show{display:block}
  .progress i{display:block;height:100%;width:0;background:var(--amber);transition:width .2s}
  section{margin-top:12px}
  section:first-of-type{margin-top:0}
  h4{margin:0 0 6px;font:700 9px/1 Inter;letter-spacing:.2em;text-transform:uppercase;color:#a99f8d}
  .hint{margin:7px 0 0;color:#a99f8d;font-size:11px}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  select{width:100%;height:30px;border-radius:8px;border:1px solid #3d362f;background:#2a2521;color:#efe6d4;font:500 12px Inter;padding:0 8px}
  .out-row{display:flex;gap:8px;align-items:center}
  .out-row select{flex:1}
  .swatches{display:flex;gap:8px}
  .sw{width:26px;height:26px;border-radius:50%;box-shadow:inset 0 -2px 3px rgba(0,0,0,.3),0 0 0 2px #2a2521}
  .sw.on{box-shadow:inset 0 -2px 3px rgba(0,0,0,.3),0 0 0 2px #1f1c19,0 0 0 4px var(--amber)}

  .dropzone{position:absolute;inset:0;z-index:20;display:none;place-items:center;border-radius:28px;border:3px dashed var(--amber);
    background:rgba(20,16,12,.72);color:#fff;font:700 16px Inter;letter-spacing:.08em;text-align:center;pointer-events:none}
  .radio.drag .dropzone{display:grid}

  /* mini pill */
  .mini-bar{align-items:center;gap:8px;width:360px;height:66px;padding:8px 10px 8px 8px;border-radius:20px;
    background:${NOISE_TEX},linear-gradient(180deg,color-mix(in srgb,var(--body) 82%,#fff),var(--body2));
    box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 0 0 1px var(--edge),0 18px 30px -12px rgba(0,0,0,.55)}
  .m-lcd{flex:1;min-width:0;height:50px;border-radius:12px;padding:6px 10px;color:var(--vfd);font-family:'Share Tech Mono',monospace;
    background:radial-gradient(130% 150% at 50% 0%,#18211f,#0a0e0d 70%);box-shadow:inset 0 2px 6px rgba(0,0,0,.85)}
  .m-top{display:flex;gap:8px;align-items:baseline;font-size:20px;line-height:22px}
  .m-top small{font-size:10px;opacity:.85}
  .m-sub{font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:3px;opacity:.9}
  .radio:not(.on) .m-lcd > *{opacity:.12}
  .mb{width:36px;height:36px;border-radius:50%;display:grid;place-items:center;flex:none}
  .mb svg{width:15px;height:15px;fill:currentColor}
  .mb.pw{color:#e8574b}
  .radio.on .mb.pw{color:#4ee08a}
  .mb.ex{background:rgba(0,0,0,.1);color:var(--ink);box-shadow:inset 0 1px 2px rgba(0,0,0,.25)}
  .mb.ex svg{fill:none;width:14px;height:14px}
  `;

  /* ---------------- template ---------------- */
  const knob = (k, label) => `<div class="kw"><div class="knob" data-knob="${k}" tabindex="0" role="slider" aria-label="${label}"><div class="rot"></div><div class="cap"></div><div class="ind"><i></i></div></div><label>${label}</label></div>`;
  const HTML = `
  <style>${CSS}</style>
  <div class="radio" part="radio">
    <div class="mini-bar">
      <button class="mb pw bak" data-act="power" title="Power">${ICON.power}</button>
      <div class="m-lcd glow"><div class="m-top"><span class="m-main">--</span><small class="m-band">FM</small></div><div class="m-sub">&nbsp;</div></div>
      <button class="mb bak" data-act="prev" title="Previous">${ICON.prev}</button>
      <button class="mb bak tg" data-act="toggle" title="Play / pause">${ICON.play}</button>
      <button class="mb bak" data-act="next" title="Next">${ICON.next}</button>
      <button class="mb ex" data-act="expand" title="Full radio">${ICON.expand}</button>
    </div>
    <div class="full">
      <div class="handle"><div class="strap"></div><div class="lug l"></div><div class="lug r"></div>
        <button class="minbtn" data-act="mini" title="Mini player">${ICON.shrink}</button></div>
      <div class="chassis">
        <div class="top">
          <div class="speaker"><div class="grille"></div><div class="badge"><b>PANDA</b><span>R-6 · AM/FM/MP3</span></div></div>
          <div class="side">
            <div class="lcd">
              <div class="l1 glow"><span class="l-band">FM</span>
                <span class="l-flags"><i class="f-st">STEREO</i><i class="f-shuf">SHUF</i><i class="f-rpt">RPT</i><i class="f-bt">BT</i></span>
                <span class="l-sig"><b></b><b></b><b></b><b></b><b></b></span></div>
              <div class="l2"><span class="num"><span class="ghost">888.8</span><span class="main glow">98.1</span></span><span class="l-unit glow">MHz</span></div>
              <div class="l3 glow"><span class="l-sub"></span></div>
              <canvas class="vu" width="460" height="28"></canvas>
              <div class="boot glow">HELLO</div>
            </div>
            <div class="knobs">${knob('vol', 'VOLUME')}${knob('tune', 'TUNING')}</div>
          </div>
        </div>
        <div class="dial"><canvas class="dc" width="960" height="144" tabindex="0" aria-label="Tuning dial"></canvas><div class="glass"></div></div>
        <div class="keys">
          <button class="key k-power" data-act="power"><span class="led"></span>POWER</button>
          <button class="key" data-band="am"><span class="led"></span>AM</button>
          <button class="key" data-band="fm"><span class="led"></span>FM</button>
          <button class="key" data-band="mp3"><span class="led"></span>MP3</button>
          <button class="key k-bt" data-act="bt"><span class="led"></span>BT</button>
        </div>
        <div class="row r-radio">
          <span class="lbl">MEMORY</span>
          <div class="presets">${[1, 2, 3, 4, 5, 6].map((i) => `<button class="pre bak" data-p="${i - 1}" title="Tap: recall · hold: store">${i}</button>`).join('')}</div>
          <div class="seek"><button class="sq bak" data-act="seek-" title="Seek down">${ICON.seekL}</button><button class="sq bak" data-act="seek+" title="Seek up">${ICON.seekR}</button></div>
        </div>
        <div class="row r-mp3">
          <button class="sq bak" data-act="prev" title="Previous">${ICON.prev}</button>
          <button class="sq bak big tg" data-act="toggle" title="Play / pause">${ICON.play}</button>
          <button class="sq bak" data-act="next" title="Next">${ICON.next}</button>
          <button class="pill first" data-act="shuffle">${ICON.shuffle}SHUFFLE</button>
          <button class="pill" data-act="repeat">${ICON.repeat}<span class="rp">REPEAT</span></button>
          <button class="pill" data-act="library">${ICON.list}SONGS</button>
        </div>
      </div>
      <div class="drawer d-lib"><div class="dw"><div class="di">
        <div class="dh"><b>Library</b><span class="count">0 songs</span><span class="sp"></span>
          <button class="dbtn" data-act="add-files">+ Songs / ZIP</button><button class="dbtn" data-act="add-dir">+ Folder</button><button class="x" data-act="close" title="Close">×</button></div>
        <div class="progress"><i></i></div>
        <ol class="tracks"></ol>
        <div class="empty">Drop MP3s or a .zip of your songs onto the radio, or use “+ Songs / ZIP”. Songs stay saved in this browser.</div>
      </div></div></div>
      <div class="drawer d-bt"><div class="dw"><div class="di">
        <div class="dh"><b>Bluetooth &amp; setup</b><span class="sp"></span><button class="x" data-act="close" title="Close">×</button></div>
        <section><h4>Audio output</h4><div class="out-ui"></div><p class="hint out-hint"></p></section>
        <section class="grid2">
          <div><h4>Stations from</h4><select class="region"></select></div>
          <div><h4>Finish</h4><div class="swatches">
            <button class="sw" data-finish="ivory" title="Ivory" style="background:#ece3cf"></button>
            <button class="sw" data-finish="graphite" title="Graphite" style="background:#45484e"></button>
            <button class="sw" data-finish="sage" title="Sage" style="background:#c4d1bb"></button>
            <button class="sw" data-finish="cherry" title="Cherry" style="background:#bf3d31"></button></div></div>
        </section>
      </div></div></div>
    </div>
    <div class="dropzone">Drop songs or a .zip<br>to add them to MP3</div>
    <input type="file" class="in-files" hidden multiple accept="audio/*,.mp3,.m4a,.aac,.ogg,.wav,.flac,.zip,application/zip">
    <input type="file" class="in-dir" hidden webkitdirectory multiple>
  </div>`;

  const DEFAULTS = {
    band: 'fm', freq: { fm: 98.1, am: 880 }, vol: 0.55, presets: { fm: [], am: [] }, region: 'world',
    finish: 'ivory', trackId: null, shuffle: false, repeat: 'all', sinkId: '', sinkLabel: '',
  };

  /* =========================================================== */
  class RetroRadio extends HTMLElement {
    static get observedAttributes() { return ['scale', 'finish', 'mini', 'floating', 'corner']; }

    constructor() {
      super();
      const saved = lsGet(LS_KEY) || {};
      this.s = { ...DEFAULTS, ...saved, freq: { ...DEFAULTS.freq, ...(saved.freq || {}) }, presets: { ...DEFAULTS.presets, ...(saved.presets || {}) } };
      this.on = false;
      this.stations = { fm: null, am: null };
      this.loading = { fm: false, am: false };
      this.signal = 0; this.near = null; this.cur = null;
      this.streamState = 'idle'; // idle | tuning | live | error
      this.radioPaused = false;
      this.tracks = [];
      this.msg = null;
      this.tuneAngle = 0;
      this.ctx = null;
      this.attachShadow({ mode: 'open' }).innerHTML = HTML;
      this.$ = (q) => this.shadowRoot.querySelector(q);
      this.$$ = (q) => [...this.shadowRoot.querySelectorAll(q)];
    }

    attributeChangedCallback(name, _o, v) {
      if (name === 'scale') { this._applyZoom(); this._applyMove(); }
      if (name === 'finish') this.$$('.sw').forEach((b) => b.classList.toggle('on', b.dataset.finish === (v || 'ivory')));
      if (name === 'mini' && this.isConnected) this.renderAll();
      if (!this._init) return;
      // A corner chosen from outside (e.g. a "Float ↘" button) replaces the free position.
      if (name === 'corner' && !this._selfCorner) { this._fpos = null; this._saveFloat(); }
      if (name === 'mini' && this.hasAttribute('floating')) this._saveFloat();
      if (name === 'mini' || name === 'floating' || name === 'corner') this._layoutFloat();
    }

    /* ---------- floating: size + free position ---------- */
    _zoom() {
      const base = parseFloat(this.getAttribute('scale')) || 1;
      if (!this.hasAttribute('floating')) return base;
      const vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight;
      if (this.hasAttribute('mini')) {
        // the pill keeps finger-sized buttons, but never wider than the screen
        return TOUCH() ? Math.min(0.9, (vw - 16) / 380) : Math.min(base, (vw - 16) / 360);
      }
      // full radio: about 520 x 480 at zoom 1
      return TOUCH() ? Math.min(base, 0.6, vw * 0.62 / 520, vh * 0.48 / 500)
        : Math.min(base, (vw - 16) / 520, (vh - 16) / 500);
    }
    _applyZoom() { this.style.setProperty('--rr-zoom', Math.round(this._zoom() * 1000) / 1000); }
    _saveFloat() { lsSet(FLOAT_KEY, { pos: this._fpos || null, mini: this.hasAttribute('mini') }); }
    // Put the radio at this._fpos ({h:'left'|'right', x, v:'top'|'bottom', y} in screen px),
    // anchored to the nearest edges so it grows away from them (e.g. the song list opens upwards).
    _layoutFloat() {
      ['left', 'right', 'top', 'bottom'].forEach((p) => this.style.removeProperty(p));
      this._applyZoom();
      if (!this.hasAttribute('floating') || !this._fpos) return;
      const vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight;
      const r = this.getBoundingClientRect(), p = this._fpos;
      Object.assign(this.style, { left: 'auto', right: 'auto', top: 'auto', bottom: 'auto' });
      this.style[p.h] = `${Math.max(0, Math.min(p.x, vw - r.width))}px`;
      this.style[p.v] = `${Math.max(0, Math.min(p.y, vh - r.height))}px`;
    }
    _dropFloat() {
      const r = this.getBoundingClientRect();
      const vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight;
      const h = r.left + r.width / 2 < vw / 2 ? 'left' : 'right', v = r.top + r.height / 2 < vh / 2 ? 'top' : 'bottom';
      this._fpos = { h, v, x: Math.round(Math.max(0, h === 'left' ? r.left : vw - r.right)), y: Math.round(Math.max(0, v === 'top' ? r.top : vh - r.bottom)) };
      const corner = `${v}-${h}`;
      this._selfCorner = true; this.setAttribute('corner', corner); this._selfCorner = false;
      this._layoutFloat(); this._saveFloat();
      this.dispatchEvent(new CustomEvent('radio-corner', { bubbles: true, composed: true, detail: { corner, position: { ...this._fpos } } }));
    }

    // "movable" (not floating): drag the handle to place the radio anywhere; position is remembered.
    _applyMove() {
      const p = this._pos || { x: 0, y: 0 };
      this.style.setProperty('--rr-mx', `${p.x}px`); this.style.setProperty('--rr-my', `${p.y}px`);
    }
    // Keep the handle reachable: not above "safe-top" (e.g. a page header), not off the sides/bottom.
    _clamp(p, r = this.getBoundingClientRect(), cur = this._pos || { x: 0, y: 0 }) {
      const bx = r.left - cur.x, by = r.top - cur.y; // where it sits with no offset
      const top = parseFloat(this.getAttribute('safe-top')) || 0;
      const x = Math.min(innerWidth - r.width * 0.3 - bx, Math.max(-r.width * 0.7 - bx, p.x));
      const y = Math.max(top - by, Math.min(innerHeight - 60 - by, p.y));
      return { x: Math.round(x), y: Math.round(y) };
    }
    _keepInReach() {
      if (!this.hasAttribute('movable') || this.hasAttribute('floating') || !this._pos) return;
      const p = this._clamp(this._pos);
      if (p.x !== this._pos.x || p.y !== this._pos.y) this._setPos(p);
    }
    _setPos(p, save = true) {
      this._pos = p; this._applyMove();
      if (save) lsSet(POS_KEY, p);
      this.dispatchEvent(new CustomEvent('radio-move', { bubbles: true, composed: true, detail: { ...p } }));
    }

    connectedCallback() {
      if (!this._pos) { const p = lsGet(POS_KEY); this._pos = p && isFinite(p.x) && isFinite(p.y) ? p : { x: 0, y: 0 }; this._applyMove(); }
      requestAnimationFrame(() => requestAnimationFrame(() => this._keepInReach()));
      if (this._init) return; this._init = true;
      addEventListener('resize', () => { clearTimeout(this._reachT); this._reachT = setTimeout(() => { this._keepInReach(); this._layoutFloat(); }, 120); });
      ensureFont();
      if (!this.hasAttribute('finish')) this.setAttribute('finish', this.s.finish);
      if (this.hasAttribute('floating')) {
        const f = lsGet(FLOAT_KEY);
        if (f && f.pos && isFinite(f.pos.x) && isFinite(f.pos.y)) {
          this._fpos = f.pos; this._selfCorner = true; this.setAttribute('corner', `${f.pos.v}-${f.pos.h}`); this._selfCorner = false;
        }
        if (f && typeof f.mini === 'boolean') this.toggleAttribute('mini', f.mini);
        // until the user moves it: about 1.5 inch (144px) below the top, on the right
        if (!this._fpos) {
          this._fpos = { h: 'right', x: 16, v: 'top', y: 144 };
          this._selfCorner = true; this.setAttribute('corner', 'top-right'); this._selfCorner = false;
        }
        if (!f) this.setAttribute('mini', ''); // first visit: start as the mini bar
      }
      this._layoutFloat();
      this.streamEl = new Audio(); this.streamEl.preload = 'none';
      this.mp3El = new Audio(); this.mp3El.preload = 'metadata';
      this.bindAudio();
      this.bindUI();
      this.buildRegionSelect();
      this.renderOutputUI();
      this.loadLibrary();
      this.renderAll();
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }

    // Moving the element (e.g. into a floating container) must not switch it off.
    disconnectedCallback() { setTimeout(() => { if (!this.isConnected && this.on) this.powerOff(true); }, 0); }

    save() { clearTimeout(this._saveT); this._saveT = setTimeout(() => lsSet(LS_KEY, this.s), 250); }
    emit() { this.dispatchEvent(new CustomEvent('radio-change', { bubbles: true, composed: true, detail: { power: this.on, band: this.s.band, freq: this.s.freq[this.s.band], station: this.cur && this.signal > 0.5 ? this.cur.name : null, track: this.curTrack() ? this.curTrack().title : null } })); }

    /* ---------- audio graph ---------- */
    initAudio() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.connect(ctx.destination);
      const mkNoise = (am) => {
        const len = ctx.sampleRate * 4; const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, pop = 0;
        for (let i = 0; i < len; i++) {
          const w = Math.random() * 2 - 1;
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          let v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
          if (am) { if (Math.random() < 0.00035) pop = (Math.random() * 2 - 1) * 0.9; v += pop; pop *= 0.93; v *= 0.8 + 0.2 * Math.sin(i / ctx.sampleRate * 2 * Math.PI * 0.7); }
          d[i] = v;
        }
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const f = ctx.createBiquadFilter();
        if (am) { f.type = 'lowpass'; f.frequency.value = 2600; f.Q.value = 0.9; } else { f.type = 'highpass'; f.frequency.value = 900; }
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(f).connect(g).connect(this.master); src.start();
        return g;
      };
      this.noiseG = { fm: mkNoise(false), am: mkNoise(true) };
      this.whistle = ctx.createOscillator(); this.whistleG = ctx.createGain(); this.whistleG.gain.value = 0;
      this.whistle.type = 'sine'; this.whistle.connect(this.whistleG).connect(this.master); this.whistle.start();
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 128; this.analyser.smoothingTimeConstant = 0.75;
      this.noiseAn = ctx.createAnalyser(); this.noiseAn.fftSize = 128; this.master.connect(this.noiseAn);
      // Routing songs through Web Audio (for the real spectrum) silences files the browser
      // treats as cross-origin — every song when the page is opened by double-click (file://).
      // There, play straight to the speakers and animate the bars instead.
      this.mp3Routed = false;
      if (/^https?:$/.test(location.protocol)) try {
        const src = ctx.createMediaElementSource(this.mp3El);
        src.connect(this.analyser); this.analyser.connect(this.master);
        this.mp3Routed = true;
      } catch (e) { this.mp3Routed = false; }
      this.fData = new Uint8Array(this.analyser.frequencyBinCount);
      // unlock both media elements inside this user gesture (Safari / iOS)
      const silent = silentWavUrl();
      [this.streamEl, this.mp3El].forEach((el) => { if (!el.src) { el.src = silent; el.play().then(() => el.pause()).catch(() => {}); } });
      if (this.s.sinkId) this.applySink(this.s.sinkId, true);
    }

    mix() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime; const v = this.on ? this.s.vol * this.s.vol : 0;
      const band = this.s.band; const radio = band !== 'mp3' && !this.radioPaused && this.on;
      const live = radio && this.streamState === 'live';
      const sig = radio ? this.signal : 0;
      this.streamEl.volume = clamp(live ? v * sig : 0, 0, 1);
      this.mp3El.volume = clamp(band === 'mp3' ? (this.mp3Routed ? 1 : v) : 0, 0, 1);
      // mp3 volume through master when routed
      const masterLevel = band === 'mp3' && this.mp3Routed ? v : 1;
      this.master.gain.setTargetAtTime(masterLevel, t, 0.03);
      const staticAmt = !radio ? 0 : live ? (1 - sig) * 0.9 : this.streamState === 'tuning' && sig > 0.5 ? 0.55 : 1;
      const nv = band === 'mp3' ? 0 : v * 0.3 * staticAmt;
      this.noiseG.fm.gain.setTargetAtTime(band === 'fm' ? nv : 0, t, 0.04);
      this.noiseG.am.gain.setTargetAtTime(band === 'am' ? nv * 1.1 : 0, t, 0.04);
      // AM heterodyne whistle when slightly off a carrier
      let wg = 0;
      if (radio && band === 'am' && this.near) {
        const d = Math.abs(this.s.freq.am - this.near.f) / 10;
        if (d > 0.3 && d < 2.6) { wg = v * 0.035 * (1 - d / 2.6); this.whistle.frequency.setTargetAtTime(380 + d * 1300, t, 0.05); }
      }
      this.whistleG.gain.setTargetAtTime(wg, t, 0.05);
    }

    bindAudio() {
      const se = this.streamEl;
      se.addEventListener('playing', () => { if (se.dataset.sid) { this.streamState = 'live'; this.mix(); this.renderLCD(); this.updateMedia(); this.emit(); } });
      se.addEventListener('waiting', () => { if (this.streamState === 'live') { this.streamState = 'tuning'; this.mix(); this.renderLCD(); } });
      se.addEventListener('error', () => {
        if (!se.dataset.sid) return;
        if (this.cur) this.cur.dead = true;
        this.streamState = 'error'; this.mix(); this.renderLCD(); this.drawDial();
      });
      const me = this.mp3El;
      me.addEventListener('play', () => this.renderTransport());
      me.addEventListener('pause', () => this.renderTransport());
      me.addEventListener('loadedmetadata', () => {
        const t = this.curTrack();
        if (t && isFinite(me.duration) && !t.duration) { t.duration = me.duration; if (t.blob) store.put(t).catch(() => {}); this.renderLibrary(); }
        this.drawDial();
      });
      me.addEventListener('ended', () => {
        if (!me.dataset.tid) return;
        if (this.s.repeat === 'one') { me.currentTime = 0; me.play(); return; }
        const idx = this.trackIndex();
        if (!this.s.shuffle && this.s.repeat === 'off' && idx === this.tracks.length - 1) { this.renderTransport(); return; }
        this.next();
      });
      me.addEventListener('error', () => { if (me.dataset.tid) { this.flash('CAN’T PLAY FILE'); setTimeout(() => this.next(), 1200); } });
    }

    /* ---------- power & bands ---------- */
    powerOn() {
      this.initAudio();
      this.on = true; this.radioPaused = false;
      const boot = this.$('.boot'); boot.textContent = 'HELLO'; boot.classList.remove('show'); void boot.offsetWidth; boot.classList.add('show');
      this.renderAll();
      setTimeout(() => this.enterBand(this.s.band, true), 650);
      ['fm', 'am'].forEach((b) => this.ensureStations(b));
      this.emit();
    }
    powerOff(silent) {
      this.on = false;
      this.stopStream(); this.mp3El.pause();
      this.mix();
      if (!silent) this.renderAll();
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
      this.emit();
    }
    setBand(band) {
      if (!this.on) { this.s.band = band; this.save(); this.powerOn(); return; }
      if (band === this.s.band) { if (band === 'mp3') this.openDrawer('lib'); return; }
      const prev = this.s.band;
      this.s.band = band; this.save();
      if (prev === 'mp3') this.mp3El.pause();
      this.stopStream();
      this.enterBand(band);
    }
    enterBand(band, fromBoot) {
      if (!this.on) return;
      this.renderAll();
      if (band === 'mp3') {
        this.mix();
        if (!this.tracks.length) { this.flash('NO SONGS · ADD SOME', 2500); this.openDrawer('lib'); }
        else if (!this.mp3El.dataset.tid) this.playTrack(this.s.trackId && this.tracks.find((t) => t.id === this.s.trackId) ? this.s.trackId : this.tracks[0].id);
        else this.mp3El.play().catch(() => {});
      } else {
        this.ensureStations(band).then((list) => {
          // First time on this band: land on a real station instead of static.
          if (!this.s.tuned?.[band] && list.length) {
            const f = this.s.freq[band]; const st = list.reduce((a, b) => Math.abs(b.f - f) < Math.abs(a.f - f) ? b : a);
            this.s.tuned = { ...(this.s.tuned || {}), [band]: true }; this.s.freq[band] = st.f; this.save();
          }
          this.tune();
        });
        this.tune();
      }
      this.emit();
    }

    async ensureStations(band) {
      if (this.stations[band]) return this.stations[band];
      if (this.loading[band]) return this.loading[band];
      this.loading[band] = (async () => {
        let list;
        try { list = await fetchStations(band, this.s.region); }
        catch (e) { list = FALLBACK[band].map(([name, url, tag]) => ({ id: url, name, url, tag })); }
        this.stations[band] = placeOnDial(list, band);
        if (!this.s.presets[band].length) {
          const st = this.stations[band]; const n = st.length;
          this.s.presets[band] = [0, 1, 2, 3, 4, 5].map((i) => n ? st[Math.floor((i + 0.5) * n / 6)].f : null);
          this.save();
        }
        this.loading[band] = false;
        if (this.s.band === band) { this.renderLCD(); this.renderPresets(); }
        this.drawDial();
        return this.stations[band];
      })();
      this.renderLCD();
      return this.loading[band];
    }

    /* ---------- tuning ---------- */
    setFreq(f, opts = {}) {
      const band = this.s.band; if (band === 'mp3') return;
      const B = BANDS[band];
      this.s.freq[band] = clamp(roundTo(band, f), B.min, B.max);
      this.save();
      this.tune(opts);
    }
    tune(opts = {}) {
      const band = this.s.band; if (band === 'mp3') return;
      const f = this.s.freq[band]; const B = BANDS[band];
      const list = this.stations[band] || [];
      let near = null, dist = Infinity;
      for (const st of list) { const d = Math.abs(st.f - f); if (d < dist) { dist = d; near = st; } }
      const steps = near ? dist / B.step : Infinity;
      this.near = near;
      this.signal = steps < 0.5 ? 1 : steps < 1.5 ? 0.5 : steps < 2.5 ? 0.14 : 0;
      if (near && near.dead) this.signal = Math.min(this.signal, 0.14);
      if (this.on && !this.radioPaused && this.signal >= 0.5 && near) {
        clearTimeout(this.dropT); this.dropT = null;
        if (this.cur !== near) {
          clearTimeout(this.loadT);
          this.streamState = 'tuning';
          this.loadT = setTimeout(() => this.playStation(near), opts.sweeping ? 700 : 280);
        }
      } else {
        clearTimeout(this.loadT);
        if (this.cur && !this.dropT) this.dropT = setTimeout(() => { this.dropT = null; this.stopStream(); this.mix(); this.renderLCD(); }, 1400);
      }
      this.mix(); this.renderLCD(); this.renderPresets(); this.drawDial(); this.renderKnobs();
      clearTimeout(this._emitT); this._emitT = setTimeout(() => { this.updateMedia(); this.emit(); }, 400);
    }
    playStation(st) {
      if (!this.on || this.s.band === 'mp3') return;
      this.cur = st; this.streamState = 'tuning';
      const el = this.streamEl;
      el.dataset.sid = st.id; el.src = st.url;
      clearTimeout(this.stallT);
      this.stallT = setTimeout(() => {
        if (this.cur === st && this.streamState === 'tuning') { st.dead = true; this.stopStream(); this.streamState = 'error'; this.cur = st; this.tune(); }
      }, 10000);
      el.play().catch((e) => { if (e && e.name === 'NotAllowedError') { this.streamState = 'error'; this.flash('PRESS PLAY'); } });
      this.mix(); this.renderLCD();
    }
    stopStream() {
      clearTimeout(this.loadT); clearTimeout(this.dropT); this.dropT = null;
      const el = this.streamEl; delete el.dataset.sid;
      el.pause(); el.removeAttribute('src'); try { el.load(); } catch (e) {}
      this.cur = null; this.streamState = 'idle';
    }
    animateTo(target, ms = 650) {
      const band = this.s.band; const from = this.s.freq[band];
      cancelAnimationFrame(this._animF);
      const t0 = performance.now(); let prevF = from;
      const step = (now) => {
        const k = clamp((now - t0) / ms, 0, 1); const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const nf = from + (target - from) * e;
        this.tuneAngle += (nf - prevF) / BANDS[band].step * 6; prevF = nf;
        this.setFreq(nf, { sweeping: k < 1 });
        if (k < 1 && this.s.band === band) this._animF = requestAnimationFrame(step);
      };
      this._animF = requestAnimationFrame(step);
    }
    seek(dir) {
      if (!this.on) return;
      const band = this.s.band; const list = (this.stations[band] || []).filter((s) => !s.dead); if (!list.length) return;
      const f = this.s.freq[band]; const eps = BANDS[band].step / 2;
      let t = dir > 0 ? list.find((s) => s.f > f + eps) : [...list].reverse().find((s) => s.f < f - eps);
      if (!t) t = dir > 0 ? list[0] : list[list.length - 1];
      this.flash('SCANNING', 700);
      this.animateTo(t.f, 520 + Math.min(900, Math.abs(t.f - f) / (BANDS[band].max - BANDS[band].min) * 1600));
    }
    preset(i, store) {
      if (!this.on) return;
      const band = this.s.band; if (band === 'mp3') return;
      if (store) { this.s.presets[band][i] = this.s.freq[band]; this.save(); this.flash(`P${i + 1} STORED`); this.renderPresets(); return; }
      const f = this.s.presets[band][i];
      if (f == null) { this.preset(i, true); return; }
      this.animateTo(f, 500);
    }

    /* ---------- mp3 ---------- */
    async loadLibrary() {
      let rows = [];
      try { rows = await store.all(); } catch (e) { this.noIDB = true; }
      rows.sort((a, b) => (a.order ?? a.added) - (b.order ?? b.added));
      const bundled = (window.RETRO_RADIO_PLAYLIST || []).map((t, i) => ({ id: 'b:' + t.src, title: t.title || nameToMeta(t.src.split('/').pop()).title, artist: t.artist || '', credit: t.credit || '', src: t.src, bundled: true, order: -1000 + i }));
      this.tracks = [...bundled, ...rows];
      this.renderLibrary(); this.renderLCD();
    }
    curTrack() { const id = this.mp3El && this.mp3El.dataset.tid; return id ? this.tracks.find((t) => t.id === id) : null; }
    trackIndex() { const t = this.curTrack(); return t ? this.tracks.indexOf(t) : -1; }
    playTrack(id, autoplay = true) {
      const t = this.tracks.find((x) => x.id === id); if (!t) return;
      if (this._blobUrl) { URL.revokeObjectURL(this._blobUrl); this._blobUrl = null; }
      const url = t.src || (this._blobUrl = URL.createObjectURL(t.blob));
      this.mp3El.dataset.tid = t.id; this.mp3El.src = url;
      this.s.trackId = t.id; this.save();
      if (autoplay && this.on && this.s.band === 'mp3') this.mp3El.play().catch(() => {});
      this.renderLCD(); this.renderLibrary(); this.updateMedia(); this.drawDial(); this.emit();
    }
    next() {
      if (!this.tracks.length) return;
      let i = this.trackIndex();
      if (this.s.shuffle && this.tracks.length > 1) { let j; do { j = Math.floor(Math.random() * this.tracks.length); } while (j === i); i = j; }
      else i = (i + 1) % this.tracks.length;
      this.playTrack(this.tracks[i].id);
    }
    prev() {
      if (!this.tracks.length) return;
      if (this.mp3El.currentTime > 3) { this.mp3El.currentTime = 0; return; }
      const i = this.trackIndex();
      this.playTrack(this.tracks[(i - 1 + this.tracks.length) % this.tracks.length].id);
    }
    toggle() {
      if (!this.on) { this.powerOn(); return; }
      if (this.s.band === 'mp3') {
        if (!this.tracks.length) { this.openDrawer('lib'); return; }
        if (!this.mp3El.dataset.tid) { this.playTrack(this.tracks[0].id); return; }
        if (this.mp3El.paused) this.mp3El.play().catch(() => {}); else this.mp3El.pause();
      } else {
        this.radioPaused = !this.radioPaused;
        if (this.radioPaused) { this.stopStream(); this.flash('MUTED', 900); } else this.tune();
        this.mix(); this.renderTransport();
      }
      this.updateMedia();
    }

    async importFiles(files) {
      files = [...files]; if (!files.length) return;
      this.openDrawer('lib');
      const prog = this.$('.progress'); const bar = prog.querySelector('i');
      prog.classList.add('show'); bar.style.width = '0%';
      const jobs = []; // {blob, name}
      try {
        for (const f of files) {
          if (/\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed') {
            this.flash('OPENING ZIP…', 4000);
            const JSZip = await loadJSZip();
            const zip = await JSZip.loadAsync(f);
            zip.forEach((path, entry) => {
              if (!entry.dir && AUDIO_EXT.test(path) && !/(^|\/)(__MACOSX|\._)/.test(path)) jobs.push({ entry, name: path.split('/').pop() });
            });
          } else if (AUDIO_EXT.test(f.name) || (f.type || '').startsWith('audio/')) jobs.push({ blob: f, name: f.name });
        }
      } catch (e) { this.flash('ZIP ERROR', 2500); }
      jobs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      let added = 0, dup = 0; const base = Date.now();
      const have = new Set(this.tracks.map((t) => (t.src ? t.src.split('/').pop() : t.fileName || '').toLowerCase()).filter(Boolean));
      for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        if (have.has(j.name.toLowerCase())) { dup++; continue; } // already in the library (or built in)
        have.add(j.name.toLowerCase());
        try {
          let blob = j.blob || await j.entry.async('blob');
          const ext = (j.name.split('.').pop() || '').toLowerCase();
          if (!blob.type && MIME[ext]) blob = new Blob([blob], { type: MIME[ext] });
          const tag = await readTags(blob); const fromName = nameToMeta(j.name);
          const rec = { id: uid(), title: tag.title || fromName.title, artist: tag.artist || fromName.artist || '', album: tag.album || '', fileName: j.name, blob, size: blob.size, added: base + i, order: base + i };
          if (!this.noIDB) await store.put(rec).catch(() => { this.noIDB = true; });
          this.tracks.push(rec); added++;
        } catch (e) { /* skip unreadable file */ }
        bar.style.width = `${Math.round((i + 1) / jobs.length * 100)}%`;
        if (i % 5 === 4) this.renderLibrary();
      }
      setTimeout(() => prog.classList.remove('show'), 600);
      this.renderLibrary();
      this.flash(added ? `ADDED ${added} SONG${added > 1 ? 'S' : ''}` : dup ? 'ALREADY IN LIBRARY' : 'NO AUDIO FOUND', 2200);
      if (added && this.on && this.s.band === 'mp3' && !this.mp3El.dataset.tid) this.playTrack(this.tracks[this.tracks.length - added].id);
    }
    async deleteTrack(id) {
      const t = this.tracks.find((x) => x.id === id); if (!t || t.bundled) return;
      if (this.mp3El.dataset.tid === id) { this.mp3El.pause(); delete this.mp3El.dataset.tid; this.mp3El.removeAttribute('src'); }
      this.tracks = this.tracks.filter((x) => x.id !== id);
      try { await store.del(id); } catch (e) {}
      this.renderLibrary(); this.renderLCD();
    }

    /* ---------- output / bluetooth ---------- */
    async applySink(id, quiet) {
      const tasks = [];
      if (this.streamEl.setSinkId) tasks.push(this.streamEl.setSinkId(id));
      if (this.ctx && this.ctx.setSinkId) tasks.push(this.ctx.setSinkId(id === 'default' ? '' : id));
      else if (this.mp3El.setSinkId) tasks.push(this.mp3El.setSinkId(id));
      try { await Promise.all(tasks); return true; }
      catch (e) { if (!quiet) this.flash('OUTPUT FAILED', 2000); return false; }
    }
    async renderOutputUI() {
      const ui = this.$('.out-ui'); const hint = this.$('.out-hint');
      const md = navigator.mediaDevices;
      const canSink = 'setSinkId' in HTMLMediaElement.prototype;
      const label = this.s.sinkId && this.s.sinkLabel ? this.s.sinkLabel : 'System default';
      this.$('.k-bt').classList.toggle('paired', !!this.s.sinkId && this.s.sinkId !== 'default');
      hint.textContent = 'Pair your speaker or headphones in your computer’s Bluetooth settings first. Their play / pause / skip buttons then control this radio.';
      if (md && md.selectAudioOutput) {
        ui.innerHTML = `<div class="out-row"><span style="flex:1">Playing on: <b>${esc(label)}</b></span><button class="dbtn" data-act="pick-out">Choose speaker…</button></div>`;
        return;
      }
      if (!canSink || !md || !md.enumerateDevices) {
        ui.innerHTML = `<div>Playing on: <b>your system output</b></div>`;
        hint.textContent = 'This browser always plays through the system output. Pick your Bluetooth speaker in the Sound / Bluetooth menu of your computer, and its buttons will control this radio.';
        return;
      }
      let devs = [];
      try { devs = (await md.enumerateDevices()).filter((d) => d.kind === 'audiooutput'); } catch (e) {}
      const named = devs.some((d) => d.label);
      const opts = devs.length ? devs.map((d, i) => `<option value="${esc(d.deviceId)}"${d.deviceId === (this.s.sinkId || 'default') ? ' selected' : ''}>${esc(d.label || (d.deviceId === 'default' ? 'System default' : `Output ${i + 1}`))}</option>`).join('') : '<option value="default">System default</option>';
      ui.innerHTML = `<div class="out-row"><select class="sink" aria-label="Audio output">${opts}</select>${named ? '<button class="dbtn" data-act="refresh-out">Refresh</button>' : '<button class="dbtn" data-act="names-out" title="The browser only shows device names after you allow microphone access once. Nothing is recorded.">Show names</button>'}</div>`;
      if (!named) hint.textContent = 'To list Bluetooth speakers by name the browser asks for microphone permission once (nothing is recorded). Pair the speaker in your computer’s Bluetooth settings first.';
    }

    /* ---------- UI wiring ---------- */
    bindUI() {
      const root = this.shadowRoot;
      root.addEventListener('pointerdown', () => { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }, true);
      root.addEventListener('click', (e) => {
        const el = e.target.closest('button, li[data-id]'); if (!el) return;
        if (el.dataset.band) return this.setBand(el.dataset.band);
        if (el.dataset.finish) { this.setAttribute('finish', el.dataset.finish); this.s.finish = el.dataset.finish; this.save(); return; }
        if (el.classList.contains('del')) { e.stopPropagation(); return this.deleteTrack(el.closest('li').dataset.id); }
        if (el.tagName === 'LI') { if (this.s.band !== 'mp3' || !this.on) { this.s.band = 'mp3'; this.on ? this.enterBand('mp3') : this.powerOn(); } return this.playTrack(el.dataset.id); }
        const a = el.dataset.act; if (!a) return;
        switch (a) {
          case 'power': return this.on ? this.powerOff() : this.powerOn();
          case 'seek-': return this.seek(-1);
          case 'seek+': return this.seek(1);
          case 'prev': return this.s.band === 'mp3' ? this.prev() : this.seek(-1);
          case 'next': return this.s.band === 'mp3' ? this.next() : this.seek(1);
          case 'toggle': return this.toggle();
          case 'shuffle': this.s.shuffle = !this.s.shuffle; this.save(); this.flash(this.s.shuffle ? 'SHUFFLE ON' : 'SHUFFLE OFF', 900); return this.renderTransport();
          case 'repeat': this.s.repeat = { all: 'one', one: 'off', off: 'all' }[this.s.repeat]; this.save(); this.flash(`REPEAT ${this.s.repeat.toUpperCase()}`, 900); return this.renderTransport();
          case 'library': return this.toggleDrawer('lib');
          case 'bt': return this.toggleDrawer('bt');
          case 'close': return this.openDrawer(null);
          case 'add-files': return this.$('.in-files').click();
          case 'add-dir': return this.$('.in-dir').click();
          case 'mini': this.setAttribute('mini', ''); return;
          case 'expand': this.removeAttribute('mini'); return;
          case 'pick-out': return this.pickOutput();
          case 'refresh-out': return this.renderOutputUI();
          case 'names-out': return this.revealDeviceNames();
        }
      });
      this.$$('.in-files, .in-dir').forEach((inp) => inp.addEventListener('change', () => { this.importFiles(inp.files); inp.value = ''; }));
      root.addEventListener('change', async (e) => {
        if (e.target.classList.contains('sink')) {
          const id = e.target.value; const lbl = e.target.selectedOptions[0].textContent;
          if (await this.applySink(id)) { this.s.sinkId = id === 'default' ? '' : id; this.s.sinkLabel = lbl; this.save(); this.flash(`OUT: ${lbl}`.toUpperCase().slice(0, 40), 1800); this.renderOutputUI(); this.renderLCD(); }
        }
        if (e.target.classList.contains('region')) {
          this.s.region = e.target.value; this.save();
          this.stations = { fm: null, am: null }; this.loading = { fm: false, am: false };
          this.s.presets = { fm: [], am: [] }; this.stopStream();
          if (this.on) { this.ensureStations('fm'); this.ensureStations('am'); if (this.s.band !== 'mp3') this.ensureStations(this.s.band).then(() => this.tune()); }
          this.flash('NEW STATIONS…', 1500);
        }
      });
      if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => this.renderOutputUI());

      // presets: tap = recall, hold = store
      this.$$('.pre').forEach((b) => {
        let t = null, held = false;
        b.addEventListener('pointerdown', () => { held = false; t = setTimeout(() => { held = true; this.preset(+b.dataset.p, true); }, 650); });
        const cancel = () => clearTimeout(t);
        b.addEventListener('pointerup', () => { cancel(); if (!held) this.preset(+b.dataset.p, false); });
        b.addEventListener('pointerleave', cancel);
        b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.preset(+b.dataset.p, e.shiftKey); } });
      });

      // knobs
      this.$$('.knob').forEach((k) => {
        const kind = k.dataset.knob;
        let last = null;
        const ang = (e) => { const r = k.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI; };
        k.addEventListener('pointerdown', (e) => { k.setPointerCapture(e.pointerId); last = ang(e); this._lastY = e.clientY; e.preventDefault(); });
        k.addEventListener('pointermove', (e) => {
          if (last == null) return;
          const a = ang(e); let d = a - last; if (d > 180) d -= 360; if (d < -180) d += 360; last = a;
          this.turnKnob(kind, d);
        });
        const up = () => { last = null; if (kind === 'tune' && this.s.band !== 'mp3') this.tune(); };
        k.addEventListener('pointerup', up); k.addEventListener('pointercancel', up);
        k.addEventListener('wheel', (e) => { e.preventDefault(); this.turnKnob(kind, (e.deltaY < 0 ? 1 : -1) * (kind === 'vol' ? 9 : 6)); }, { passive: false });
        k.addEventListener('keydown', (e) => {
          const map = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 };
          if (map[e.key]) { e.preventDefault(); this.turnKnob(kind, map[e.key] * (kind === 'vol' ? 9 : 6)); }
        });
      });

      // dial: click / drag to tune or scrub
      const dc = this.$('.dc');
      const fromX = (e) => { const r = dc.getBoundingClientRect(); return clamp(((e.clientX - r.left) / r.width * 480 - 38) / 400, 0, 1); };
      let dragging = false;
      const act = (e) => {
        if (!this.on) return;
        const k = fromX(e);
        if (this.s.band === 'mp3') { const d = this.mp3El.duration; if (isFinite(d)) { this.mp3El.currentTime = k * d; this.drawDial(); } }
        else { const B = BANDS[this.s.band]; cancelAnimationFrame(this._animF); this.setFreq(B.min + k * (B.max - B.min), { sweeping: dragging }); }
      };
      dc.addEventListener('pointerdown', (e) => { dragging = true; dc.setPointerCapture(e.pointerId); act(e); });
      dc.addEventListener('pointermove', (e) => { if (dragging) act(e); });
      const dup = () => { if (dragging) { dragging = false; if (this.s.band !== 'mp3') this.tune(); } };
      dc.addEventListener('pointerup', dup); dc.addEventListener('pointercancel', dup);
      dc.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); this.turnKnob('tune', e.key === 'ArrowRight' ? 6 : -6); } });

      // drag & drop songs
      const radio = this.$('.radio'); let dc2 = 0;
      const isFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
      radio.addEventListener('dragenter', (e) => { if (!isFiles(e)) return; e.preventDefault(); dc2++; radio.classList.add('drag'); });
      radio.addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
      radio.addEventListener('dragleave', () => { if (--dc2 <= 0) { dc2 = 0; radio.classList.remove('drag'); } });
      radio.addEventListener('drop', (e) => { e.preventDefault(); dc2 = 0; radio.classList.remove('drag'); if (e.dataTransfer.files.length) this.importFiles(e.dataTransfer.files); });

      // floating: drag by handle / mini bar, snap to nearest corner
      // Follow the pointer until the button is released — anywhere: over the radio, the page,
      // outside the window, or if the browser drops the capture. Never leaves the radio "stuck".
      const track = (e, onMove, onEnd) => {
        const t = e.target; let done = false;
        try { t.setPointerCapture(e.pointerId); } catch (err) { /* ok without capture */ }
        const finish = () => {
          if (done) return; done = true;
          removeEventListener('pointermove', mv, true); removeEventListener('pointerup', finish, true);
          removeEventListener('pointercancel', finish, true); removeEventListener('mouseup', finish, true);
          removeEventListener('blur', finish); t.removeEventListener('lostpointercapture', finish);
          try { t.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
          onEnd();
        };
        const mv = (ev) => { if (ev.pointerId !== e.pointerId) return; if (ev.buttons === 0) return finish(); onMove(ev); };
        addEventListener('pointermove', mv, true); addEventListener('pointerup', finish, true);
        addEventListener('pointercancel', finish, true); addEventListener('mouseup', finish, true);
        addEventListener('blur', finish); t.addEventListener('lostpointercapture', finish);
      };
      const startDrag = (e) => {
        if (e.button !== 0 || e.target.closest('button')) return;
        if (!this.hasAttribute('floating')) {
          if (!this.hasAttribute('movable')) return;
          e.preventDefault();
          const p0 = { ...this._pos }, sx = e.clientX, sy = e.clientY, r = this.getBoundingClientRect();
          track(e, (ev) => {
            this._setPos(this._clamp({ x: p0.x + ev.clientX - sx, y: p0.y + ev.clientY - sy }, r, p0), false);
          }, () => this._setPos(this._pos));
          return;
        }
        e.preventDefault();
        // drag freely; when released it stays exactly there (kept fully on screen)
        const r = this.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
        const vw = document.documentElement.clientWidth || innerWidth, vh = innerHeight;
        this._fpos = { h: 'left', v: 'top', x: r.left, y: r.top };
        track(e, (ev) => {
          const x = Math.max(0, Math.min(vw - r.width, r.left + ev.clientX - sx)), y = Math.max(0, Math.min(vh - r.height, r.top + ev.clientY - sy));
          this._fpos = { h: 'left', v: 'top', x, y }; this._layoutFloat();
        }, () => this._dropFloat());
      };
      this.$('.handle').addEventListener('pointerdown', startDrag);
      this.$('.mini-bar').addEventListener('pointerdown', startDrag);
      this.$('.speaker').addEventListener('pointerdown', startDrag);

      // keyboard shortcuts when the radio has focus
      this.addEventListener('keydown', (e) => {
        if (e.target !== this && !this.shadowRoot.activeElement) return;
        const tag = (this.shadowRoot.activeElement || {}).tagName;
        if (tag === 'SELECT' || tag === 'INPUT') return;
        if (e.key === ' ' && !(this.shadowRoot.activeElement && this.shadowRoot.activeElement.tagName === 'BUTTON')) { e.preventDefault(); this.toggle(); }
        if (e.key === '+' || e.key === '=') this.turnKnob('vol', 9);
        if (e.key === '-') this.turnKnob('vol', -9);
      });
      if (!this.hasAttribute('tabindex')) this.tabIndex = 0;

      // hardware / bluetooth media keys
      if ('mediaSession' in navigator) {
        const ms = navigator.mediaSession; const set = (a, f) => { try { ms.setActionHandler(a, f); } catch (e) {} };
        set('play', () => { if (!this.on) this.powerOn(); else if (this.s.band === 'mp3') this.mp3El.play(); else if (this.radioPaused) this.toggle(); });
        set('pause', () => { if (this.s.band === 'mp3') this.mp3El.pause(); else if (!this.radioPaused) this.toggle(); });
        set('nexttrack', () => this.s.band === 'mp3' ? this.next() : this.seek(1));
        set('previoustrack', () => this.s.band === 'mp3' ? this.prev() : this.seek(-1));
      }
    }

    async pickOutput() {
      try {
        const d = await navigator.mediaDevices.selectAudioOutput();
        if (await this.applySink(d.deviceId)) { this.s.sinkId = d.deviceId; this.s.sinkLabel = d.label; this.save(); this.flash(`OUT: ${d.label}`.toUpperCase().slice(0, 40), 1800); }
      } catch (e) { /* user cancelled */ }
      this.renderOutputUI(); this.renderLCD();
    }
    async revealDeviceNames() {
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); } catch (e) { this.flash('PERMISSION DENIED', 1800); }
      this.renderOutputUI();
    }

    turnKnob(kind, deg) {
      if (kind === 'vol') {
        this.s.vol = clamp(this.s.vol + deg / 270, 0, 1); this.save(); this.mix(); this.renderKnobs();
        if (this.on) this.flash(`VOLUME ${String(Math.round(this.s.vol * 30)).padStart(2, '0')}`, 800);
        return;
      }
      if (!this.on) return;
      this.tuneAngle += deg;
      if (this.s.band === 'mp3') {
        const me = this.mp3El; if (isFinite(me.duration)) me.currentTime = clamp(me.currentTime + deg / 6 * 2, 0, me.duration - 0.2);
        this.renderKnobs(); this.drawDial(); return;
      }
      this._acc = (this._acc || 0) + deg;
      const steps = Math.trunc(this._acc / 6);
      if (steps) { this._acc -= steps * 6; cancelAnimationFrame(this._animF); this.setFreq(this.s.freq[this.s.band] + steps * BANDS[this.s.band].step, { sweeping: true }); }
      this.renderKnobs();
    }

    buildRegionSelect() {
      let dn = null; try { dn = new Intl.DisplayNames([navigator.language || 'en'], { type: 'region' }); } catch (e) {}
      const sel = this.$('.region');
      sel.innerHTML = REGIONS.map((r) => `<option value="${r}"${r === this.s.region ? ' selected' : ''}>${r === 'world' ? 'Whole world' : esc(dn ? dn.of(r) : r)}</option>`).join('');
    }

    openDrawer(which) {
      this.$('.d-lib').classList.toggle('open', which === 'lib');
      this.$('.d-bt').classList.toggle('open', which === 'bt');
      this.$$('[data-act=library]').forEach((b) => b.classList.toggle('on', which === 'lib'));
      this.$('.k-bt').classList.toggle('on', which === 'bt');
      if (which === 'bt') this.renderOutputUI();
      this._drawer = which;
    }
    toggleDrawer(which) { this.openDrawer(this._drawer === which ? null : which); }

    flash(text, ms = 1400) { this.msg = text; clearTimeout(this._msgT); this._msgT = setTimeout(() => { this.msg = null; this.renderLCD(); }, ms); this.renderLCD(); }

    /* ---------- rendering ---------- */
    renderAll() {
      const radio = this.$('.radio');
      radio.classList.toggle('on', this.on);
      radio.classList.toggle('mp3', this.s.band === 'mp3');
      this.$$('.key[data-band]').forEach((k) => k.classList.toggle('on', this.on && k.dataset.band === this.s.band));
      this.$('.k-power').classList.toggle('on', this.on);
      this.renderLCD(); this.renderKnobs(); this.renderPresets(); this.renderTransport(); this.drawDial();
    }
    lcdText() {
      const band = this.s.band;
      if (band === 'mp3') {
        const t = this.curTrack();
        return {
          band: 'MP3', main: fmtTime(this.mp3El.currentTime), unit: '', ghost: '88:88',
          sub: this.msg || (t ? (t.artist ? `${t.artist} — ${t.title}` : t.title) : this.tracks.length ? `${this.tracks.length} SONGS READY` : 'NO SONGS — TAP SONGS TO ADD'),
        };
      }
      const B = BANDS[band]; const f = this.s.freq[band];
      let sub;
      if (this.msg) sub = this.msg;
      else if (this.loading[band] && !this.stations[band]) sub = 'LOADING STATIONS…';
      else if (this.radioPaused) sub = 'MUTED';
      else if (this.near && this.signal >= 0.5) {
        const nm = this.near.name + (this.near.tag ? ` · ${this.near.tag}` : '');
        sub = this.near.dead || (this.streamState === 'error' && this.cur === this.near) ? `NO SIGNAL · ${this.near.name}` : this.streamState === 'live' && this.cur === this.near ? nm : `TUNING… ${this.near.name}`;
      } else if (this.signal > 0) sub = '~ faint signal ~';
      else sub = '· · · · ·';
      return { band: band.toUpperCase(), main: fmtFreq(band, f), unit: B.unit, ghost: B.ghost, sub };
    }
    renderLCD() {
      const d = this.lcdText();
      this.$('.l-band').textContent = d.band;
      this.$('.l2 .main').textContent = d.main;
      this.$('.l2 .ghost').textContent = d.ghost;
      this.$('.l-unit').textContent = d.unit;
      const subEl = this.$('.l-sub');
      if (subEl.textContent !== d.sub) {
        subEl.textContent = d.sub;
        const box = this.$('.l3'); box.classList.remove('scroll');
        requestAnimationFrame(() => {
          if (subEl.scrollWidth > box.clientWidth + 2) { box.style.setProperty('--marq', `${Math.max(6, d.sub.length * 0.28)}s`); box.classList.add('scroll'); }
        });
      }
      const live = this.s.band !== 'mp3' && this.streamState === 'live' && this.cur === this.near;
      const bars = this.s.band === 'mp3' ? 0 : Math.round(this.signal * (live ? 5 : 3));
      this.$$('.l-sig b').forEach((b, i) => b.classList.toggle('on', i < bars));
      this.$('.f-st').classList.toggle('on', this.s.band === 'fm' && live && this.signal === 1);
      this.$('.f-shuf').classList.toggle('on', this.s.band === 'mp3' && this.s.shuffle);
      this.$('.f-rpt').classList.toggle('on', this.s.band === 'mp3' && this.s.repeat !== 'off');
      this.$('.f-rpt').textContent = this.s.repeat === 'one' ? 'RPT1' : 'RPT';
      this.$('.f-bt').classList.toggle('on', !!this.s.sinkId);
      this.$('.k-bt').classList.toggle('paired', !!this.s.sinkId);
      // mini
      this.$('.m-main').textContent = d.main; this.$('.m-band').textContent = `${d.band} ${d.unit}`;
      this.$('.m-sub').textContent = d.sub;
    }
    renderKnobs() {
      const vk = this.$('[data-knob=vol]'); const tk = this.$('[data-knob=tune]');
      const va = -135 + this.s.vol * 270;
      vk.querySelector('.rot').style.transform = vk.querySelector('.ind').style.transform = `rotate(${va}deg)`;
      vk.setAttribute('aria-valuenow', Math.round(this.s.vol * 100));
      tk.querySelector('.rot').style.transform = tk.querySelector('.ind').style.transform = `rotate(${this.tuneAngle}deg)`;
    }
    renderPresets() {
      const band = this.s.band; const ps = band === 'mp3' ? [] : this.s.presets[band] || [];
      this.$$('.pre').forEach((b, i) => {
        b.classList.toggle('set', ps[i] != null);
        b.classList.toggle('cur', this.on && ps[i] != null && band !== 'mp3' && Math.abs(ps[i] - this.s.freq[band]) < 1e-6);
      });
    }
    renderTransport() {
      const playing = this.on && (this.s.band === 'mp3' ? !this.mp3El.paused : !this.radioPaused);
      this.$$('.tg').forEach((b) => { b.innerHTML = playing ? ICON.pause : ICON.play; });
      this.$('[data-act=shuffle]').classList.toggle('on', this.s.shuffle);
      this.$('[data-act=repeat]').classList.toggle('on', this.s.repeat !== 'off');
      this.$('.rp').textContent = this.s.repeat === 'one' ? 'REPEAT 1' : 'REPEAT';
      if ('mediaSession' in navigator && this.on) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
      this.renderLCD();
    }
    renderLibrary() {
      const ol = this.$('.tracks'); const cur = this.mp3El && this.mp3El.dataset.tid;
      ol.innerHTML = this.tracks.map((t, i) => `<li data-id="${esc(t.id)}" class="${t.id === cur ? 'cur' : ''}"><span class="n">${t.id === cur ? '♪' : i + 1}</span><span class="t"><b>${esc(t.title)}</b><span>${esc([t.artist || t.album || '—', t.credit].filter(Boolean).join(' · '))}</span></span><span class="d">${t.duration ? fmtTime(t.duration) : ''}</span>${t.bundled ? '<span></span>' : '<button class="del" title="Remove">×</button>'}</li>`).join('');
      this.$('.count').textContent = `${this.tracks.length} song${this.tracks.length === 1 ? '' : 's'}`;
      this.$('.empty').style.display = this.tracks.length ? 'none' : 'block';
    }
    updateMedia() {
      if (!('mediaSession' in navigator) || !window.MediaMetadata || !this.on) return;
      let title, artist;
      if (this.s.band === 'mp3') { const t = this.curTrack(); if (!t) return; title = t.title; artist = t.artist || 'Panda R-6'; }
      else { title = this.cur ? this.cur.name : `${fmtFreq(this.s.band, this.s.freq[this.s.band])} ${BANDS[this.s.band].unit}`; artist = `${this.s.band.toUpperCase()} ${fmtFreq(this.s.band, this.s.freq[this.s.band])} · Panda R-6`; }
      try { navigator.mediaSession.metadata = new MediaMetadata({ title, artist, album: 'Panda R-6 Radio' }); } catch (e) {}
    }

    drawDial() {
      const c = this.$('.dc'); if (!c) return; const g = c.getContext('2d');
      const W = 480, H = 72; g.setTransform(2, 0, 0, 2, 0, 0); g.clearRect(0, 0, W, H);
      const on = this.on; const band = this.s.band;
      const x0 = 38, x1 = 438; const X = (k) => x0 + k * (x1 - x0);
      const ink = (a) => on ? `rgba(255,236,206,${a})` : `rgba(190,175,150,${a * 0.45})`;
      g.font = '600 9px Inter, system-ui, sans-serif'; g.textBaseline = 'middle';
      let needleK = null;
      if (band === 'mp3') {
        const me = this.mp3El; const dur = isFinite(me.duration) ? me.duration : 0; const k = dur ? me.currentTime / dur : 0;
        g.fillStyle = ink(0.55); g.textAlign = 'left'; g.fillText('MP3', 8, 18);
        const t = this.curTrack(); g.fillStyle = ink(0.9); g.textAlign = 'center';
        g.font = '600 10px Inter, system-ui, sans-serif';
        g.fillText(t ? t.title.slice(0, 60) : 'NO TRACK', W / 2, 18);
        for (let i = 0; i <= 40; i++) { const x = X(i / 40); const major = i % 10 === 0; g.fillStyle = ink(major ? 0.9 : 0.45); g.fillRect(x - 0.5, major ? 32 : 36, 1, major ? 16 : 9); }
        g.fillStyle = on ? 'rgba(255,171,76,.9)' : 'rgba(0,0,0,0)'; g.fillRect(x0, 50, (x1 - x0) * k, 2);
        g.font = '500 9px "Share Tech Mono", monospace'; g.fillStyle = ink(0.75);
        g.textAlign = 'left'; g.fillText(fmtTime(me.currentTime), x0, 61); g.textAlign = 'right'; g.fillText(dur ? fmtTime(dur) : '--:--', x1, 61);
        needleK = k;
      } else {
        const rows = [['fm', 20, [88, 90, 92, 94, 96, 98, 100, 102, 104, 106, 108], 1], ['am', 52, [600, 700, 800, 1000, 1200, 1400, 1600], 50]];
        for (const [b, y, labels, minor] of rows) {
          const B = BANDS[b]; const act = b === band; const a = act ? 1 : 0.38;
          const K = (f) => (f - B.min) / (B.max - B.min);
          g.textAlign = 'left'; g.fillStyle = ink(0.7 * a); g.fillText(b.toUpperCase(), 7, y);
          g.textAlign = 'right'; g.fillText(B.unit, W - 6, y);
          const start = b === 'fm' ? 88 : 550;
          for (let f = start; f <= B.max; f += minor) { const x = X(K(f)); g.fillStyle = ink(0.35 * a); g.fillRect(x - 0.5, y + (b === 'fm' ? 7 : -12), 1, 4); }
          g.textAlign = 'center';
          for (const l of labels) {
            const x = X(K(l)); g.fillStyle = ink(0.95 * a); g.fillText(b === 'am' ? String(l / 10 | 0) : String(l), x, y);
            g.fillRect(x - 0.6, y + (b === 'fm' ? 6 : -14), 1.2, 6);
          }
          if (act && this.stations[b]) {
            for (const st of this.stations[b]) {
              const x = X(K(st.f)); g.fillStyle = st.dead ? ink(0.15) : on ? 'rgba(255,171,76,.75)' : ink(0.2);
              g.beginPath(); g.arc(x, b === 'fm' ? 33 : 39, 1.3, 0, Math.PI * 2); g.fill();
            }
          }
        }
        g.fillStyle = ink(0.18); g.fillRect(x0, 36, x1 - x0, 0.6);
        const B = BANDS[band]; needleK = (this.s.freq[band] - B.min) / (B.max - B.min);
      }
      // needle
      const nx = X(clamp(needleK, 0, 1));
      g.save();
      if (on) { g.shadowColor = 'rgba(255,90,40,.9)'; g.shadowBlur = 8; }
      const grad = g.createLinearGradient(0, 2, 0, H - 2); grad.addColorStop(0, on ? '#ff7a45' : '#7a3a2a'); grad.addColorStop(1, on ? '#ff3b1f' : '#5a2a20');
      g.fillStyle = grad; g.fillRect(nx - 1, 3, 2, H - 6);
      g.restore();
      g.fillStyle = on ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.15)'; g.fillRect(nx - 0.3, 3, 0.6, H - 6);
    }

    loop(now) {
      requestAnimationFrame(this.loop);
      const c = this.$('.vu'); const g = c.getContext('2d'); const W = 460, H = 28;
      g.clearRect(0, 0, W, H);
      if (!this.on) return;
      const N = 30, bw = W / N;
      let levels = new Array(N).fill(0);
      const band = this.s.band;
      if (band === 'mp3' && this.mp3Routed && !this.mp3El.paused) {
        this.analyser.getByteFrequencyData(this.fData);
        for (let i = 0; i < N; i++) { const idx = Math.floor(Math.pow(i / N, 1.6) * (this.fData.length - 4)) + 1; levels[i] = this.fData[idx] / 255; }
      } else if (band === 'mp3' && !this.mp3El.paused) {
        const v = 0.4 + 0.6 * this.s.vol;
        for (let i = 0; i < N; i++) levels[i] = clamp(v * (0.3 + 0.5 * Math.abs(Math.sin(now / (240 + i * 41) + i * 1.3)) * (1 - i / N * 0.55)) * (0.8 + 0.2 * Math.sin(now / 85 + i * 2)), 0, 1);
      } else if (band !== 'mp3' && !this.radioPaused) {
        const live = this.streamState === 'live';
        const s = live ? this.signal : 0; const st = 1 - s;
        for (let i = 0; i < N; i++) {
          const music = s * (0.35 + 0.45 * Math.abs(Math.sin(now / (260 + i * 37) + i * 1.7)) * (1 - i / N * 0.6)) * (0.75 + 0.25 * Math.sin(now / 90 + i));
          const hiss = st * (0.08 + Math.random() * 0.12);
          levels[i] = clamp(music + hiss, 0, 1);
        }
      }
      this._lv = this._lv || new Array(N).fill(0);
      for (let i = 0; i < N; i++) {
        this._lv[i] = Math.max(levels[i], this._lv[i] * 0.86);
        const h = Math.max(1.5, this._lv[i] * H);
        g.fillStyle = 'rgba(134,247,223,.08)'; g.fillRect(i * bw + 1.5, 0, bw - 3, H);
        g.fillStyle = 'rgba(134,247,223,.85)'; g.fillRect(i * bw + 1.5, H - h, bw - 3, h);
      }
      if (band === 'mp3' && (!this._lastT || now - this._lastT > 250)) {
        this._lastT = now;
        const main = fmtTime(this.mp3El.currentTime);
        this.$('.l2 .main').textContent = main; this.$('.m-main').textContent = main;
        if (!this.mp3El.paused) this.drawDial();
      }
    }
  }

  customElements.define('retro-radio', RetroRadio);
  window.RetroRadio = RetroRadio;
})();
