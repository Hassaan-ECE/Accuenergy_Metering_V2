# Implementation decisions

**Date:** August 11, 2026  
**Updated:** August 13, 2026
**Version:** 0.1.1

## Success criteria used

The implementation is considered software-complete when the persisted settings, serial discovery, full basic-register probe, long-running monitor, SQLite storage, live Tauri events, responsive desktop UI, session/report workflow, CSV export, close protection, tests, and run documentation are all present. Hardware success is tracked separately and requires an actual meter smoke test.

## Behavior priorities

1. Match the legacy Python behavior where it is explicit.
2. Use Inventory Management visual patterns for layout, tokens, typography, cards, and interaction quality.
3. Keep the browser useful for UI development, but clearly synthetic; only Tauri desktop performs serial I/O and file operations.

## Modbus

- Read each metric as a separate pair of holding registers, in the legacy order. No speculative block read is used.
- Decode each pair as a big-endian IEEE-754 float32 and reject non-finite results.
- Apply timeout and retry settings per metric.
- Keep one Modbus RTU context open for the monitor session.
- Check the stop token between metrics so a close/stop request is not forced to wait for all ten register pairs.
- Treat a sample as valid when at least one metric decodes. A full miss increments errors and inserts no SQLite row.

## Monitor lifecycle

- Allow only one active session per app process.
- Generate IDs as `run_YYYYMMDD_HHMMSS_microseconds`.
- Log consecutive failures at 1, 5, 10, and every 25, then log restoration.
- Flush pending readings and finalize the session on user stop, duration completion, or runtime error.
- Intercept desktop window close while running, ask for confirmation, request Stop, wait for finalization, then close.

## Storage and paths

