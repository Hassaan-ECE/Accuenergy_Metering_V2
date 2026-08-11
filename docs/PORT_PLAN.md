# Port plan — Accuenergy Metering → Tauri / Rust / Bun / React

**Status:** scaffold complete (Phase 0)  
**Date:** 2026-08-11  
**Legacy reference:** `C:\Projects\Active\Accuenergy_Metering_Legacy` (clone of GitHub repo)  
**UI reference:** `C:\Projects\Active\Inventory_Management` (shell, theme tokens, Button/Card patterns, release discipline)  
**New app:** `C:\Projects\Active\Accuenergy_Metering`

---

## Goal

Replace the Python/PySide6 app with a **desktop product** that:

- Keeps **proven Modbus + session logging + HTML report** behavior.
- Feels as polished as Inventory Management (snappy UI, DM Sans, light/dark).
- Uses **Rust** for I/O, storage, and background monitor work.
- Uses **React + Vite + Tailwind v4 + Bun** for the shell and live visualization.
- Does **not** pretend RS485 is faster than physics — optimizes everything *around* the bus.

---

## Verified vs assumed

| Item | Status |
|------|--------|
| Legacy repo cloned and source read | **Verified** |
| Register map + float decode extracted into Rust | **Verified** (unit test for 60.0f) |
| Inventory UI patterns reused (theme CSS, shell) | **Verified** (scaffold) |
| Frontend builds with Bun | Check after `bun install` this session |
| Real COM/Modbus round-trip from Rust | **Not verified** — needs lab meter + Phase 2 |
| Block multi-register reads | **Assumed unsafe until datasheet pass** |

---

## Target architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (React / Vite / Tailwind / uPlot)                 │
│  shell/  features/live  features/settings  integrations/    │
└──────────────────────────▲──────────────────────────────────┘
                           │ invoke + events (LiveUpdate, log)
┌──────────────────────────┴──────────────────────────────────┐
│  Tauri 2 commands / AppHandle emit                          │
├─────────────────────────────────────────────────────────────┤
│  Rust backend                                               │
│  domain/     config, meter map, decode                      │
│  monitor/    session loop, stop token, batching             │
│  storage/    SQLite sessions + readings                     │
│  report/     HTML (and later CSV)                           │
│  api/        list_ports, test_rs485, start/stop, config     │
└─────────────────────────────────────────────────────────────┘
                           │
                    USB-RS485 / COM
                           │
                    Acuvim IIW Modbus RTU
