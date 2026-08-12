# Accuenergy Metering

Desktop app for **Acuvim IIW** power-meter data collection over **Modbus RTU (RS485)**.

This is a ground-up port of the older Python/PySide6 project to:

- **Rust** backend (serial/Modbus, SQLite logging, reports)
- **Tauri 2** desktop shell
- **React + TypeScript + Vite + Tailwind v4 + Bun** frontend
- **uPlot** for snappy real-time charts

## Folders

| Path | Purpose |
|------|---------|
| This repo / folder | New app |
| `../Accuenergy_Metering_Legacy` | Cloned original (`https://github.com/Hassaan-ECE/Accuenergy_Metering.git`) for reference |

## Docs

- [Legacy analysis](docs/LEGACY_ANALYSIS.md)
- [Port plan](docs/PORT_PLAN.md)
- [Implementation decisions](docs/DECISIONS.md)
- [Agent notes](AGENTS.md)

## Status (0.1.0)

The software port is feature-complete against the required legacy workflow:

- Persisted meter settings and Windows COM-port discovery
- Real Modbus RTU probe and long-lived monitor worker
- SQLite WAL sessions/readings with batched commits
- Tauri live events feeding metric cards, activity log, and uPlot charts
- Session history, self-contained HTML reports, and CSV export
- Light/dark Inventory-style UI and close-while-running protection

**Hardware status:** the desktop app builds and launches, but no serial ports were attached during the final verification on August 11, 2026. Live Acuvim/RS485 communication is therefore not claimed as hardware-verified.

## Develop

```powershell
cd C:\Projects\Active\Accuenergy_Metering
bun install
bun run dev:frontend   # http://127.0.0.1:5173
bun run desktop        # full Tauri window
```

Requires: Bun, Rust toolchain, WebView2 (Windows).

The browser URL intentionally uses synthetic demo data and never touches serial ports or app files. The Tauri desktop window uses the Rust backend when `ping` succeeds.

## Verify

```powershell
cd C:\Projects\Active\Accuenergy_Metering
bun install
bun run lint
bun run test
bun run build:frontend
cd backend
cargo fmt --check
cargo test
```

## App data

Runtime data is stored under:

```text
%LOCALAPPDATA%\com.accuenergy.metering\
  settings.json
  meter_log.db
  reports\
  exports\
  logs\app.log
```

The database uses SQLite WAL mode. A reading row is written only when at least one metric decodes successfully; a full miss increments the error count without inserting a row.

An invalid `settings.json` is surfaced as an error instead of silently resetting the connection to COM5/device 1. Leftover `running` sessions are finalized on the next desktop launch when no monitor is active, with their committed readings preserved.

## Lab workflow

1. Open `Settings`, select the adapter COM port, and confirm the serial parameters.
2. Run `Test RS485` and inspect the per-register PASS/FAIL activity log.
3. Run `Start` for 30–60 seconds and confirm cards/graphs update.
4. Run `Stop`; verify the session count and finalized status.
5. Generate the HTML report, export CSV, and inspect `meter_log.db`.

## USB–RS485 (FTDI) drivers for other PCs

If Device Manager shows **FT232R USB UART** with **Code 28** / no COMx port, install the VCP kit:

| | Path |
|--|------|
| **Team (use this on other machines)** | `S:\Engineering\Public\Syed_Hassaan_Shah\Accuenergy_Metering\drivers\FTDI_VCP\` |
| Local copy | `release-support\drivers\FTDI_VCP\` (gitignored; not in GitHub) |

Run `CDM21228_Setup.exe` as Administrator, then set the new **COMx** in Settings. Full steps and SHA256: `README.md` in that folder.

## Lab defaults

Serial: **19200 8N1** · device ID **1** · 1 Hz sample · 24 hour run.
**COM number is PC-specific** (this lab PC used **COM3** after FTDI install; app default may still say COM5 until you save Settings).

`sample_hz = 0` means maximum bus speed. `run_hours = 0` means run until stopped.
