# Legacy Accuenergy Metering — deep analysis

**Source:** `C:\Projects\Active\Accuenergy_Metering_Legacy`  
**GitHub:** https://github.com/Hassaan-ECE/Accuenergy_Metering.git  
**Analyzed:** 2026-08-11  

This document captures what the Python/PySide6 app does, how it is structured, what to preserve, and what to improve when porting to Tauri + Rust + Bun/React.

---

## 1. Product purpose

Desktop workspace for **Accuenergy Acuvim IIW** power meters:

1. Connect over **Modbus RTU / RS485** (USB-RS485 adapter, typical `COM5`).
2. **Sample** a fixed set of holding-register floats at a configured rate.
3. **Log** samples into SQLite with session metadata.
4. **Live UI**: metric cards + frequency-vs-time graph + activity log.
5. **HTML report** with stats and matplotlib trend charts for a finished session.
6. **One-shot RS485 probe** (“Test RS485”) and a CLI probe tool.

Device identity (as coded):

| Field | Value |
|-------|--------|
| Model | Acuvim IIW-M-mV-P2V3 |
| Manufacturer | Accuenergy |
| Protocol | Modbus RTU over RS485 |
| Confirmed defaults | COM5, device ID 1, 19200 baud, N, 1 stop bit |

---

## 2. Stack (legacy)

| Layer | Tech |
|-------|------|
| Entry | `main.py` (GUI default, `--cli` for headless) |
| GUI | PySide6 (Qt) |
| Live graph | pyqtgraph (optional; degrades if missing) |
| Modbus | pymodbus serial RTU client |
| Serial ports | pyserial (`list_ports`) |
| Storage | SQLite WAL (`Data/meter_log.db`) |
| Reports | pandas + matplotlib → self-contained HTML |
| Packaging | PyInstaller onefile via `build.py` → `Output/AccuenergyMetering.exe` |

---

## 3. Layout

```
Accuenergy_Metering_Legacy/
  main.py                 # GUI / CLI entry, crash log, splash
  settings.json           # persisted AppConfig
  build.py                # PyInstaller
  Code/
    core/
      config.py           # paths, AppConfig, load/save
      meter.py            # Modbus targets, decode, snapshot
      monitor.py          # sample loop, batch DB writes
      database.py         # SQLite schema + session helpers
      report.py           # HTML report generation
      shell.py            # open path with OS default app
    gui/
      main_window.py      # MainWindow + MonitorWorker thread
      settings_dialog.py
      theme.py            # light/dark QSS palettes
      widgets.py          # MetricCard
    tools/
      meter_rs485_test.py # CLI probe / ID scan
  Documents/              # datasheets + user guide generator
```

Runtime folders created next to the app root:

- `Data/` — SQLite DB  
- `Output/` — HTML reports + `startup_error.log`  
- `Documents/` — docs (also ships datasheets)

---

## 4. Domain model

### 4.1 Config (`AppConfig`)

| Field | Default | Notes |
|-------|---------|--------|
| `theme_name` | light | light \| dark |
| `port` | COM5 | required |
| `baudrate` | 19200 | |
| `device_id` | 1 | Modbus slave 1–247 |
| `parity` | N | N/E/O |
| `stop_bits` | 1 | 1 or 2 |
| `sample_hz` | 1.0 | **0 = as fast as hardware allows** |
| `run_hours` | 24.0 | **0 = until user stops** |
| `commit_every` | 50 | batch size for SQLite inserts |
| `timeout_seconds` | 1.0 | serial timeout |
| `retries` | 1 | pymodbus retries |

Persisted to `settings.json` at project root (or beside frozen exe).

### 4.2 Meter map (`ACUVIM_BASIC_TARGETS`)

Each target is **2 holding registers** decoded as **big-endian IEEE-754 float** (`struct.pack(">HH")` → `">f"`).

| Key | Label | Address | Unit |
|-----|-------|---------|------|
| `frequency_hz` | Frequency | 0x4000 | Hz |
| `phase_voltage_v1` | Phase Voltage V1 | 0x4002 | V |
| `phase_voltage_v2` | Phase Voltage V2 | 0x4004 | V |
| `phase_voltage_v3` | Phase Voltage V3 | 0x4006 | V |
| `line_voltage_v12` | Line Voltage V12 | 0x400A | V |
| `current_i1` | Current I1 | 0x4012 | A |
| `current_i2` | Current I2 | 0x4014 | A |
| `current_i3` | Current I3 | 0x4016 | A |
| `active_power_p1` | Active Power P1 | 0x401C | W |
| `power_factor_pf1` | Power Factor PF1 | 0x4034 | — |

**Important I/O characteristic:** reads are **sequential**, one register-pair at a time (`read_holding_registers(addr, count=2)` × 10). That is the dominant latency; Rust will not magically make the bus faster unless you change the strategy (block reads where the map allows, parallel only if multi-master — it does not).

### 4.3 Session + readings (SQLite)

**`sessions`**

- `session_id` PK (`run_YYYYMMDD_HHMMSS_ffffff`)
- `started_at`, `ended_at`, `status` (`running` / `stopped` / `completed` / `error`)
- `stop_reason`, `sample_count`, `error_count`, `report_path`, `config_json`

**`readings`**

- `id`, `session_id`, `ts_unix`, `ts_iso`
- one `REAL` column per meter key  
- indexes: `ts_unix`, `(session_id, ts_unix)`
- WAL + `synchronous=NORMAL`

A sample is counted only if **any** key decoded successfully; full miss increments `error_count` and does **not** insert a row.

### 4.4 Live update payload

```
LiveUpdate {
  session_id, timestamp,
  values: dict[key -> float | None],
  sample_count, error_count, live_hz, message
}
```

