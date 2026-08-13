# Feature pass — UI layout, multi-graph, meter defaults, CSV/session recall

**Status:** implement next  
**Date:** 2026-08-12  
**Owner intent:** Lab collection on different tests/meters, then reload/compare data in-app. Live Modbus works (this lab meter was **device ID 2** on **COM3**).

**Hand to implementor:** read this file end-to-end and implement. Prefer thin vertical slices; match Inventory-style UI. Do not replace uPlot.

**App:** `C:\Projects\Active\Accuenergy_Metering`  
**Legacy authority (full product + tools):** `C:\Projects\Active\Accuenergy_Metering_Legacy_2`  
**Thin GitHub clone (partial only):** `C:\Projects\Active\Accuenergy_Metering_Legacy` — do **not** treat as complete  
**Decisions baseline:** `docs/DECISIONS.md`

### Must-read for meter config (Legacy_2)

| Path | Why |
|------|-----|
| `Code/tools/meter_rs485_restore_defaults.py` | **Authoritative** restore/overwrite of on-device RS485/Modbus comm settings |
| `Code/tools/RS485_METER_TOOLS.md` | Lab procedure, dry-run vs `--apply`, dual-meter safety |
| `Code/tools/meter_rs485_test.py` | Port list, ID/baud scan, read `0FFEH`×5, basic values |
| `Documents/Project_Context_and_Setup.md` | Dual-meter bus: ID1 + ID2, 19200 8N1 |

---

## Context (why)

1. Meters on the bench may not match our communication profile (device ID, baud, etc.). Legacy_2 already has **`meter_rs485_restore_defaults.py`** to **overwrite the meter’s own configuration**. Port that behavior into a clear **button in V2**.
2. Live graph **X-axis labels are clipped** at the bottom — tighten layout (padding / move plot up).
3. **Activity log + Sessions** take space when not needed — make that panel **toggleable** (default can stay on or last-used preference).
4. Owner wants **multiple graphs visible at once** (frequency / voltage / current / power), each controllable by toggles, **smaller**, all **fitting the graph area with no scrolling**.
5. Same app will collect runs for different tests; need **simple CSV export** and **load saved data** (CSV and/or prior sessions) back into the UI to review graphs, values, and **settings used for that run**.

---

## 1) Button: restore meter RS485/Modbus defaults (port of Legacy_2 tool)

### Goal

Add a toolbar control (e.g. **“Restore meter defaults”** / **“Configure meter…”**) that ports **`meter_rs485_restore_defaults.py`** into Rust + UI: write **on-device** communication registers so the meter matches the lab profile — not only the app’s `settings.json`.

**Authority:** implement register map and semantics from Legacy_2, not guesswork.

### Confirmed lab dual-meter profile (after restore)

| Meter | Modbus ID | Baud | Format |
|-------|----------:|-----:|--------|
| Meter 1 | **1** | 19200 | 8N1 |
| Meter 2 | **2** | 19200 | 8N1 |

Confirmed register snapshot from `RS485_METER_TOOLS.md`:

```text
Meter 1: registers=[0, 3, 0, 1, 19200]
Meter 2: registers=[0, 3, 0, 2, 19200]
```

### Exact Modbus map (copy into Rust)

**Block:** holding registers, start **`0x0FFE`**, count **5**  
**Read:** function **03H**  
**Write:** function **10H** (write multiple registers) — same as Python tool  

| Index | Address | Field | Lab default | Notes |
|------:|---------|--------|------------:|-------|
| 0 | `0x0FFE` | Protocol | **0** | 0 = Modbus; 1 = DNP3.0 |
| 1 | `0x0FFF` | Parity code | **3** | 0=Even, 1=Odd, 2=Non2 (N+2 stop), **3=Non1 (N+1 stop)** |
| 2 | `0x1000` | Password | **preserve existing** | Default: do **not** reset; optional advanced “reset password to 0000” only if UI exposes it (Python `--reset-password`) |
| 3 | `0x1001` | Device / slave ID | **target ID** (1 or 2) | UI must let user pick target meter role |
| 4 | `0x1002` | Baud rate | **19200** | Integer baud value in the register |

Python constants to mirror:

```text
COMM_SETTINGS_START = 0x0FFE
COMM_SETTINGS_COUNT = 5
DEFAULT_PROTOCOL = 0
DEFAULT_PARITY_CODE = 3
DEFAULT_DEVICE_ID = 1
DEFAULT_BAUDRATE = 19200
```

### Connect / apply flow (match Python tool)

