# Port plan — Accuenergy Metering → Tauri / Rust / Bun / React

**Status:** software implementation complete; live meter validation pending
**Date:** 2026-08-12
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
| Register map + float decode extracted into Rust | **Verified** (known 60.0f decode test) |
| Inventory UI patterns reused (theme CSS, cards, shell) | **Verified** |
| Frontend lint/tests/production build | **Verified** on August 12, 2026 |
| Rust formatting/tests | **Verified** (35 tests) on August 12, 2026 |
| Full Tauri dev launch | **Verified**; responsive `Accuenergy Metering v0.1.0` window |
| Real COM/Modbus round-trip from Rust | **Not verified** — no serial ports were attached |
| Register access strategy | **Implemented as sequential two-register reads**, matching Python |

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
│  report/     self-contained HTML + CSV                      │
│  api/        ports, probe, monitor, sessions, reports       │
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

### Phase 1 — Frontend product shell (complete)

Focus: UX parity with better layout than Qt.

- [x] Settings dialog (all `AppConfig` fields; theme separate in header)
- [x] COM port dropdown wired to `list_serial_ports`; free-text fallback
- [x] Multi-series graph tabs (Frequency / Voltage / Current / Power / PF)
- [x] Session info panel (session id, DB path, report path)
- [x] Bridge prefers Tauri when `ping` works; demo remains browser-only
- [x] Vitest coverage for config and the 1,800-point graph buffer

**Success:** full UI clickable offline; demo mode still available for UI work without COM.

### Phase 2 — Rust Modbus + monitor loop (software complete)

Focus: behavioral parity with `Code/core/meter.py` + `monitor.py`.

- [x] Dependencies: `serialport`, `tokio-modbus` sync RTU, `rusqlite` bundled
- [x] `list_serial_ports` from OS
- [x] `test_rs485` → sequentially read all basic targets; return structured snapshot
- [x] Monitor task:
  - long-lived client
  - sample interval / max speed
  - run_hours / until stop
  - batch insert every `commit_every`
  - emit `live-update` and `monitor-log` events
  - finalize session on stop/error/timeout
- [x] Config load/save under `%LOCALAPPDATA%\com.accuenergy.metering\settings.json`
- [x] DB under `%LOCALAPPDATA%\com.accuenergy.metering\meter_log.db`

**Software success:** monitor work is off the UI thread; Stop flushes/finalizes; duration, error thresholds, recovery logs, batching, and one-session enforcement match the specified behavior.
**Hardware gate remains open:** no “live Modbus works” claim until the lab workflow succeeds against a meter.

### Phase 3 — Reports + export (complete)

Focus: parity with `report.py`, better ergonomics.

- [x] Self-contained HTML report in Rust (latest values, stats, inline SVG trends)
- [x] Open report / app-data folders via `tauri-plugin-opener`
- [x] CSV export of session readings
- [x] Session list UI with report/export actions

**Software success:** report and CSV integration tests pass against a temporary SQLite session. Cross-port comparison with the Python app remains part of lab validation.

### Phase 4 — Hardening + release

- [x] Product-specific waveform icon with reproducible SVG/Python sources
- [x] Confirm, stop, flush, and finalize on window close while monitoring
- [x] Rotating app log under app data (`logs\app.log`, 5 MB)
- [x] Version triple: `package.json` / `Cargo.toml` / `tauri.conf.json`
- [ ] Signed NSIS when ready for team (product-specific updater key under `%USERPROFILE%\.tauri\`)
- [ ] S-drive staging: `S:\Engineering\Public\Syed_Hassaan_Shah\Accuenergy_Metering\` (or agreed name)

**Success:** installer runs on a second machine; cold start + RS485 test documented.

---

## IPC contract (implemented)

### Commands

| Command | Direction | Notes |
|---------|-----------|--------|
| `ping` | FE → BE | Runtime detection |
| `get_config` / `save_config` | FE ↔ BE | camelCase JSON |
| `list_serial_ports` | FE → BE | `{ name, description? }[]` |
| `test_rs485` | FE → BE | snapshot string or structured JSON |
| `preview_meter_defaults` | FE → BE | Dry-run read of `0x0FFE` × 5 |
| `apply_meter_defaults` | FE → BE | Isolated FC10 write, verify, then save settings |
| `start_monitor` / `stop_monitor` / `get_monitor_state` | FE ↔ BE | Single active session and lifecycle reconciliation |
| `recover_orphaned_sessions` | FE → BE | Finalize leftover `running` rows when no monitor is alive |
| `generate_report` | FE → BE | session id → path |
| `list_sessions` / `get_latest_session` | FE → BE | Session history |
| `export_session_csv` | FE → BE | Session id → CSV path |
| `load_session_review` | FE → BE | Finalized SQLite session, downsampled for review |
| `load_csv_review` | FE → BE | Export-format CSV, parsed read-only |
| `open_path` | FE → BE | Restricted to app-data files/folders |

### Events

| Event | Payload |
|-------|---------|
| `live-update` | `LiveUpdate` (camelCase) |
| `monitor-log` | `{ timestampMs, message }` |
| `monitor-finished` | `SessionSummary` |
| `monitor-failed` | `{ kind, message, sessionId }` |

### LiveUpdate (frontend `types.ts`)

Matches legacy fields: sessionId, timestampMs, values map, sampleCount, errorCount, liveHz, message.

---

## Module map (code)

| Area | Path |
|------|------|
| Shell UI | `frontend/src/shell/` |
| Live metrics / graph | `frontend/src/features/live/` |
| Settings UI | `frontend/src/features/settings/` |
| Tauri bridge | `frontend/src/integrations/tauri/meterBridge.ts` |
| Theme | `frontend/src/platform/ui/theme.ts` + `app/index.css` |
| Commands | `backend/src/api/` |
| Domain | `backend/src/domain/` |
| Monitor | `backend/src/monitor/` |
| Storage | `backend/src/storage/` |
| Report | `backend/src/report/` |

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
| Decode | Rust unit test with known float bit pattern — passing |
| Config validation | Rust unit tests — passing |
| UI pure logic | Vitest config and ring-buffer tests — passing |
| Storage/report | Temp SQLite integration tests — passing |
| Monitor policy | Unit tests for session IDs, status text, error thresholds — passing |
| Desktop smoke | Tauri dev window launched and responded — passing |
| Hardware E2E | Pending: ports → test → start 30–60s → stop → report |

---

## Required lab validation

1. Attach the USB-RS485 adapter and confirm its COM port appears in Settings.
2. Run Test RS485 against the Acuvim IIW and save the activity log result.
3. Start a 30–60 second session; confirm all available cards and graphs update.
4. Stop and verify the finalized SQLite row count, HTML report, and CSV export.
5. Compare one generated report with the same source readings in the Python app if exact cross-port validation is required.

---

## Out of scope (for now)

- Multi-meter simultaneous sessions  
- Cloud sync  
- Web-only deployment  
- Changing meter firmware / AXM-WEB2 Ethernet path (RS485 only unless requested)
