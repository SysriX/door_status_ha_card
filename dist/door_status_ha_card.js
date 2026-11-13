/* ======================================================================
 * home-twin-tuerstatus-card – Türstatus fürs Flur-Tablet (Wohnungstür + Haustür)
 * Version 1.1.1 (2026-10-30) – ab 1.1.0 Bausteine für raum-panel (teil:)
 *
 * Wohnungstür (Nuki über MQTT): verriegelt/entriegelt/offen, Akku, letzte Aktion mit Person
 *   (aus dem Logbuch: HA-Benutzer → Person, Skript/Automation → deren Name, sonst „am Schloss / App“),
 *   Türkontakt offen/zu + „offen seit“.
 * Haustür (Ring Intercom „Vordereingang“): letzte Klingel (+ Bild, falls Kamera/Snapshot vorhanden),
 *   Taste Live-Bild (Kamera-Overlay), Taste „Haustür öffnen“ (script.haustuer_oeffnen, mit Bestätigung).
 *   Das Klingel-Popup (script.klingel_popup / Browser Mod) bleibt unverändert.
 *
 * Optik wie raum-panel v2 (Glasplatte, Tasten, Kacheln, Rajdhani / Share Tech Mono).
 * Name HOME-TWIN-* → raum-panel.js schaltet die globale Charlie-Schrift automatisch ein.
 *
 * Optionen (alle optional, Standard = echte Entitäten):
 *   titel: Türen
 *   layout: auto | hoch | breit          (auto: ab 640 px Breite nebeneinander)
 *   hintergrund: true                    (false = ohne eigene Glasplatte, z. B. in einem raum-panel-Rahmen)
 *   zeigen: [wohnungstuer, haustuer]     (Reihenfolge/Auswahl der Bereiche)
 *   schloss: lock.wohnungstur
 *   schloss_akku: sensor.wohnungstur_battery
 *   schloss_akku_kritisch: binary_sensor.wohnungstur_battery_critical
 *   schloss_laden: binary_sensor.wohnungstur_battery_charging
 *   kontakt: binary_sensor.fl_door
 *   offen_warnung: 5                     (Minuten, ab denen „Tür offen“ rot wird)
 *   klingel: sensor.vordereingang_letztes_klingeln
 *   klingel_aktiv: binary_sensor.vordereingang_klingeln
 *   haustuer_skript: script.haustuer_oeffnen
 *   haustuer_taste: button.vordereingang_tur_offnen   (nur für „zuletzt geöffnet“)
 *   haustuer_akku: sensor.vordereingang_batterie
 *   kamera: auto | none | camera.xyz     (auto = input_text.klingel_haustur_kamera, wie das Klingel-Popup)
 *   snapshot: /local/klingel/letzte.jpg  (Bild der letzten Klingel, z. B. von einer Automation geschrieben)
 *   bestaetigen: true                    (Haustür öffnen erst nach zweitem Tippen)
 *   teil: <Baustein>                     (nur dieser Baustein, randlos und füllend – setzt raum-panel bei layout: custom)
 *
 * Bausteine für raum-panel (Brücke rp-extcard, ab raum-panel 2.98): titel, wt_titel, schloss, kontakt, akku, aktion,
 *   ht_titel, klingel, live, oeffnen – frei anordnen mit ✥ Anordnen bzw. layout: custom + grid + elements unter - type: card.
 * ====================================================================== */