```

**Why not FeOx:** time-series append + SQL stats fits SQLite (legacy already correct). Keep FeOx for inventory-style key/value products.

**Why uPlot:** canvas-based, excellent for streaming ~1–10 Hz multi-series with low React re-render cost (mutate ring buffer → `setData`).

---

## Phased delivery

### Phase 0 — Scaffold (done this session)

- [x] Clone legacy → `Accuenergy_Metering_Legacy`
- [x] New app folder `Accuenergy_Metering`
- [x] Tauri 2 + Bun + React 19 + Tailwind v4 layout (Inventory-like)
- [x] UI shell: header, metrics grid, live graph (demo stream), activity log, status strip
- [x] Rust stubs: config types, meter map, decode test, Tauri commands (ping/config/ports placeholders)
- [x] Docs: `LEGACY_ANALYSIS.md`, this plan, `AGENTS.md`, `README.md`

**Success:** `bun run build:frontend` succeeds; desktop opens with demo stream (no meter required).

### Phase 1 — Frontend product shell (no hardware)

Focus: UX parity with better layout than Qt.

- [ ] Settings dialog (all `AppConfig` fields; theme separate in header)
- [ ] COM port dropdown wired when `list_serial_ports` is real; free-text fallback
- [ ] Multi-series graph tabs or metric picker (Frequency / Voltage / Current / Power)
- [ ] Session info panel (last session id, DB path, report path)
- [ ] Replace demo stream with bridge that prefers Tauri when `ping` works
- [ ] Vitest smoke for metric formatting + config summary

**Success:** full UI clickable offline; demo mode still available for UI work without COM.

### Phase 2 — Rust Modbus + monitor loop

Focus: behavioral parity with `Code/core/meter.py` + `monitor.py`.

- [ ] Dependencies: `serialport`, `tokio-modbus` (or sync RTU client), `rusqlite` bundled
- [ ] `list_serial_ports` from OS
- [ ] `test_rs485` → read basic targets once; return structured snapshot
- [ ] Monitor task:
  - long-lived client
  - sample interval / max speed
  - run_hours / until stop
  - batch insert every `commit_every`
  - emit `live-update` and `monitor-log` events
  - finalize session on stop/error/timeout
- [ ] Config load/save under `%LOCALAPPDATA%\com.accuenergy.metering\settings.json`
- [ ] DB path under app data (or configurable project Data folder for lab familiarity)

**Success:** with lab meter on COM5 defaults — Test RS485 green; Start logs samples; Stop finalizes session.  
**Hard gate:** no “works” claim without live hardware smoke in that session.

### Phase 3 — Reports + export

Focus: parity with `report.py`, better ergonomics.

- [ ] HTML report generation in Rust (stats + SVG or embedded chart images)
- [ ] Open report / open folders via `tauri-plugin-opener`
- [ ] Optional CSV export of session readings
- [ ] Session list UI (completed runs)

**Success:** report opens in browser; stats match a known Python-generated session within float noise (or re-import same DB for comparison).

### Phase 4 — Hardening + release

- [ ] Product icon rebrand (stop borrowing Inventory icon)
- [ ] Crash-safe stop on window close
- [ ] Logging to file under app data
- [ ] Version triple: `package.json` / `Cargo.toml` / `tauri.conf.json`
- [ ] Signed NSIS when ready for team (product-specific updater key under `%USERPROFILE%\.tauri\`)
- [ ] S-drive staging: `S:\Engineering\Public\Syed_Hassaan_Shah\Accuenergy_Metering\` (or agreed name)

**Success:** installer runs on a second machine; cold start + RS485 test documented.

---

## IPC contract (planned)

### Commands

| Command | Direction | Notes |
|---------|-----------|--------|
| `ping` | FE → BE | Runtime detection |
| `get_config` / `save_config` | FE ↔ BE | camelCase JSON |
| `list_serial_ports` | FE → BE | `{ name, description? }[]` |
| `test_rs485` | FE → BE | snapshot string or structured JSON |
| `start_monitor` / `stop_monitor` | FE → BE | single active session |
| `generate_report` | FE → BE | session id → path |
| `list_sessions` | FE → BE | Phase 3 |

### Events

| Event | Payload |
|-------|---------|
| `live-update` | `LiveUpdate` (camelCase) |
| `monitor-log` | `{ ts, message }` |
| `monitor-finished` | `SessionSummary` |
| `monitor-failed` | `{ kind, message }` |

### LiveUpdate (frontend `types.ts`)

Matches legacy fields: sessionId, timestampMs, values map, sampleCount, errorCount, liveHz, message.

---

## Module map (code)

| Area | Path |
|------|------|
| Shell UI | `frontend/src/shell/` |
| Live metrics / graph | `frontend/src/features/live/` |
| Settings UI | `frontend/src/features/settings/` (Phase 1) |
| Tauri bridge | `frontend/src/integrations/tauri/meterBridge.ts` |
| Theme | `frontend/src/platform/ui/theme.ts` + `app/index.css` |
| Commands | `backend/src/api/` |
| Domain | `backend/src/domain/` |
| Monitor | `backend/src/monitor/` (Phase 2) |
| Storage | `backend/src/storage/` (Phase 2) |
| Report | `backend/src/report/` (Phase 3) |

---

## What we copy from Inventory (and what we do not)

**Copy**

- Folder layout: `frontend/` + `backend/` + Bun scripts
- Tailwind token system (`:root` / `.dark`)
- Button/Card component style, DM Sans, status strip idea
- AGENTS.md / handoff docs habit
- Release discipline (version triple, NSIS, S-drive, unique signing key)

**Do not copy**

- Multi-module switcher / FeOx / shared sync
- Inventory-specific domain models
- Updater pubkey until a real product key is generated

---

## Testing strategy

| Layer | Approach |
|-------|----------|
| Decode | Rust unit tests (known float bit patterns) |
| Config validation | Rust unit tests |
| UI pure logic | Vitest (formatMetric, configSummary) |
| Monitor | Integration test with mock serial or recorded frames if available |
| E2E | Manual lab checklist: ports → test → start 30s → stop → report |

---

## Suggested next session

1. Confirm frontend build + open desktop (`bun install`, `bun run desktop`).
2. Phase 1 settings dialog + wire demo vs Tauri switch.
3. Phase 2 with meter on the bench: implement `test_rs485` first (smallest vertical slice), then the monitor loop.

---

## Out of scope (for now)

- Multi-meter simultaneous sessions  
- Cloud sync  
- Web-only deployment  
- Changing meter firmware / AXM-WEB2 Ethernet path (RS485 only unless requested)