1. **Dry-run first (always in log):** open COM with **current** serial settings (port, baud, parity, stop, **current** device ID), **read** `0x0FFE`×5, show “before” vs “after” registers in the activity log.  
2. **Confirm dialog** before any write (Python requires explicit `--apply`).  
3. **Write** the 5-register block with function 10H using the **current** connection (meter still at old ID/baud until write completes).  
4. After write, meter may only answer at **new** baud/ID — re-open with target settings and **read back** to verify.  
5. On success: update **app** `settings.json` (port unchanged; baud/parity/stop/deviceId = target).  
6. Optional stretch (high value): **scan current** settings if first connect fails — Python supports scanning IDs 1–10, common bauds, N/E/O, stop 1–2 (see tool + `RS485_METER_TOOLS.md`). V1 can require correct Settings first; document if scan is deferred.

### Safety (non-negotiable)

- **Disabled** while monitor **Start** is running.  
- Strong confirm copy: changing these registers changes how the meter talks on the bus.  
- **Dual-meter bus:** if both meters share one RS485 line, **isolating one meter before applying** is required when changing IDs (same as Legacy_2 docs). UI must warn: *“Isolate this meter from the daisy chain before applying, or both meters may conflict.”*  
- Never write password register unless user explicitly opts into reset-password.  
- Failures: log clearly; do not silently rewrite app settings if verify-read fails.

### UX

- Button near **Test RS485** / Settings.  
- Dialog fields (minimum):
  - Current connect: port (from settings), baud, parity, stop, **current device ID**
  - Target: **target device ID** (default 1; allow 2 for “make this unit meter 2”), **target baud** (default 19200)
  - Checkbox: “I isolated this meter on the bus”
  - Preview of registers before / after  
  - **Apply** / Cancel  
- Activity log: PASS/FAIL for read, write, verify.  
- Notice toast on success/failure.

### Acceptance

- [ ] Register addresses and write FC match Legacy_2 (`0x0FFE`×5, FC 10H).  
- [ ] Dry-run preview in log without write.  
- [ ] Confirm + isolation warning before apply.  
- [ ] Password preserved by default.  
- [ ] Verify-read after apply; app settings updated only on success.  
- [ ] Documented in `docs/DECISIONS.md` with pointer to Legacy_2 source file.  
- [ ] Does not invent extra config registers beyond this block unless owner asks.

---

## 2) Graph layout: X-axis not clipped

### Goal

Bottom time axis labels and legend must be fully visible (no cutoff).

### Implementation notes

- Inspect `LiveGraph.tsx` / uPlot host sizing: add bottom padding, reduce title crowding, or `size`/`padding` in uPlot options.
- Prefer **no outer scrollbar** on the graph region for the multi-graph layout (see §4).
- Dark/light themes both checked.

### Acceptance

- [ ] Full X-axis tick labels visible with ≥1 graph and with multi-graph mode.
- [ ] No clipping under status strip / card border.

---

## 3) Toggle: Activity + Sessions panel

### Goal

Owner can hide **Activity log** and **Sessions** (and related list UI) when they want max space for metrics/graphs.

### UX

- Toolbar toggle, e.g. **“Log & sessions”** (on/off).
- Persist preference (`localStorage` and/or `settings.json` flag e.g. `showActivityPanel`).
- When off: reclaim horizontal/vertical space for graphs (depending on current layout).
- When on: current behavior (log + session list).

### Acceptance

- [ ] Toggle works without restart.
- [ ] Preference survives app restart.
- [ ] Hidden state does not break Start/Stop/Test logging (still capture logs; show when re-enabled).

---

## 4) Multi-graph view: toggles, smaller plots, fit area (no scroll)

### Goal

Current single-graph area becomes a **multi-graph panel** controlled by toggles so several series groups can show **at the same time**.

### Series groups (minimum)

| Toggle | Series (from existing live keys) |
|--------|-----------------------------------|
| Frequency | `frequency_hz` |
| Voltage | `phase_voltage_v1/v2/v3`, `line_voltage_v12` (same as report grouping is fine) |
| Current | `current_i1/i2/i3` |
| Power / PF | `active_power_p1`, `power_factor_pf1` |

### Layout rules

- Toggles are buttons (can multi-select; at least one always on — if user turns last off, re-enable Frequency or keep previous).
- Visible graphs share the **same fixed graph region**; **do not** make that region page-scrollable.
- **Shrink** each uPlot so N visible graphs tile (e.g. 1 → full; 2 → 2 rows or 1×2; 3–4 → 2×2 grid).
- Align time windows (same ring buffer / same `times` array for live mode).
- Fix X-axis clipping per plot (§2); smaller height is OK if labels remain readable (may use fewer ticks).

### Acceptance

- [ ] Can show 2+ graph groups simultaneously.
- [ ] Graph region does not scroll; all visible plots fully in view.
- [ ] Toggles are obvious and fast.
- [ ] Live updates remain smooth (uPlot `setData`, no full React remount every sample).

---

## 5) Simple CSV export button

### Goal

Obvious **Export CSV** for the current/last completed session (and optionally selected session in the list).

### Behavior