(() => {
const VERSION = '1.1.2';
const TAG = 'home-twin-tuerstatus-card';

const DEF = {
  titel: 'Türen', layout: 'auto', hintergrund: true, zeigen: ['wohnungstuer', 'haustuer'],
  schloss: 'lock.wohnungstur', schloss_akku: 'sensor.wohnungstur_battery',
  schloss_akku_kritisch: 'binary_sensor.wohnungstur_battery_critical', schloss_laden: 'binary_sensor.wohnungstur_battery_charging',
  kontakt: 'binary_sensor.fl_door', offen_warnung: 5,
  klingel: 'sensor.vordereingang_letztes_klingeln', klingel_aktiv: 'binary_sensor.vordereingang_klingeln',
  haustuer_skript: 'script.haustuer_oeffnen', haustuer_taste: 'button.vordereingang_tur_offnen',
  haustuer_akku: 'sensor.vordereingang_batterie', kamera: 'auto', snapshot: '', bestaetigen: true,
};
const KAM_HELFER = 'input_text.klingel_haustur_kamera';

// Logbuch-Abrufe teilen sich alle Instanzen (raum-panel legt je Baustein eine eigene an)
const LOG_C = new Map();   // Schlüssel (Entitäten + Zustände) → { at, p }

const C = { ok: '#3ddc84', warn: '#ff9f2e', bad: '#ff5a5a', info: '#4da3ff', bell: '#ff6b8b', off: '#5c6068' };
// Schloss-Zustände (MQTT-Lock von Nuki)
const LOCK = {
  locked: ['Verriegelt', C.ok, 'mdi:lock'],
  unlocked: ['Entriegelt', C.warn, 'mdi:lock-open-variant'],
  open: ['Offen', C.info, 'mdi:door-open'],
  opening: ['Öffnet …', C.info, 'mdi:door-open', 1],
  locking: ['Verriegelt …', C.warn, 'mdi:lock-clock', 1],
  unlocking: ['Entriegelt …', C.warn, 'mdi:lock-clock', 1],
  jammed: ['Blockiert', C.bad, 'mdi:lock-alert', 1],
  unavailable: ['Nicht erreichbar', C.off, 'mdi:lock-off'],
  unknown: ['Unbekannt', C.off, 'mdi:lock-question'],
};
const ACT = { locked: 'Verriegelt', unlocked: 'Entriegelt', open: 'Geöffnet', opening: 'Geöffnet', locking: 'Verriegelt', unlocking: 'Entriegelt', jammed: 'Blockiert' };

const escH = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const p2 = n => String(n).padStart(2, '0');
const WT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const hm = d => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const tDate = v => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d; };
// „heute 12:46“ / „gestern 12:46“ / „Di 27.10. 12:46“
const absT = d => {
  const n = new Date(), day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dd = Math.round((day(n) - day(d)) / 864e5);
  if (dd === 0) return `heute ${hm(d)}`;
  if (dd === 1) return `gestern ${hm(d)}`;
  return `${WT[d.getDay()]} ${p2(d.getDate())}.${p2(d.getMonth() + 1)}. ${hm(d)}`;
};
// Dauer seit d: „gerade“, „4 Min.“, „2 Std. 5 Min.“, „3 Tg.“
const durT = d => {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'gerade';
  const m = Math.floor(s / 60); if (m < 60) return `${m} Min.`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} Std.${m % 60 ? ` ${m % 60} Min.` : ''}`;
  return `${Math.floor(h / 24)} Tg.`;
};
const relT = d => { const t = durT(d); return t === 'gerade' ? 'gerade eben' : `vor ${t}`; };

const loadFonts = () => {
  if (document.getElementById('rtc-fonts')) return;
  const l = document.createElement('link');
  l.id = 'rtc-fonts'; l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Share+Tech+Mono&display=swap';
  document.head.appendChild(l);
};

const CSS = `
:host{display:block;height:100%;container-type:inline-size}
*{box-sizing:border-box;margin:0}
.root{height:100%;color:#c9ccd2;line-height:1.2;font-family:Rajdhani,'Segoe UI',sans-serif;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;
  display:flex;flex-direction:column;gap:12px;padding:16px 18px}
.root.plate{position:relative;border-radius:20px;overflow:hidden;background:linear-gradient(180deg,rgba(50,52,58,calc(.78 * var(--pt,1))),rgba(24,25,29,calc(.88 * var(--pt,1))));
  border:1px solid rgba(255,255,255,.07);box-shadow:0 0 0 1px #000,inset 0 1px 0 rgba(255,255,255,.14),inset 0 -1px 0 rgba(0,0,0,.6),0 20px 36px rgba(0,0,0,.55)}
.root.bare{padding:0}
.head{display:flex;align-items:center;gap:10px}
.head h2{flex:1;font-size:18px;letter-spacing:2.5px;text-transform:uppercase;color:#e2e4e8;line-height:1.1;font-weight:700}
.mono{font-family:'Share Tech Mono',monospace}
.cap{font-size:12px;letter-spacing:2.5px;color:#9a9fa8;font-weight:700;text-transform:uppercase;display:flex;align-items:center;gap:8px}
.cap .r{margin-left:auto;font-family:'Share Tech Mono',monospace;letter-spacing:0;font-weight:400;font-size:13px;display:flex;align-items:center;gap:4px}
.cap ha-icon{--mdc-icon-size:15px}
.secs{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
.sec{display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0;container-type:inline-size}
@container (min-width:640px){.secs.auto{grid-template-columns:repeat(var(--n,2),minmax(0,1fr))}}
.secs.breit{grid-template-columns:repeat(var(--n,2),minmax(0,1fr))}
.led{width:9px;height:9px;border-radius:50%;flex:none;background:var(--lc,#3a3c41);box-shadow:0 0 8px var(--lc,transparent)}

/* großer Status (Taste im .rk-Stil des raum-panels, gedrückt = Zustand aktiv) */
.rk{min-height:64px;border-radius:13px;position:relative;overflow:hidden;display:flex;align-items:center;gap:14px;padding:6px 18px 10px;color:#9a9ea6;
  background:linear-gradient(180deg,#36383d,#222327);box-shadow:0 2px 0 #0b0b0c,0 4px 8px rgba(0,0,0,.5),0 0 26px var(--g),inset 0 1px 0 rgba(255,255,255,.1);transform:translateY(3px)}
.rk::before{content:"";position:absolute;inset:0;background:linear-gradient(125deg,rgba(255,255,255,.08),rgba(255,255,255,0) 38%);pointer-events:none}
.rk::after{content:"";position:absolute;left:18px;right:18px;bottom:6px;height:3px;border-radius:2px;background:var(--c);box-shadow:0 0 10px var(--c)}
.rk ha-icon{--mdc-icon-size:34px;color:var(--c);filter:drop-shadow(0 0 5px var(--c));flex:none}
.rk .t{min-width:0}
.rk .nm{font-size:13px;letter-spacing:2.5px;font-weight:700;text-transform:uppercase;color:#9a9ea6;line-height:1}
.rk .st{font-size:24px;letter-spacing:3px;font-weight:700;text-transform:uppercase;line-height:1.1;color:var(--c);text-shadow:0 0 12px var(--g);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rk .since{margin-left:auto;text-align:right;font-family:'Share Tech Mono',monospace;font-size:13px;color:#8d929b;line-height:1.25;flex:none}
.rk .since b{display:block;font-weight:400;font-size:17px;color:#c9ccd2}
@container (max-width:300px){.rk{gap:10px;padding:6px 12px 10px}.rk ha-icon{--mdc-icon-size:28px}.rk .st{font-size:19px;letter-spacing:1.2px}
  .rk .nm{font-size:11px;letter-spacing:1.8px}.rk .since span{display:none}.rk .since b{font-size:15px}.rk::after{left:12px;right:12px}}
.blink{animation:tsblink 1.1s ease-in-out infinite}
@keyframes tsblink{50%{opacity:.35}}

/* Kacheln */
.tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.tile{position:relative;overflow:hidden;border-radius:12px;padding:9px 12px;background:rgba(0,0,0,.25);box-shadow:inset 0 2px 5px rgba(0,0,0,.5),0 1px 0 rgba(255,255,255,.05);min-width:0}
.tile.wide{grid-column:1/-1}
.tile .n{font-size:11.5px;letter-spacing:2px;font-weight:700;color:#8a8e96;text-transform:uppercase;display:flex;align-items:center;justify-content:space-between;gap:4px;white-space:nowrap}
.tile .val{font-family:'Share Tech Mono',monospace;font-size:22px;color:var(--vc,#e8e9ec);line-height:1.1;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile .val small{font-size:13px;color:#8a8e96}
.tile .sub{font-family:'Share Tech Mono',monospace;font-size:12.5px;color:#8d929b;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tile.hot{box-shadow:inset 0 2px 5px rgba(0,0,0,.5),inset 0 0 0 1px var(--vc),0 0 16px rgba(255,90,90,.25)}
.bar{height:6px;border-radius:3px;margin-top:6px;background:#15161a;box-shadow:inset 0 1px 2px #000;position:relative;overflow:hidden}
.bar i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:var(--vc);box-shadow:0 0 8px var(--vc);transition:width .6s}
@container (max-width:480px){.tiles{grid-template-columns:1fr 1fr}.tiles .tile.act{grid-column:1/-1}}

/* Klingelbild */
.shot{position:relative;flex:1 1 auto;min-height:110px;max-height:300px;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#0c0d0f;
  box-shadow:inset 0 2px 8px rgba(0,0,0,.8),0 1px 0 rgba(255,255,255,.05)}
.shot img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.shot .ph{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#8a8f98;
  background:repeating-linear-gradient(135deg,rgba(255,255,255,.015) 0 10px,transparent 10px 20px)}
.shot .ph ha-icon{--mdc-icon-size:46px}
.shot .ph span{font-size:12px;letter-spacing:2px;font-weight:700;text-transform:uppercase}
.shot .ov{position:absolute;left:0;right:0;bottom:0;padding:22px 12px 9px;background:linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.78));display:flex;align-items:flex-end;gap:10px}
.shot .ov .l{flex:1;min-width:0}
.shot .ov .k{font-size:11.5px;letter-spacing:2px;font-weight:700;text-transform:uppercase;color:#a6aab2}
.shot .ov .v{font-family:'Share Tech Mono',monospace;font-size:19px;color:#e8e9ec;white-space:nowrap}
.shot .ov .rel{font-family:'Share Tech Mono',monospace;font-size:14px;color:var(--bc,#8d929b)}
.shot.ring{box-shadow:inset 0 0 0 2px ${C.bell},0 0 22px rgba(255,107,139,.55);animation:tsring 1s ease-in-out infinite}
.shot .badge{position:absolute;top:10px;left:10px;padding:4px 10px;border-radius:8px;background:${C.bell};color:#fff;font-size:13px;letter-spacing:2px;font-weight:700;text-transform:uppercase;box-shadow:0 0 14px ${C.bell}}
@keyframes tsring{50%{box-shadow:inset 0 0 0 2px ${C.bell},0 0 6px rgba(255,107,139,.2)}}

/* Tasten (.hk des raum-panels) */
.keys{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.hk{height:48px;border-radius:9px;display:flex;align-items:center;justify-content:center;gap:9px;padding:0 10px;font-size:14px;letter-spacing:1.8px;font-weight:700;text-transform:uppercase;color:#b5b9c0;
  background:linear-gradient(180deg,#34363b,#222327);box-shadow:0 4px 0 #0b0b0c,0 6px 10px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.1);cursor:pointer;transition:transform .08s;white-space:nowrap;overflow:hidden}
.hk ha-icon{--mdc-icon-size:20px;color:var(--c,#9a9ea6);flex:none}
.hk i{width:14px;height:4px;border-radius:2px;background:#3a3c41;box-shadow:inset 0 1px 2px #000;flex:none}
.hk:active{transform:translateY(4px);box-shadow:0 0 0 #0b0b0c,0 2px 5px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.1)}
.hk.on{transform:translateY(3px);color:#f0f1f3;box-shadow:0 1px 0 #0b0b0c,0 3px 6px rgba(0,0,0,.5),0 0 18px var(--g,transparent),inset 0 1px 0 rgba(255,255,255,.1)}
.hk.on i{background:var(--c);box-shadow:0 0 10px var(--c)}
.hk.na{opacity:.5;filter:grayscale(.7)}
.hk.busy{pointer-events:none}
.note{font-family:'Share Tech Mono',monospace;font-size:12.5px;color:#9a9fa8;text-align:center;min-height:15px}
.err{padding:12px;border-radius:12px;background:rgba(255,90,90,.12);color:#ff8a8a;font-size:13px}
/* Baustein allein (teil:, raum-panel „frei anordnen“): randlos, füllt die Zelle */
.root.teil{padding:0;gap:6px;height:100%;min-height:0}
.teil>*{flex:1 1 auto;min-height:0}
.teil>.head,.teil>.cap{flex:none;margin:auto 0}
.teil>.rk{height:calc(100% - 4px);min-height:0}
.teil>.tile{height:100%;display:flex;flex-direction:column;justify-content:center}
.teil>.shot{max-height:none;aspect-ratio:auto;height:100%;min-height:0}
.teil>.hk{height:100%;min-height:36px;max-height:100%}
.teil>.note{flex:none}
.t-oeffnen>.hk{height:auto}
`;

// Overlay fürs Live-Bild (liegt im Dokument, damit es nicht vom Rahmen beschnitten wird)
const OV_CSS = `
.tsov{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(5,6,8,.72);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);font-family:Rajdhani,'Segoe UI',sans-serif}
.tsov .box{width:min(92vw,1100px);border-radius:20px;padding:16px 18px;color:#c9ccd2;background:linear-gradient(180deg,rgba(50,52,58,.95),rgba(24,25,29,.97));
  border:1px solid rgba(255,255,255,.07);box-shadow:0 0 0 1px #000,inset 0 1px 0 rgba(255,255,255,.14),0 30px 60px rgba(0,0,0,.7)}
.tsov .hd{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.tsov h2{flex:1;font-size:18px;letter-spacing:2.5px;text-transform:uppercase;color:#e2e4e8}
.tsov .x{height:44px;min-width:110px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:14px;letter-spacing:1.8px;font-weight:700;text-transform:uppercase;color:#b5b9c0;cursor:pointer;
  background:linear-gradient(180deg,#34363b,#222327);box-shadow:0 4px 0 #0b0b0c,0 6px 10px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.1)}
.tsov .x:active{transform:translateY(4px)}
.tsov .cam{position:relative;border-radius:12px;overflow:hidden;background:#0c0d0f;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center}
.tsov .cam>*{width:100%;height:100%}
.tsov .cam>.msg{height:auto}
.tsov .msg{padding:40px 20px;text-align:center;font-size:17px;letter-spacing:1px;color:#9a9ea6;line-height:1.5}
`;

class HomeTwinTuerstatusCard extends HTMLElement {
  static getStubConfig() { return {}; }
  // Bausteine für raum-panel („✥ Anordnen“, layout: custom unter type: card) – siehe RPExtCard in raum-panel.js
  static get rpTeile() {
    return {
      titel: { art: 'fill', h: 20 }, wt_titel: { art: 'fill', h: 20 }, schloss: { art: 'fill', h: 72 },
      kontakt: { art: 'fill', h: 72 }, akku: { art: 'fill', h: 72 }, aktion: { art: 'fill', h: 72 },
      ht_titel: { art: 'fill', h: 20 }, klingel: { art: 'fill', h: 176 }, live: { art: 'fill', h: 46 }, oeffnen: { art: 'fill', h: 72 },
    };
  }
  static get rpDesign() { return { breite: 480, hoehe: 390 }; }
  // Start für „✥ Anordnen“: zweispaltig (links Wohnungstür, rechts Haustür) – passt in den fast quadratischen Flur-Rahmen
  static get rpStart() {
    return { grid: { columns: 12, row_height: 20, gap: 6, width: 480 },
      elements: {
        wt_titel: { col: 1, row: 1, w: 6, h: 1 }, schloss: { col: 1, row: 2, w: 6, h: 4 },
        kontakt: { col: 1, row: 6, w: 3, h: 4 }, akku: { col: 4, row: 6, w: 3, h: 4 }, aktion: { col: 1, row: 10, w: 6, h: 4 },
        ht_titel: { col: 7, row: 1, w: 6, h: 1 }, klingel: { col: 7, row: 2, w: 6, h: 8 },
        live: { col: 7, row: 10, w: 6, h: 2 }, oeffnen: { col: 7, row: 12, w: 6, h: 3 },
      } };
  }
  setConfig(c) {
    this._c = Object.assign({}, DEF, c || {});
    // teil: nur ein Baustein (raum-panel ordnet die Bausteine frei an) – ohne Platte, füllend
    this._c.teil = this._c.teil ? String(this._c.teil) : null;
    if (this._c.teil) this._c.hintergrund = false;
    if (!Array.isArray(this._c.zeigen)) this._c.zeigen = String(this._c.zeigen).split(/[\s,]+/).filter(Boolean);
    this._sig = null; this._log = null; this._logFor = null;
    if (this._hass) this._render();
  }
  set hass(h) {
    this._hass = h;
    const c = this._c; if (!c) return;
    // Logbuch nur neu laden, wenn das Schloss den Zustand wechselt
    const ls = h.states[c.schloss];
    const ks = h.states[c.klingel], ts = h.states[c.kontakt];
    const lk = (ls ? `${ls.state}|${ls.last_changed}` : '') + (ks ? `|${ks.state}` : '') + (ts ? `|${ts.state}` : '');
    if (lk !== this._logFor) { this._logFor = lk; this._loadLog(); }
    this._render();
  }
  getCardSize() { return 7; }
  getGridOptions() { return { columns: 12, rows: 'auto', min_columns: 6 }; }

  connectedCallback() {
    loadFonts();
    // Relative Zeiten (offen seit …, vor … Min.) laufen weiter
    if (!this._tick) this._tick = setInterval(() => { this._sig = null; this._render(); }, 30000);
  }
  disconnectedCallback() { clearInterval(this._tick); this._tick = null; this._closeLive(); }

  _st(id) { return id && this._hass ? this._hass.states[id] : undefined; }
  _name(id) { const s = this._st(id); return s ? (s.attributes.friendly_name || id).trim() : id; }

  // Kamera der Haustür: Option > Klingel-Helfer (auto) > keine
  _cam() {
    let k = String(this._c.kamera || 'auto').trim();
    if (k === 'auto') { const hs = this._st(KAM_HELFER); k = hs ? String(hs.state).trim() : 'none'; }
    if (!k.startsWith('camera.')) return null;
    const s = this._st(k); return s && s.state !== 'unavailable' ? k : null;
  }

  // Letzte Schloss-Aktion mit Auslöser aus dem Logbuch (14 Tage).
  // Zustände innerhalb von 20 s bilden eine Aktion (Nuki-Öffnen = opening → open → unlocking → unlocked);
  // Zustände direkt nach unavailable/unknown (HA-/MQTT-Neustart) sind keine Aktion.
  async _loadLog() {
    const h = this._hass, c = this._c; if (!h || !h.callWS || !c.schloss) return;
    const seq = (this._logSeq = (this._logSeq || 0) + 1);
    const key = [c.schloss, c.kontakt, c.klingel, this._logFor].join('#');
    let E = LOG_C.get(key);
    if (!E || Date.now() - E.at > 60e3) {
      E = { at: Date.now(), p: this._fetchLog() };
      E.p.then(r => { E.r = r; }, () => {});
      LOG_C.set(key, E);
      if (LOG_C.size > 20) LOG_C.delete(LOG_C.keys().next().value);
    }
    let r = E.r;   // schon geladen (andere Instanz) → sofort zeigen, ohne „lädt …“
    if (!r) try { r = await E.p; } catch (e) { LOG_C.delete(key); r = { log: { err: true } }; }
    if (seq !== this._logSeq) return;
    this._log = r.log; this._doorT = r.doorT || null; this._ring = r.ring || null;
    this._sig = null; this._render();
  }
  async _fetchLog() {
    const h = this._hass, c = this._c, id = c.schloss, R = { log: null, doorT: null, ring: null };
    const end = new Date(), start = new Date(end.getTime() - 14 * 864e5);
    const get = eid => h.callWS({ type: 'logbook/get_events', start_time: start.toISOString(), end_time: end.toISOString(), entity_ids: [eid] });
    try {
      const ev = (await get(id) || []).filter(e => e.state != null);
      const groups = [];
      let g = null, prevSt = null;
      for (const e of ev) {
        const restore = ['unavailable', 'unknown'].includes(prevSt);
        prevSt = e.state;
        if (!ACT[e.state]) { g = null; continue; }
        if (restore) { g = null; continue; }
        if (g && e.when - g.last <= 20) { g.ev.push(e); g.last = e.when; }
        else { g = { ev: [e], first: e.when, last: e.when }; groups.push(g); }
      }
      const lg = groups[groups.length - 1];
      if (!lg) R.log = { none: true };
      else {
        const st = lg.ev.some(e => e.state === 'open' || e.state === 'opening') ? 'open' : lg.ev[lg.ev.length - 1].state;
        const src = lg.ev.find(e => this._who(e).known) || lg.ev[0];
        R.log = { state: st, end: lg.ev[lg.ev.length - 1].state, when: lg.first, who: this._who(src) };
      }
    } catch (e) {
      R.log = { err: true };
    }
    // Türkontakt: letzter echter Wechsel in den aktuellen Zustand (nicht die Wiederherstellung nach einem Neustart)
    try {
      const ts = this._st(c.kontakt);
      if (ts && ['on', 'off'].includes(ts.state)) {
        const ev = await get(c.kontakt) || [];
        let prev = null;
        for (const e of ev) {
          if (e.state === ts.state && prev && prev !== e.state && !['unavailable', 'unknown'].includes(prev)) R.doorT = e.when;
          if (e.state != null) prev = e.state;
        }
      }
    } catch (e) { R.doorT = null; }
    // Letzte Klingel: Ring-Sensor ist nach einem Neustart oft „unknown“ → letzten gültigen Wert aus dem Logbuch
    try {
      const ks = this._st(c.klingel);
      if (ks && !tDate(ks.state)) {
        const ev = await get(c.klingel) || [];
        const v = ev.map(e => tDate(e.state)).filter(Boolean).pop();
        R.ring = v ? v.toISOString() : null;
      }
    } catch (e) { R.ring = null; }
    return R;
  }
  _who(e) {
    const h = this._hass;
    if (e.context_user_id) {
      const p = Object.values(h.states).find(s => s.entity_id.startsWith('person.') && s.attributes.user_id === e.context_user_id);
      if (p) return { txt: (p.attributes.friendly_name || '').split(' ')[0] || p.entity_id, known: 1 };
      if (h.user && h.user.id === e.context_user_id) return { txt: h.user.name, known: 1 };
      return { txt: 'HA-Benutzer', known: 1 };
    }
    if (e.context_entity_id) return { txt: e.context_entity_id_name || this._name(e.context_entity_id), known: 1 };
    if (e.context_event_type === 'automation_triggered' || e.context_domain === 'automation') return { txt: e.context_name || 'Automation', known: 1 };
    return { txt: 'am Schloss / Nuki-App', known: 0 };
  }

  _render() {
    const h = this._hass, c = this._c; if (!h || !c) return;
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    const ids = [c.schloss, c.schloss_akku, c.schloss_akku_kritisch, c.schloss_laden, c.kontakt, c.klingel, c.klingel_aktiv,
      c.haustuer_skript, c.haustuer_taste, c.haustuer_akku, KAM_HELFER];
    const sig = ids.map(i => { const s = this._st(i); return s ? s.state + s.last_changed : '-'; }).join('|')
      + JSON.stringify(this._log) + (this._ring || '') + (this._doorT || '') + (this._btn || '') + (this._note || '');
    if (sig === this._sig) return;
    this._sig = sig;
    const P = Object.assign({}, this._partsW(), this._partsH());
    let body;
    if (c.teil) {
      // nur ein Baustein (raum-panel): randlos, füllt den Host
      const n = c.teil;
      body = `<div class="root bare teil t-${escH(n)}">${n === 'titel' ? (c.titel ? `<div class="head"><h2>${escH(c.titel)}</h2></div>` : '')
        : n === 'oeffnen' ? P.oeffnen + P.note
        : P[n] != null ? P[n] : `<div class="err">Baustein „${escH(n)}“ unbekannt</div>`}</div>`;
    } else {
      const secs = c.zeigen.map(z => z === 'wohnungstuer' ? this._wohnung(P) : z === 'haustuer' ? this._haus(P) : '').filter(Boolean);
      const lay = ['hoch', 'breit'].includes(c.layout) ? c.layout : 'auto';
      body = `<div class="root ${c.hintergrund === false ? 'bare' : 'plate'}">
  ${c.titel ? `<div class="head"><h2>${escH(c.titel)}</h2></div>` : ''}
  <div class="secs ${lay}" style="--n:${secs.length}">${secs.join('')}</div>
</div>`;
    }
    this.shadowRoot.innerHTML = `<style>${CSS}</style>${body}`;
    this.shadowRoot.querySelectorAll('[data-act]').forEach(e => e.addEventListener('click', ev => this._act(e.dataset.act, ev)));
  }

  _wohnung(P) {
    if (P._wErr) return `<div class="sec">${P._wErr}</div>`;
    return `<div class="sec">
  ${P.wt_titel}
  ${P.schloss}
  <div class="tiles">${P.kontakt}${P.akku}${P.aktion}</div>
</div>`;
  }
  _haus(P) {
    return `<div class="sec">
  ${P.ht_titel}
  ${P.klingel}
  <div class="keys">${P.live}${P.oeffnen}</div>
  ${P.note}
</div>`;
  }

  // Bausteine der Wohnungstür (je ein HTML-Stück; ganze Karte = alle zusammen, teil: = eins allein)
  _partsW() {
    const c = this._c, ls = this._st(c.schloss);
    const P = { wt_titel: '<div class="cap"><span>Wohnungstür</span></div>', schloss: '', kontakt: '', akku: '', aktion: '' };
    if (!ls) { P._wErr = P.schloss = `<div class="err">Schloss ${escH(c.schloss)} nicht gefunden</div>`; return P; }
    const [txt, col, ico, bl] = LOCK[ls.state] || [ls.state, C.off, 'mdi:lock-question'];
    // „seit“: Zeit der letzten echten Aktion, wenn sie zum aktuellen Zustand passt (last_changed springt bei Neustarts)
    const lg = this._log && this._log.end === ls.state ? tDate(this._log.when * 1000) : null;
    const lc = lg || tDate(ls.last_changed);
    P.schloss = `<div class="rk" style="--c:${col};--g:${col}55">
    <ha-icon icon="${ico}"${bl ? ' class="blink"' : ''}></ha-icon>
    <div class="t"><div class="nm">Schloss</div><div class="st${bl ? ' blink' : ''}">${escH(txt)}</div></div>
    <div class="since"><span>seit</span><b>${lc ? (Date.now() - lc < 864e5 ? hm(lc) : durT(lc)) : '–'}</b></div>
  </div>`;
    // Türkontakt
    const ks = this._st(c.kontakt);
    if (ks) {
      const open = ks.state === 'on', kd = (this._doorT && tDate(this._doorT * 1000)) || tDate(ks.last_changed), na = ['unavailable', 'unknown'].includes(ks.state);
      const lang = open && kd && (Date.now() - kd.getTime()) / 6e4 >= (+c.offen_warnung || 5);
      const vc = na ? C.off : open ? (lang ? C.bad : C.warn) : C.ok;
      P.kontakt = `<div class="tile${lang ? ' hot' : ''}" style="--vc:${vc}"><div class="n">Tür <span class="led" style="--lc:${vc}"></span></div>
        <div class="val">${na ? 'n. v.' : open ? 'OFFEN' : 'ZU'}</div>
        <div class="sub">${kd && !na ? (open ? `seit ${durT(kd)}` : `seit ${Date.now() - kd < 864e5 ? hm(kd) : durT(kd)}`) : '&nbsp;'}</div></div>`;
    }
    // Akku
    const as = this._st(c.schloss_akku);
    if (as) {
      const v = parseFloat(as.state), krit = (this._st(c.schloss_akku_kritisch) || {}).state === 'on', laden = (this._st(c.schloss_laden) || {}).state === 'on';
      const vc = isNaN(v) ? C.off : krit || v < 20 ? C.bad : v < 40 ? C.warn : C.ok;
      P.akku = `<div class="tile" style="--vc:${vc}"><div class="n">Akku ${laden ? '<ha-icon icon="mdi:lightning-bolt" style="--mdc-icon-size:14px;color:#ffd84a"></ha-icon>' : ''}</div>
        <div class="val">${isNaN(v) ? 'n. v.' : Math.round(v)}<small>${isNaN(v) ? '' : ' %'}</small></div>
        <div class="bar"><i style="width:${isNaN(v) ? 0 : Math.max(0, Math.min(100, v))}%"></i></div></div>`;
    }
    // Letzte Aktion
    const L = this._log;
    let lHtml;
    if (!L) lHtml = `<div class="val"><small>lädt …</small></div><div class="sub">&nbsp;</div>`;
    else if (L.err || L.none) lHtml = `<div class="val"><small>${L.err ? 'Logbuch n. v.' : 'keine (14 Tg.)'}</small></div><div class="sub">&nbsp;</div>`;
    else {
      const d = tDate(L.when * 1000);
      lHtml = `<div class="val">${escH(ACT[L.state])} <small>${d ? hm(d) : ''}</small></div><div class="sub">${escH(L.who.txt)}${d ? ` · ${escH(absT(d).replace(/ \d\d:\d\d$/, ''))}` : ''}</div>`;
    }
    P.aktion = `<div class="tile act"><div class="n">Letzte Aktion</div>${lHtml}</div>`;
    return P;
  }

  // Bausteine der Haustür
  _partsH() {
    const c = this._c, ks = this._st(c.klingel), ring = (this._st(c.klingel_aktiv) || {}).state === 'on';
    const kd = ks ? tDate(ks.state) || tDate(this._ring) : null, cam = this._cam();
    const akku = this._st(c.haustuer_akku), av = akku ? parseFloat(akku.state) : NaN;
    const avc = isNaN(av) ? C.off : av < 20 ? C.bad : av < 40 ? C.warn : C.ok;
    // Bild: Snapshot-URL (mit Klingelzeit gegen Cache) > Kamera-Standbild > Platzhalter
    let img = '';
    if (c.snapshot) img = `<img src="${escH(c.snapshot)}${c.snapshot.includes('?') ? '&' : '?'}t=${kd ? kd.getTime() : 0}" onerror="this.remove()">`;
    else if (cam) { const s = this._st(cam); if (s.attributes.entity_picture) img = `<img src="${escH(s.attributes.entity_picture)}" onerror="this.remove()">`; }
    const fresh = kd && Date.now() - kd.getTime() < 3600e3;
    const lastOpen = tDate((this._st(c.haustuer_taste) || {}).state);
    const sk = this._st(c.haustuer_skript);
    const b = this._btn;   // undefined | 'confirm' | 'busy' | 'done' | 'fail'
    const bTxt = { confirm: 'Nochmal tippen', busy: 'Öffnet …', done: 'Geöffnet', fail: 'Fehler' }[b] || 'Haustür öffnen';
    const bCol = { confirm: C.warn, busy: C.info, done: C.ok, fail: C.bad }[b] || C.ok;
    const note = this._note || (lastOpen ? `zuletzt geöffnet ${absT(lastOpen)}` : '');
    return {
      ht_titel: `<div class="cap"><span>Haustür</span>${akku ? `<span class="r" title="Akku Intercom"><ha-icon icon="mdi:battery" style="color:${avc}"></ha-icon>${isNaN(av) ? 'n. v.' : Math.round(av) + ' %'}</span>` : ''}</div>`,
      klingel: `<div class="shot${ring ? ' ring' : ''}" data-act="live">
    <div class="ph"><ha-icon icon="mdi:doorbell"></ha-icon><span>${cam || c.snapshot ? 'Kein Bild' : 'Keine Kamera'}</span></div>
    ${img}
    ${ring ? '<div class="badge">Es klingelt</div>' : ''}
    <div class="ov"><div class="l"><div class="k">Letzte Klingel</div><div class="v">${kd ? escH(absT(kd)) : (ks ? 'noch nie' : 'n. v.')}</div></div>
      ${kd ? `<div class="rel" style="--bc:${fresh ? C.bell : '#8d929b'}">${escH(relT(kd))}</div>` : ''}</div>
  </div>`,
      live: `<div class="hk${cam ? '' : ' na'}" data-act="live" style="--c:${C.info}"><ha-icon icon="mdi:cctv"></ha-icon>Live-Bild</div>`,
      oeffnen: `<div class="hk${b ? ' on' : ''}${b === 'busy' ? ' busy' : ''}${sk ? '' : ' na'}" data-act="open" style="--c:${bCol};--g:${bCol}55"><i></i><ha-icon icon="mdi:door-open"></ha-icon><span${b === 'confirm' || b === 'busy' ? ' class="blink"' : ''}>${bTxt}</span></div>`,
      note: `<div class="note">${escH(note)}</div>`,
    };
  }

  _set(btn, note, ms) {
    clearTimeout(this._bt);
    this._btn = btn; this._note = note; this._sig = null; this._render();
    if (ms) this._bt = setTimeout(() => { this._btn = undefined; this._note = ''; this._sig = null; this._render(); }, ms);
  }

  async _act(a) {
    const c = this._c, h = this._hass;
    if (a === 'live') return this._openLive();
    if (a === 'open') {
      if (!this._st(c.haustuer_skript)) return this._set('fail', `${c.haustuer_skript} fehlt`, 4000);
      if (c.bestaetigen !== false && this._btn !== 'confirm') return this._set('confirm', 'Zum Öffnen erneut tippen', 4000);
      this._set('busy', '');
      try {
        const [dom, svc] = c.haustuer_skript.startsWith('script.') ? ['script', 'turn_on'] : ['homeassistant', 'turn_on'];
        await h.callService(dom, svc, { entity_id: c.haustuer_skript });
        this._set('done', 'Haustür wurde geöffnet', 5000);
      } catch (e) {
        this._set('fail', (e && e.message) || 'Fehler beim Öffnen', 5000);
      }
    }
  }

  _openLive() {
    this._closeLive();
    if (!document.getElementById('ts-ov-css')) { const s = document.createElement('style'); s.id = 'ts-ov-css'; s.textContent = OV_CSS; document.head.appendChild(s); }
    const cam = this._cam(), ov = document.createElement('div');
    ov.className = 'tsov';
    ov.innerHTML = `<div class="box"><div class="hd"><h2>Haustür · Live</h2><div class="x">Schließen</div></div><div class="cam"></div></div>`;
    const box = ov.querySelector('.cam');
    if (cam) {
      const st = document.createElement('ha-camera-stream');
      st.hass = this._hass; st.stateObj = this._hass.states[cam]; st.muted = true; st.controls = false; st.allowExoPlayer = true;
      box.appendChild(st); this._liveEl = st;
    } else {
      box.innerHTML = `<div class="msg">Für die Haustür ist keine Kamera eingerichtet –<br>die Ring Intercom hat selbst keine.<br>Kamera wählen: Einstellungen → Türklingel → Haustür (oder Option <b>kamera:</b>).</div>`;
    }
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('.x')) this._closeLive(); });
    document.body.appendChild(ov); this._ov = ov;
    // Live-Bild schließt sich nach 2 Minuten von selbst (Tablet an der Wand)
    this._ovT = setTimeout(() => this._closeLive(), 120000);
  }
  _closeLive() { clearTimeout(this._ovT); if (this._ov) { this._ov.remove(); this._ov = null; this._liveEl = null; } }
}

if (!customElements.get(TAG)) customElements.define(TAG, HomeTwinTuerstatusCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(c => c.type === TAG))
  window.customCards.push({ type: TAG, name: 'Home Twin Türstatus', description: 'Wohnungstür (Nuki) + Haustür (Ring Intercom) fürs Flur-Tablet' });
console.info(`%c HOME-TWIN-TUERSTATUS %c ${VERSION} `, 'background:#3ddc84;color:#000;font-weight:700', 'background:#222;color:#fff');
})();
