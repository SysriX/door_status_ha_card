# Door Status Card

Lovelace card (`custom:home-twin-tuerstatus-card`) for a hallway tablet showing two doors:

- **Apartment door** (smart lock, e.g. Nuki): locked / unlocked / open, battery (level, critical, charging), last action with the person who did it (from the logbook: HA user → person, script/automation → its name, otherwise "at the lock / app"), door contact open/closed + "open since" (turns red after a configurable time).
- **Front door** (e.g. Ring Intercom): last ring (+ picture if a camera or snapshot is available), live view button (camera overlay), "open front door" button that runs a script (with confirmation).

UI language: German.

## Requirements

- A `lock.*` entity (the author uses Nuki via MQTT) and optionally a door contact `binary_sensor`
- Doorbell entities, e.g. from the [Ring](https://www.home-assistant.io/integrations/ring/) integration (Ring Intercom): last-ding sensor, ding binary sensor, open-door button, battery sensor
- A script that opens the front door (default `script.haustuer_oeffnen`, e.g. pressing the Ring Intercom "open door" button)
- Optional: `input_text.klingel_haustur_kamera` (value `none` or `camera.xyz`) – used by `kamera: auto`, shared with a doorbell popup
- Styled to match the **Room Tablet** theme (`room_tablet_ha_theme`)

**All entity defaults are the author's entity ids – set the options below to your own entities.**

## Installation

### HACS (custom repository)

1. HACS → ⋮ → **Custom repositories** → add `https://github.com/SysriX/door_status_ha_card`, category **Dashboard**.
2. Install the card from HACS and reload the browser.
3. HACS registers the resource automatically: `/hacsfiles/door_status_ha_card/door_status_ha_card.js` (JavaScript module).

### Manual

1. Copy `dist/door_status_ha_card.js` to `/config/www/door_status_ha_card.js`.
2. Settings → Dashboards → ⋮ → **Resources** → add `/local/door_status_ha_card.js` as **JavaScript module**.
3. Reload the browser.

## Configuration

All options are optional; the values shown are the defaults.

```yaml
type: custom:home-twin-tuerstatus-card
titel: Türen
layout: auto                          # auto | hoch | breit (auto: side by side from 640 px width)
hintergrund: true                     # false = no glass plate (e.g. inside a room-panel frame)
zeigen: [wohnungstuer, haustuer]      # order/selection: apartment door, front door
schloss: lock.wohnungstur
schloss_akku: sensor.wohnungstur_battery
schloss_akku_kritisch: binary_sensor.wohnungstur_battery_critical
schloss_laden: binary_sensor.wohnungstur_battery_charging
kontakt: binary_sensor.fl_door
offen_warnung: 5                      # minutes until "door open" turns red
klingel: sensor.vordereingang_letztes_klingeln
klingel_aktiv: binary_sensor.vordereingang_klingeln
haustuer_skript: script.haustuer_oeffnen
haustuer_taste: button.vordereingang_tur_offnen   # only used for "last opened"
haustuer_akku: sensor.vordereingang_batterie
kamera: auto                          # auto (= input_text.klingel_haustur_kamera) | none | camera.xyz
snapshot: ''                          # optional image URL of the last ring, e.g. /local/doorbell/last.jpg
bestaetigen: true                     # open front door only after a second tap
```

`snapshot` is a path to **your own** image file (e.g. written to `/config/www/doorbell/last.jpg` by an automation with `camera.snapshot`); it is empty by default. A cache-busting `?t=<ring time>` is appended automatically.

### Building blocks for Room Panel

Building blocks for [room_panel_ha_card](https://github.com/SysriX/room_panel_ha_card) (`custom:raum-panel` ≥ 2.98, rp-extcard bridge): `titel`, `wt_titel`, `schloss`, `kontakt`, `akku`, `aktion`, `ht_titel`, `klingel`, `live`, `oeffnen` – arrange freely with layout: custom + grid + elements under `- type: card`; `teil: <block>` renders a single block.

The card loads the fonts Rajdhani and Share Tech Mono from Google Fonts.

## Notes

This card was built for the author's own home and tablets. Some defaults (entity ids, dashboard paths) reflect that setup and may need to be set explicitly in your configuration.

## Version

1.1.2

## License

MIT – see [LICENSE](LICENSE).