- Backend already has / should use `export_session_csv` (or equivalent).
- Button in toolbar near Report.
- Default: export **last completed** or **selected** session.
- Open export folder or return path + notice with full path.
- CSV includes timestamps + all metric columns + enough metadata (session id, config JSON or key settings fields) for later compare.

### Acceptance

- [ ] One-click export for a finished session.
- [ ] File appears under app `exports\` (or user-chosen path if dialog is already easy).
- [ ] CSV reloads in Excel/LibreOffice with clear headers.

---

## 6) Load data into the app (session recall / offline review)

### Goal

After collecting runs for different tests/meters, load data back to:

- See **graphs** as they would have looked.
- See **metric history** / latest values from that run.
- See **settings that were saved with that session** (`config_json` already on sessions).

### Sources (implement in order)

1. **Load from session list** (DB) — pick a completed session → enter **Review mode**.
2. **Load from CSV** (file picker) — import export format from §5; if config metadata present, show it.
3. Stretch: load HTML report is **not** required.

### Review mode UX

- Banner: **“Reviewing session `run_…` (read-only)”** with **Exit review**.
- Disable Start / Test RS485 / Configure meter while reviewing (or allow Test but clearly separate).
- Populate multi-graphs from full session series (or downsampled if huge — keep UI responsive; document limit).
- Show session config summary (port, baud, device ID, sample rate, etc.).
- Optional: side-by-side later; **v1 = one loaded session at a time**.

### Acceptance

- [ ] Can open a past DB session and see graphs + settings.
- [ ] Can import a CSV produced by this app and see graphs.
- [ ] Exit review returns to live-ready state cleanly.
- [ ] No writes to meter during review.

---

## 7) Suggested UI chrome (toolbar)

Keep Inventory-like density. Suggested control order:

`Start` `Stop` | `Test RS485` `Configure meter…` | `Settings` | `Export CSV` `Open report` `Load…` | toggles: `Graphs: Freq|V|I|P` | `Log & sessions`

Exact labels flexible; behavior is not.

---

## 8) Implementation slices (order)

1. **Layout fixes** — graph padding/X-axis; activity panel toggle; multi-graph toggles + fit grid (can use live or demo data).
2. **CSV export button** wired to existing backend; verify file.
3. **Session recall from DB** (review mode).
4. **CSV load** into review mode.
5. **Restore meter defaults** — port `meter_rs485_restore_defaults.py` from **Legacy_2** (registers `0x0FFE`×5, FC 10H, dry-run + apply + verify + isolation warning).

Commit after each slice if unattended.

---

## 9) Out of scope (this pass)

- Multi-session overlay compare on one chart (nice follow-up; v1 is load one at a time).
- Cloud sync / FeOx.
- Signed installer / S-drive release.
- Changing chart library (stay on **uPlot**).
- Auto device-ID scan UI (optional stretch only; meter configure to ID 1 is the main “unknown config” fix).

---

## 10) Verification

```powershell
cd C:\Projects\Active\Accuenergy_Metering
bun run lint
bun run test
bun run build:frontend
cd backend
cargo test
cargo clippy --all-targets -- -D warnings
bun run desktop
```

Hardware (when available):

1. Configure meter (if implemented) or Settings device ID as needed.
2. Test RS485 → Start 30s → multi-graph toggles → hide log panel → Export CSV.
3. Stop → Load session from list → confirm graphs/settings → Exit review → Load CSV.

---

## 11) Handoff notes for implementor

- **Full legacy:** `C:\Projects\Active\Accuenergy_Metering_Legacy_2` (restore tool, dual-meter docs, power_profile, sample data). Prefer this over the thin GitHub clone.
- **Restore tool source of truth:** `Accuenergy_Metering_Legacy_2\Code\tools\meter_rs485_restore_defaults.py` + `RS485_METER_TOOLS.md`.
- Lab finding (2026-08-12): meter on **COM3**, answered as **device ID 2**, 19200 8N1; values often **0** with PF **1** (comms OK).
- Dual-meter intent long-term: ID **1** + ID **2** on one bus (see Project_Context_and_Setup.md).
- App settings path: `%LOCALAPPDATA%\com.accuenergy.metering\settings.json`
- Update `docs/DECISIONS.md` for ported register map and UI prefs.
- Owner will review visually; graph fit and toggles matter as much as backend correctness.

---

## Short paste prompt for the implementor agent

```
Read and implement C:\Projects\Active\Accuenergy_Metering\docs\FEATURE_PASS_UI_SESSION_RECALL.md completely.

Work in C:\Projects\Active\Accuenergy_Metering. For meter config, port Accuenergy_Metering_Legacy_2\Code\tools\meter_rs485_restore_defaults.py (registers 0x0FFE count 5, FC 10H) — do not invent addresses. Follow the slice order in the feature doc. Keep uPlot. Match Inventory-style UI. Commit milestone slices. Log choices in docs/DECISIONS.md. Start now.
```
