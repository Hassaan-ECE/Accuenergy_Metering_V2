# Implementation decisions

**Date:** August 11, 2026  
**Version:** 0.1.0

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
- Store settings, database, reports, and exports under `%LOCALAPPDATA%\com.accuenergy.metering\`.
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

## Verification boundary

- `bun install`, frontend lint/tests/build, Rust formatting/tests, and a full Tauri dev launch succeeded on August 11, 2026.
- Windows reported no attached serial ports during verification. No live Modbus, meter response, real sample stream, or hardware-generated report is claimed.
- Abrupt process termination or power loss can leave the latest session marked `running`; committed WAL readings remain available. Normal UI close is intercepted and waits for the implemented stop/finalize path.
- Persistent text-file logging, signed installer publication, and S-drive staging are intentionally deferred; they are not required for the 0.1.0 parity target.