- Use bundled SQLite with WAL, `synchronous=NORMAL`, and a five-second busy timeout.
- Store settings, database, reports, exports, and `logs\app.log` under `%LOCALAPPDATA%\com.accuenergy.metering\`.
- Persist the normalized config JSON on every session record.
- Restrict `open_path` to files and folders inside the app-data root.

## Reports and export

- Generate one self-contained HTML file with no script, stylesheet, font, or chart CDN dependencies.
- Include device/session headers, config, counts, latest values, n/mean/min/max/sample-standard-deviation, and inline SVG trends.
- Add CSV export and a completed-session list because both improve the legacy workflow without changing meter semantics.

## UI

- Show all ten basic meter values plus Samples, live rate, Errors, and Status.
- Keep 1,800 aligned points for frequency, voltage, current, power, and power-factor graph views.
- Disable settings, probe, and duplicate starts while monitoring; keep Stop available until finalization.
- Persist light/dark theme with the same config model and mirror it to local storage to prevent startup flash.
- Replace the borrowed Inventory icon with a product-specific Accuenergy waveform mark and keep its generator beside the asset.

## Feature pass — UI and session recall

- Tile Frequency, Voltage, Current, and combined Power/PF uPlot groups inside one fixed graph region. All visible plots share the same aligned time buffer and update with `setData`; no chart-library replacement or per-sample React remount is used.
- Keep at least one graph group selected. Persist visible graph groups and the Log & sessions panel preference in local storage because these are workstation UI preferences rather than meter/session configuration.
- Size each uPlot from its actual tile and reserve explicit bottom-axis space and padding so timestamp labels remain visible in one- and multi-graph layouts.
- Put a one-click Export CSV action beside Report. It uses the explicitly current finalized session and never silently falls back to another historical run.
- Repeat finalized session metadata (`started_at`, `ended_at`, `status`, and serialized `config_json`) on each CSV data row. This stays spreadsheet-friendly while making each exported file self-contained for the later CSV review slice.
- Load finalized SQLite sessions through a dedicated read-only review payload containing session metadata and readings. Display at most 12,000 evenly sampled points while preserving first and last readings; retain the original sample count in the UI.
- Keep live/controller state underneath review mode rather than overwriting it. Exiting review therefore returns to the prior live-ready state without restarting the backend or mutating meter settings.
- Parse imported CSV files in Rust against named columns from the app export format. Meter values and timestamps are required; session/config metadata is optional for compatibility, with the UI explicitly marking missing settings metadata.
- Use the Tauri file picker for CSV selection, then pass the chosen path to the Rust parser. Imported files remain read-only and are never copied into SQLite or written back to the meter.
- Port meter communication restore strictly from `C:\Projects\Active\Accuenergy_Metering_Legacy_2\Code\tools\meter_rs485_restore_defaults.py`: read holding registers `0x0FFE` through `0x1002` with FC03, preserve register `0x1000` (password), and write the full five-register block with FC10 only. Verification follows the legacy tool by checking protocol, parity, device ID, and baud while not requiring the password register to echo its readable pre-write value.
- Require a successful dry-run read, explicit destructive confirmation, and an “isolated from the daisy chain” acknowledgement in the UI. The backend independently rejects concurrent monitoring/configuration operations and persists target 8N1 app settings only after reopening at the target ID/baud and verifying the complete block.
- Keep target roles at device IDs 1 and 2 with 19200 baud as the dialog defaults. Automatic current-setting scans and password reset are deferred; operators must first enter the meter's current connection in Settings, matching the minimum safe Legacy_2 workflow.

## Review-fix pass (2026-08-12)

- Save normalized settings through a same-directory temporary file and replacement step. Missing settings still use lab defaults; present but invalid or unreadable settings surface an error and cannot silently become COM5/device 1.
- Auto-finalize orphaned `running` or null-ended sessions only when the in-process monitor is idle. Preserve readings and stored errors, recount samples, and record `Process exited unexpectedly`.
- Guard Test RS485 with the same exclusive serial-operation guard as meter configuration, so probes, restore operations, and monitor startup cannot overlap.
- Keep report, CSV, and review actions limited to finalized sessions with readings. Failed connection attempts clear their ghost session id, and toolbar actions never fall back to `sessions[0]`.
- Preserve config honesty in historical review: invalid database `config_json` keeps readings reviewable but is marked unavailable instead of displaying lab defaults as real run settings.
- Write best-effort operational messages to `%LOCALAPPDATA%\com.accuenergy.metering\logs\app.log` and rotate one backup after 5 MB; log I/O failures do not fail monitoring.
- Use a full-width first plot for the three-graph layout. No uPlot axis values were changed because rendered clipping could not be inspected from the unattended CLI.

## LiveGraph wrap-up pass (2026-08-13)

- Preserve the denser Inventory-style shell, compact header menus, graph tiling, and uPlot zoom/pan work from the lab UI pass.
- When a plot is zoomed, update uPlot with `setData(data, false)` and immediately call `redraw()` because this bundled uPlot version does not commit that path itself.
- Treat the X view as zoomed only when it is meaningfully smaller than the data extent. Require a six-pixel drag deadzone, clear the latch at full extent, and make Reset/double-click auto-range both X and Y.
- Use explicit live/review dataset identity plus timestamp extent transitions so Start, entering review, exiting review, and empty-to-first-sample transitions clear zoom without disrupting normal live appends or a sliding 1,800-point buffer.
- Keep hidden-series state derived from the active series signature, and cap zero-size mount retries while retaining `ResizeObserver` recovery.
- Keep CSV loading in the download menu and label it `Export & load`. The header title is the product name only (no version or Desktop chip).
- After Stop, the same control becomes Clear. Clear wipes live graphs, metric cards, counters, and probe status, keeps meter Settings, then disables until new live/test/review data appears.

## Export save-as and simple CSV (2026-08-13)

- CSV and HTML report always ask for a destination with the Tauri save dialog. Cancel leaves no file.
- CSV rows are readings only: one `timestamp` (`YYYY-MM-DD HH:MM:SS` local) and the ten meter columns. Session identity, full ISO/unix times, and `config` stay in `<name>.settings.json`. Load still accepts older `ts_unix` / `ts_iso` columns.
- Load CSV still accepts the older wide export if present; new exports restore settings from the sidecar.

## Detect meter (2026-08-13)

- Detect is a read-only scan beside Test RS485. It probes holding register `4000H` (FC03, 2 registers) like the Legacy_2 scan tool. It never writes meter communication registers.
- Scan order: every detected COM port (Settings port first, then Windows-enumerated ports), current serial parameters with IDs 1–10 (current ID first), then common bauds at 8N1, then a smaller E/O and 2-stop pass. Timeout is 0.3 s with no retries. A port that will not open is skipped; the rest of the scan continues.
- When a serial combo replies, remaining IDs are scanned at that combo only. If several IDs answer (daisy chain), keep the current device ID when it replied; otherwise use the lowest ID. App settings are saved only after a hit.
- Detect uses the same exclusive serial guard as Test/configure and is disabled while monitoring.
- If Windows lists no COM ports, Detect reports that the FTDI VCP driver may be required (Code 28) and points at the S: `CDM21228_Setup.exe`. When USB enum shows VID_0403/FTDIBUS without a COM port, the message says the adapter is present but has no COMx.
- Window close is allowed immediately when idle. The close handler is synchronous unless a monitor is running; a failed confirm dialog cannot trap the window.

## Verification boundary

- The LiveGraph wrap-up passed frontend lint, all 34 Vitest cases, and the production frontend build on August 13, 2026.
- Frontend lint/tests/build and Rust formatting/tests/clippy succeeded on August 12, 2026: 25 Vitest tests and 35 Rust tests passed.
- A duplicate desktop launch was not forced because this workspace already had its Vite server on port 5173 and `accuenergy-metering.exe` running; the existing owner processes were left untouched. The prior full Tauri launch remains the desktop verification boundary.
- Windows reported no attached serial ports during verification. No live Modbus, meter response, real sample stream, or hardware-generated report is claimed.
- Abrupt process termination or power loss can temporarily leave the latest session marked `running`; committed WAL readings remain available and the next idle desktop initialization finalizes the orphan. Normal UI close is intercepted and waits for the implemented stop/finalize path.
- Team install root is `S:\Engineering\Public\Syed_Hassaan_Shah\Accuenergy_Metering_V2\`. Current signed installer is 0.1.1 (close-while-idle fix + Detect driver hint). The sibling `Accuenergy_Metering\` folder stays the legacy Python drop; FTDI VCP drivers live under the V2 share `drivers\FTDI_VCP\`.
