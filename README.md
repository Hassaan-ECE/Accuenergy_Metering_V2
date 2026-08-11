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
- [Agent notes](AGENTS.md)

## Status (0.1.0 scaffold)

- Inventory-style UI shell (metrics, graph, log, theme toggle)
- **Demo** live stream (no hardware required) for UI development
- Rust domain: config + Acuvim basic register map + float decode tests
- Modbus monitor / SQLite / reports: **not wired yet** (see port plan Phase 2–3)

## Develop

```powershell
cd C:\Projects\Active\Accuenergy_Metering
bun install
bun run dev:frontend   # http://127.0.0.1:5173
bun run desktop        # full Tauri window
```

Requires: Bun, Rust toolchain, WebView2 (Windows).

## Lab defaults

COM5 · 19200 8N1 · device ID 1 · 1 Hz sample (0 = max rate) · run hours 0 = until stopped
