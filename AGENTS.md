# Agent notes — Accuenergy Metering

## Workspace

| Path | Role |
|------|------|
| `C:\Projects\Active\Accuenergy_Metering` | **Active app** (Tauri / Rust / Bun / React) |
| `C:\Projects\Active\Accuenergy_Metering_Legacy` | Read-only reference clone of the old Python app |
| GitHub (legacy) | https://github.com/Hassaan-ECE/Accuenergy_Metering.git |

Read before non-trivial work:

- `docs/LEGACY_ANALYSIS.md` — what the old app did
- `docs/PORT_PLAN.md` — phases and IPC contract
- `docs/DECISIONS.md` — behavior and verification boundaries
- `docs/REVIEW_FIX_PASS.md` — completed reliability review pass

UI/release conventions: mirror `Inventory_Management` (not its domain).

## Identity

| Item | Value |
|------|--------|
| Name | Accuenergy Metering |
| Package | `accuenergy-metering` `0.1.1` |
| Tauri id | `com.accuenergy.metering` |
| Local data | `%LOCALAPPDATA%\com.accuenergy.metering\` |

## Stack

Tauri 2, React 19, TypeScript, Vite, Tailwind v4, Bun, Rust.
Live graphs: **uPlot**. Storage: bundled **SQLite** (not FeOx).
Serial: `serialport` + Modbus RTU client.

## Current phase

The software port is feature-complete for the legacy workflow plus session review, CSV import/export, and isolated meter communication restore. The desktop backend owns serial I/O, monitoring, SQLite, reports, orphan recovery, and the rotating app log; browser mode remains demo-only.
Do not claim live RS485/Modbus validation in any session that did not complete a real COM smoke test against a meter.

## Commands

```powershell
bun install
bun run dev:frontend    # browser-only UI
bun run desktop         # Tauri dev
bun run build:frontend
bun run test
cd backend; cargo test
```

## Device defaults (lab-proven in legacy)

COM5 · device ID 1 · 19200 baud · parity N · 1 stop bit · sample 1 Hz · run 24 h

Register map: see `backend/src/domain/meter.rs` and legacy `Code/core/meter.py`.

## Release (later)

Follow Syed PDU-style signed NSIS + S-drive layout. **New updater keypair** for this product — do not reuse Inventory/PDU keys.

Team install root: `S:\Engineering\Public\Syed_Hassaan_Shah\Accuenergy_Metering_V2\`  
FTDI VCP: `...\Accuenergy_Metering_V2\drivers\FTDI_VCP\`  
(The sibling `Accuenergy_Metering\` folder is the legacy Python drop only.)