`live_hz = sample_count / elapsed_seconds` (effective throughput, not the setpoint).

---

## 5. Runtime flows

### 5.1 GUI start → monitor → report

1. Splash → `MainWindow` loads config + theme QSS.
2. **Start** spawns `QThread` + `MonitorWorker` → `run_monitor_session`.
3. Worker keeps a **long-lived** Modbus serial client open for the whole run.
4. Progress signals update cards + append frequency to a 1800-point deque; graph redraw throttled to ~150 ms.
5. **Stop** sets a thread `Event`; loop exits after the current read, flushes batch, finalizes session.
6. **Open Report** may stop first if still running, then `generate_report_for_session` and OS-open the HTML.

### 5.2 Test RS485

Opens client, reads all basic targets once, logs a human snapshot, sets status “RS485 OK” / “No reply”. Client closed after probe.

### 5.3 CLI (`python main.py --cli`)

Same monitor session with terminal progress; auto-generates report if ≥2 samples.

### 5.4 Probe tool (`Code.tools.meter_rs485_test`)

List ports, single read, acuvim-basic set, optional device-ID scan. Useful for lab bring-up; should exist as a Rust binary or Tauri command in the port.

---

## 6. UI / UX (legacy)

**Strengths**

- Clear primary actions: Start / Stop / Test / Settings / Report.
- Theme toggle with coherent light/dark palettes.
- Metric cards for the high-signal values (Hz, V1, I1, P1 + counters).
- Activity log with timestamps; session paths selectable.

**Limitations to fix in the port**

| Area | Legacy behavior | Opportunity |
|------|-----------------|-------------|
| Graph | Frequency only | Multi-series: V, I, P, selectable metrics |
| Graph perf | pyqtgraph + full setData each tick | uPlot / canvas; ring buffer; downsample |
| Metrics shown live | 4 of 10 values | Full grid + sparklines optional |
| Sessions | Last session only in UI | Session browser, re-open report, export CSV |
| Settings | Modal form, free-text COM | Port dropdown from OS enumeration |
| Layout | Dense Qt forms | Inventory-style shell: DM Sans, cards, status strip |
| Errors | Message boxes + log | Structured toast + recoverable disconnect |
| Packaging | Fat PyInstaller exe | Small Tauri NSIS + signed updater (when ready) |

---

## 7. Performance reality check

What **cannot** be accelerated without protocol changes:

- RS485 half-duplex latency and per-request timeouts.
- Meter response time per function-code call.

What **can** be snappier with Rust + modern frontend:

| Bottleneck | Legacy | Port approach |
|------------|--------|----------------|
| Per-sample overhead | Python + pandas-ready rows | Rust loop, fixed structs, batched SQL |
| UI thread | Qt signals + pyqtgraph | Tauri events → React; graph library optimized for streaming |
| Report gen | Blocking pandas/matplotlib on GUI | Background Rust task; optional pure-HTML SVG charts |
| Startup | Heavy PySide/PyInstaller | Lightweight WebView + native core |
| Graph window | 1800 points, redraw throttle 150 ms | Same window size OK; smoother path, multi-series |

**Possible protocol wins (optional later):** if the register map is contiguous in ranges, read larger blocks and slice floats (fewer RTU frames). Verify against Acuvim manual before assuming continuity (gaps exist: e.g. 0x4006 → 0x400A).

---

## 8. Dependencies & packaging quirks

- Frozen path: if exe lives under `Output/`, base dir is parent (so `Data/` and `settings.json` stay next to the project, not inside Output).
- Crash log: `Output/startup_error.log`.
- Build archives previous exe into `Old/`.
- No `requirements.txt` in repo; `build.py` installs packages by import name.

---

## 9. What must be preserved (port parity)

1. **Exact register map + big-endian float decode** for the basic set.  
2. **Session semantics**: sample vs error counting, stop reasons, duration/run-forever.  
3. **Config fields and defaults** (lab-proven COM5 @ 19200 N1).  
4. **HTML report contents**: latest values, n/mean/min/max/std, voltage/current/power trends.  
5. **Test RS485** one-shot diagnostic.  
6. **Safe stop**: user cancel does not corrupt the session finalize path.  
7. Ability to open Output/Data folders and reports in the OS shell.

---

## 10. What we deliberately improve

1. Inventory-aligned **visual system** (Tailwind v4, DM Sans, light/dark tokens).  
2. **Snappy live graphs** (uPlot scaffolded; multi-metric planned).  
3. **Rust monitor** thread/async task with Tauri `emit` of `LiveUpdate`.  
4. Better **port discovery** and settings UX.  
5. Optional **CSV export**, session list, and richer metric set in live UI.  
6. Team install path later: NSIS + product-specific updater keys on S-drive (same release discipline as Inventory / PDU).

---

## 11. Risk / open questions

| Question | Why it matters |
|----------|----------------|
| Live meter available for smoke? | Cannot claim Modbus parity without hardware |
| Block-read safe on this firmware? | Potential sample-rate gain |
| Multi-meter / multi-port later? | Schema is single-device-per-session today |
| Keep SQLite vs FeOx/other? | SQLite is a good fit for time-series append; FeOx is inventory-oriented |
| Power units scaling on IIW? | Probe tool notes “W or scaled W” for P1 — verify against datasheet |

---

## 12. Reference files (highest value)

| File | Why |
|------|-----|
| `Code/core/meter.py` | Register map + float decode + probe |
| `Code/core/monitor.py` | Session loop contract |
| `Code/core/database.py` | Schema + batch insert |
| `Code/core/report.py` | Report contract |
| `Code/gui/main_window.py` | UI state machine |
| `settings.json` | Live lab defaults |
| Datasheets under `Documents/` | Protocol / register authority |
