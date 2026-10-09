# Logi Web Hub · Web Console for Logitech Gaming Mice

[中文](README.md) · [Live demo](https://logi-hub.famlife.top)

> Click the live demo link above to use it directly (Chrome / Edge, mouse on wired or 2.4G receiver).

A driver-free, install-free web console for Logitech gaming mice: the browser talks
to the mouse directly (WebHID + HID++), reading and writing DPI, battery, report
rate and lighting on the real device. First batch targets 14 gaming mice including
**G304 / G305 Lightspeed, G Pro series, G502 / G703 / G903 series**
(see `src/core/hid/devices.ts`).

## Features

| Feature | Writes to device | Notes |
|---|---|---|
| DPI presets | ✅ `0x2201` (active slot only) | Extra slots are local software presets; click a card to switch. Slot colors can mirror the physical DPI LED (local only) |
| Report rate | ✅ `0x8060` / `0x8061` | Auto-switches to host mode before writing when onboard mode is active (Solaar #1040 approach); failures report the exact device error |
| Lighting | ✅ `0x8070` (mice with LEDs) | Auto-hidden on LED-less models (e.g. G304) |
| Battery | read-only | `0x1004` → `0x1000` → `0x1001` → 1.0 registers, with fallbacks |
| Button remap | ✅ `0x1B04` when present | G304/G305 have no such feature in hardware (per Solaar #850); host macros (local) instead |
| Lift-off distance | ✅ `0x2202` when present | Stays local on G304 (no such feature) |
| Sleep timer / angle snap | local only | No public HID++ feature; stored in the browser |
| Profile manager | JSON import/export | Onboard-slot snapshots + local macro backup |
| Languages | 中 / EN | One-click switch in the top bar, preference saved locally |

## Requirements

- **Chrome / Edge 89+** (WebHID) served over `https` or `localhost` (`file://` won't work).
- Mouse on **wired or 2.4 GHz receiver** mode; Bluetooth exposes no HID++ channel.
- Quit **G HUB / Solaar** before connecting (they compete for the receiver); nudge the mouse if it is asleep, then re-run self-test.

## Quick start

```bash
pnpm install
pnpm dev      # dev server at http://localhost:5173
pnpm build    # build (tsc + vite)
pnpm preview  # preview the production bundle
```

No hardware at hand? In dev mode open `http://localhost:5173/?mockhid=1` to replay a
captured G304 session end to end (see `src/core/hid/devMock.ts`).

## Connect & troubleshoot

1. Click connect on the home page and pick the Logitech device in the browser picker (a receiver shows a single HID++ entry).
2. The HID++ self-test runs automatically: environment → channel probing → feature presence → DPI / battery / report-rate / key-table reads → summary.
3. If something can't be read, open “Details (developers)” on the self-test page and paste the step's raw packets into an issue — different firmware revisions answer with different layouts.

## Self-hosting with Docker

```bash
docker compose up -d --build   # http://server-ip:8080
```

`docker-compose.yaml` builds in stages (Node build → static hosting on `nginx:alpine` with SPA fallback + gzip).
**WebHID requires a secure context**, so for a public domain terminate TLS in front
(e.g. Nginx Proxy Manager / Caddy / Traefik reverse-proxying to 8080 with a cert for
`logi-hub.famlife.top`) — otherwise the browser refuses authorization.

## Tech & credits

- Protocol semantics follow [Solaar](https://github.com/pwr-Solaar/Solaar) (GPLv2, semantics only — all code rewritten) and the [OpenLogi docs](https://openlogi.org/hidpp/features); device PID/DPI data comes from [libratbag](https://github.com/libratbag/libratbag) (MIT, sources annotated).

## License

MIT (see `LICENSE`).
