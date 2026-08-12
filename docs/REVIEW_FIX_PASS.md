# Review-fix pass — Accuenergy Metering V2

**Status:** implemented (software complete; hardware unverified)
**Date:** 2026-08-12
**Source review:** independent code review of `2c0ab8e` plus local lab artifacts
**Owner intent:** Fix every review finding and the recommended robustness items. Do not redesign the product.

**Hand to implementor:** read this file end-to-end and implement it. Do not ask the owner questions. Decide from the defaults below, implement in the slice order, commit after each slice, leave the tree buildable.

**App:** `C:\Projects\Active\Accuenergy_Metering`
**Legacy reference (read-only):** `C:\Projects\Active\Accuenergy_Metering_Legacy`
**Full legacy + restore tool (read-only):** `C:\Projects\Active\Accuenergy_Metering_Legacy_2`
**UI reference only:** `C:\Projects\Active\Inventory_Management`
**Decisions log:** `docs/DECISIONS.md`

---

## Unattended rules (non-negotiable)

### Do

- Implement **every in-scope slice** in this file. If two approaches are valid, pick the **Default** in the table below and record it in `docs/DECISIONS.md`.
- Keep diffs **minimal and local**. Match existing naming, serde camelCase/snake_case splits, Inventory-style UI, and current file layout.
- Add or extend **automated tests** for every backend behavior change and every controller behavior change that already has a Vitest file.
- After each slice: run the relevant tests. After the last slice: run the full verification block.
- Commit locally after each completed slice with a clear message. Stay on version **0.1.0**.
- If hardware is unavailable: finish the software and tests anyway. Do **not** claim live Modbus from this pass.
- End with a handoff: what changed, tests run, what was not hardware-verified, leftover risks.

### Do not

- Do not ask the owner questions or wait for approval.
- Do not rewrite the monitor loop, replace uPlot, switch to FeOx, add multi-meter sessions, add Ethernet, or start a signed NSIS / S-drive release.
- Do not change the Acuvim register map, float endianness, sample-vs-error rules, or the restore block (`0x0FFE` × 5, FC03 read / FC10 write, password preserved).
- Do not modify `Accuenergy_Metering_Legacy` or `Accuenergy_Metering_Legacy_2`.
- Do not silently swallow settings/load errors after this pass.
- Do not invent extra Modbus registers or an auto ID/baud scan.
- Do not push to GitHub unless `git push` already works with no prompts; local commits are enough.
- Do not run a long live monitor or write meter communication registers unless you are doing a short read-only smoke and can restore nothing. Prefer **not** touching the bus. Tests must not require a meter.

### Default decisions (use these)

| Ambiguity | Default |
|-----------|---------|
| Missing `settings.json` | Still create/use lab defaults (COM5, device 1, 19200 8N1). That path is OK. |
| Present but unreadable / invalid JSON / failed validation | **Error**. Do not fall back to COM5/device 1. |
| Settings write | Same-directory temp file, then replace. See slice 1. |
| Theme toggle while monitoring | Still allowed, but it must use the atomic save. Do not disable theme. |
| Orphan `running` session on next launch | Auto-finalize if no monitor thread is alive. Do not delete readings. |
| Orphan sample/error counts | `sample_count` = actual reading rows; keep stored `error_count` if present, else 0. |
| Orphan stop reason / status | `status = "stopped"`, `stop_reason = "Process exited unexpectedly"`. |
| Double Start | Ignore the second click. If the backend is already running, stay in `running` and show a warning — never flip to `error`. |
| Failed connect (no DB row) | Do not keep that session id as “current”. Report/CSV must not silently open some other session. |
| `test_rs485` vs monitor/configure | Backend rejects. Same exclusive activity lock as configure. |
| Session-list Report/CSV | Same finalized rules as Review. |
| Unparseable session `config_json` | Show review with `configAvailable: false`. Do not pretend lab defaults were the run settings. |
| 3 visible graphs | Top graph full width; bottom row two tiles. 1 / 2 / 4 stay as now. |
| App text log | Append-only `%LOCALAPPDATA%\com.accuenergy.metering\logs\app.log`, rotate at 5 MB. |
| Graph x-axis clipping | Inspect first. Change padding only if labels are still clipped. |
| Version | Stay `0.1.0`. |

---

## Current product (do not regress)

Software is already past Phase 0. Treat it as a working desktop app.

| Piece | Path | Must keep |
|-------|------|-----------|
| Monitor worker | `backend/src/monitor/mod.rs` | One session, stop token between registers, sample-if-any / error-if-none, thresholds 1/5/10/every 25, `run_hours=0`, `sample_hz=0` |
| Serial / probe | `backend/src/meter_io.rs` | Sequential 2-register FC03, BE float32, reject non-finite |
| Restore meter | `backend/src/meter_config.rs` | `0x0FFE`×5, password preserved, verify ignores password echo, settings saved only after verify |
| Storage | `backend/src/storage/mod.rs` | WAL, batch flush, `require_finalized_session` for report/CSV/review |
| Reports | `backend/src/report/mod.rs` | Self-contained HTML, sample std (`n-1`), CSV with session metadata |
| Review | `backend/src/review.rs` | 12k downsample, CSV named columns, no SQLite write on import |
| Controller | `frontend/src/features/live/useMeterController.ts` | Desktop vs browser split, review overlay, close-while-running confirm |
| Shell | `frontend/src/shell/MeterShell.tsx` | Toolbar, tiled graphs, log panel pref |

**Known good lab artifacts (already on this PC, do not delete):**

- `%LOCALAPPDATA%\com.accuenergy.metering\settings.json` — COM3, 19200, device 1
- `meter_log.db` — 4 finalized sessions, 1242 readings, 0 errors
- Do not wipe this directory in tests. Use `tempfile` / temp dirs only.

---

## Files you will touch

Expected set. Do not create parallel modules unless a file becomes unreadable.

| File | Why |
|------|-----|
| `backend/src/domain/config.rs` | Atomic save; keep missing-file defaults; keep error on bad JSON |
| `backend/src/api/mod.rs` | Stop swallowing load errors; lock probe; recover orphans; optional log path |
| `backend/src/monitor/mod.rs` | Optional: append monitor logs to file; do not change loop semantics |
| `backend/src/storage/mod.rs` | Orphan recovery; honest `config_json` parse |
| `backend/src/review.rs` | `config_available` false when session config missing/invalid |
| `backend/src/paths.rs` | `logs` directory |
| `backend/src/lib.rs` | Only if a new command is required |
| `frontend/src/features/live/useMeterController.ts` | Start guard, failed-connect cleanup, report target selection, desktop init |
| `frontend/src/features/live/useMeterController.test.ts` | Cover start race, ghost session, report fallback |
| `frontend/src/shell/MeterShell.tsx` | Session actions, running chip, 3-graph layout |
| `frontend/src/features/live/LiveGraph.tsx` | Axis padding only if still clipped |
| `AGENTS.md` | Current phase is wrong |
| `docs/PORT_PLAN.md` | IPC table missing new commands |
| `docs/DECISIONS.md` | Log this pass |
| `README.md` | One short paragraph if settings/orphan behavior changes |

No new chart library. No new settings fields unless the log path stays internal.

---

## Slice order

Implement in this order. Commit after each slice that has tests passing.

1. Settings integrity (atomic write + no silent default)
2. Orphan `running` session recovery
3. Start-button / failed-connect lifecycle
4. Exclusive serial lock for Test RS485
5. Session-list + report target honesty
6. Review `config_available` honesty
7. UI polish (running chip, 3-graph layout, graph axis check)
8. Append-only app log
9. Docs (`AGENTS.md`, `PORT_PLAN.md`, `DECISIONS.md`, README if needed)
10. Full verification + handoff

---

## Slice 1 — Settings integrity

### Bug

`AppConfig::load` correctly errors on invalid JSON / failed validation. Callers throw that away:

```23:28:backend/src/api/mod.rs
pub fn get_config(app: AppHandle) -> Result<AppConfig, String> {
    let paths = AppPaths::resolve(&app)?;
    match AppConfig::load(&paths.settings) {
        Ok(config) => Ok(config),
        Err(_) => Ok(AppConfig::default()),
    }
}
```

`test_rs485` and `start_monitor` use `.unwrap_or_default()`. On a dual-meter bus that silently becomes COM5 / device 1.

`save` uses `fs::write`, which truncates first. A crash mid-write produces the corrupt file that triggers the silent default.

Missing file → defaults is **correct** and must stay.

### Backend

**`AppConfig::save`**

1. Normalize/validate first (already does).
2. `create_dir_all` on the parent.
3. Write to `settings.json.tmp` in the **same directory** as `settings.json`.
4. Replace `settings.json` with the temp file.
5. On Windows, `rename` cannot overwrite. Pattern:

```rust
let tmp = path.with_file_name("settings.json.tmp");
fs::write(&tmp, payload).map_err(...)?;
if path.exists() {
    fs::remove_file(path).map_err(...)?;
}
fs::rename(&tmp, path).map_err(...)?;
```

If rename fails after remove, return an error that says settings were not saved and a temp file may remain. Do not leave a truncated `settings.json`.

**`get_config` / `test_rs485` / `start_monitor`**

```rust
let config = AppConfig::load(&paths.settings)?.normalized()?;
```

`load` already returns `Ok(default)` when the file does not exist. Do **not** add another default on `Err`.

`preview_meter_defaults` / `apply_meter_defaults` already use `load()?` — keep that.

### Frontend

Desktop init in `useMeterController` already `try/catch`es `getConfig()`. If it fails:

- Show an error notice: settings file is invalid; fix or overwrite from Settings.
- Do **not** pretend the in-memory lab defaults are the saved file.
- Settings dialog Save must still be able to write a new valid file (`save_config` overwrites).
- Keep browser-mode localStorage defaults unchanged.

Theme toggle already calls `saveConfig`. After slice 1 that write is atomic. Leave the toggle enabled while running.

### Tests (Rust)

Add in `backend/src/domain/config.rs` (temp dir):

1. Missing file → `load` returns defaults.
2. Valid file → `load` returns saved port/device.
3. Truncated / invalid JSON → `load` returns `Err` containing `invalid JSON` (or the existing wording).
4. Valid JSON but `deviceId` 0 / 248 → `Err` containing the validation message.
5. `save` then `load` round-trip.
6. After `save`, `settings.json` exists and `settings.json.tmp` does not.

Do **not** change existing validation tests except to call the new save path.

### Acceptance

- [x] Corrupt `settings.json` cannot start a monitor or probe as COM5/device 1.
- [x] First run with no file still uses lab defaults.
- [x] Save is not a single truncate-in-place write.
- [x] Desktop UI shows the real load error.

---

## Slice 2 — Recover orphaned `running` sessions

### Bug

If the process is killed, the latest session stays `running` with `ended_at` null. Readings in WAL are kept. `require_finalized_session` then blocks Review / Report / CSV. Session list disables Review but still offers Report/CSV (fixed in slice 5). There is no recover path.

Documented in `docs/DECISIONS.md`; still must be fixed before overnight use.

### Behavior

Add `storage::recover_orphaned_sessions(database: &Path) -> Result<Vec<String>, String>`:

1. Open the DB with existing `connect`.
2. Select sessions where `status = 'running'` OR `ended_at IS NULL`.
3. For each:
   - Count rows in `readings` for that `session_id`.
   - `ended_at = now` (local RFC3339, same as `finalize_session`).
   - `status = 'stopped'`.
   - `stop_reason = 'Process exited unexpectedly'`.
   - `sample_count = reading row count`.
   - Leave `error_count` as stored.
   - Leave `report_path` and `config_json` alone.
4. Return the recovered session ids (may be empty).

**When to run**

Do **not** recover while `MonitorManager` has an active session.

Add `api::recover_orphaned_sessions(app, manager) -> Result<Vec<String>, String>`:

```text
if manager.state()?.running { return Ok(vec![]); }
storage::recover_orphaned_sessions(&paths.database)
```

Call it from desktop init **after** `getMonitorState()`:

- If `monitorState.running` → skip (reattach path stays as it is).
- Else → `recoverOrphanedSessions()`.
- If any ids returned → log `Recovered N leftover session(s): …` and refresh the session list.

Also call recover at the start of `list_sessions` only if you can see the manager and it is not running. Prefer the explicit command + frontend init so `list_sessions` stays a read. **Default: explicit command + init call. Do not hide writes inside `list_sessions`.**

Register the command in `backend/src/lib.rs` and wrap it in `meterBridge.ts`.

### Tests (Rust)

In `storage` tests with tempfile:

1. Create `running` session, flush 3 readings, drop connection (no finalize).
   `recover_orphaned_sessions` → one id.
   `get_session` → `stopped`, `ended_at` set, `stop_reason` as above, `sample_count == 3`.
   `load_readings` still 3 rows.
   `require_finalized_session` now succeeds.

2. Already finalized session is left unchanged.

3. Running session with 0 readings still gets finalized (`sample_count = 0`). Review/report will still say “no readings”; that is correct.

Optional monitor-manager test: if you can construct a manager with an active flag, recover API returns empty. If that is awkward without spawning a thread, skip the API test and keep the storage test.

### Frontend

Bridge + init only. No new dialog. A log line and optional success notice if `ids.length > 0`.

### Acceptance

- [x] After a simulated crash (running row + readings), one app start makes the session reviewable and exportable.
- [x] Live monitor is never finalized by recover.
- [x] Readings are never deleted.

---

## Slice 3 — Start lifecycle (double Start + ghost session)

### Bugs

1. `start()` does not check `runningRef`. Two clicks before re-render: first `start_monitor` succeeds, second fails “already running”, catch sets `status = "error"`. Stop is only enabled for `connecting | running | stopping`. Until the first `live-update`, the operator cannot Stop.

2. `start_monitor` returns a session id **before** connect. Connect failure never inserts a row, but the UI keeps that id. `openReport` then does `sessions.find(current) ?? sessions[0]` and can generate the **previous** session’s report.

### Controller changes (`useMeterController.ts`)

**Start**

```text
if (review) → existing warning, return
if (runtime === browser) → demo start, return
if (runtime !== desktop) return
if (runningRef.current || status === "connecting" || status === "running" || status === "stopping") {
  showNotice warning "Monitoring is already active"
  return
}
```

Use a `startingRef` set true before `await startMonitor()` and cleared in `finally`, so a second click during the invoke is ignored even before React paints.

On `startMonitor` **success**: keep today’s `connecting` + `currentSessionId` behavior.

On `startMonitor` **failure**:

```text
const state = await getMonitorState()  // if this throws, then set error
if (state.running) {
  setStatus("running")
  setCurrentSessionId(state.sessionId)
  showNotice warning with the original error (already running)
  return
}
setStatus("error")
// existing log + error notice
```

Do **not** clear an actually running backend just because the second invoke failed.

**Failed connect / `monitor-failed`**

In the `monitor-failed` listener:

- If `payload.kind === "connection"`: `setCurrentSessionId(null)` unless `getMonitorState()` says that session is running (it will not be).
- Keep `status = "error"`, existing notice, `refreshSessions()`.

**Report / CSV target**

`openReport` when idle:

```text
const target =
  review?.session
  ?? sessions.find(s => s.sessionId === currentSessionId && s.endedAt && s.status !== "running")
  ?? null
if (!target) {
  showNotice warning "No finalized session selected"
  return
}
```

Do **not** fall back to `sessions[0]`.

`exportCurrentCsv` already prefers finalized + samples. Keep that. Do not use a ghost id.

### Tests (Vitest)

Extend `useMeterController.test.ts`:

1. Two overlapping `start()` calls: `startMonitor` mocked to resolve once and reject once (or second reject “already running”). `getMonitorState` returns `{ running: true, sessionId }`. Final status is not `error`. `startMonitor` called twice is OK; UI must remain stoppable (`isRunning === true`).

2. `startMonitor` rejects and `getMonitorState` returns `{ running: false }`. Status becomes `error`.

3. Emit `monitor-failed` `{ kind: "connection", sessionId: "run_ghost", message: "..." }`. `currentSessionId` is not `run_ghost`.

4. Idle controller with `currentSessionId` set to a missing id and `sessions = [olderFinalized]`. `openReport()` does **not** call `generateReport` with the older id. Notice warns.

Keep existing pending-report tests passing. Update them if they relied on `sessions[0]` fallback.

### Acceptance

- [x] Double Start cannot disable Stop.
- [x] Failed connect does not make Generate Report open another run.
- [x] Browser demo start unchanged.

---

## Slice 4 — Exclusive serial lock for Test RS485

### Bug

`preview_meter_defaults` / `apply_meter_defaults` take `begin_meter_configuration()`. `start_monitor` rejects configure + existing monitor. `test_rs485` does neither. UI disables Test while busy; the command does not.

### Backend

`test_rs485` must:

1. `let guard = manager.begin_meter_configuration()?;`
   or a renamed shared helper (`begin_serial_exclusive`) used by configure **and** probe.
   **Default:** reuse `begin_meter_configuration`. Do not add a second flag unless reuse is messy. Update the error strings so probe failures do not say “configuration” if that would confuse the operator. Prefer one generic message:

   - Monitor running → `Stop the active monitoring session {id} before using the serial port.`
   - Other exclusive op → `Another serial operation is already in progress.`

2. Hold the guard across the `spawn_blocking` probe, same as preview/apply (`move || { let _guard = guard; probe(...) }`).

3. `start_monitor` already refuses `meter_configuration` — that now also covers an in-flight Test.

Frontend already disables Test while `isRunning` / `controlsBusy`. Keep that.

### Tests (Rust)

`meter_configuration_guard_is_exclusive_and_releases` already exists. Add:

1. After `begin_meter_configuration()`, `start()` returns the existing “configuration in progress” / new generic error.
   (Manager unit test, no serial hardware.)

2. Optional: if you extract the error strings, assert probe-style wording.

You cannot unit-test a real COM lock without hardware. Do not add a live COM test.

### Acceptance

- [x] Backend rejects Test while monitor is marked running (manager path).
- [x] Backend rejects Start while a configuration/probe guard is held.
- [x] Dropping the guard allows the next operation.

---

## Slice 5 — Session list and report honesty

### Session list (`MeterShell.tsx` `SessionList`)

Review button already requires `status !== "running" && endedAt !== null && sampleCount > 0`.

Report and CSV must use the same finalized predicate:

```ts
const finalized =
  session.status !== "running" &&
  session.endedAt !== null &&
  session.sampleCount > 0;
```

Disable Report and CSV when `!finalized`. Keep the existing `reporting` / `exportingSessionId` disables.

Toolbar **Generate Report** / **Export CSV** use the controller helpers from slice 3 (no silent `sessions[0]`).

### Running chip

Today only `status === "error"` is red; `running` is green. Change:

| Status | Chip |
|--------|------|
| `error` | existing destructive |
| `running` | warning / muted primary (not success) |
| `stopped` / `completed` | success |
| other | muted |

### Acceptance

- [x] A `running` row cannot start Report or CSV from the list.
- [x] After recover (slice 2) the same row becomes enabled.
- [x] Running is not shown as a green success chip.

---

## Slice 6 — Honest session config in review

### Bug

```279:281:backend/src/storage/mod.rs
let config_json: String = row.get(8)?;
let config = serde_json::from_str(&config_json).unwrap_or_default();
```

`load_session` then sets `config_available: true` always. A corrupt `config_json` is displayed as COM5 / device 1.

### Storage

Change `SessionRecord` **or** `row_to_session` so a parse failure is visible.

**Default:** keep `SessionRecord.config: AppConfig` for valid rows, and add:

```rust
pub config_available: bool,
```

- Parse OK (after `normalized()` if you already persist normalized JSON) → `config` = parsed, `config_available = true`.
- Parse fail / empty `{}` that cannot fill required fields → `config` = `AppConfig::default()`, `config_available = false`.

`AppConfig` has no `#[serde(default)]` on fields; `{}` already fails parse. Good.

CSV import already sets `config_available` from whether `config_json` was present. Keep that. If present but invalid, keep the existing hard error (`CSV config_json is invalid`). That is the right contrast: file import should fail; old DB rows should still be reviewable.

### Review

`load_session` must pass through `session.config_available`, not force `true`.

### Frontend

Banner already has:

```ts
controller.review.configAvailable
  ? configSummary(controller.review.session.config)
  : "Settings metadata unavailable"
```

Keep it. Type `SessionRecord` in `types.ts` needs `configAvailable: boolean` if you put the flag on the session. **Default:** put the flag on `ReviewDataset` only (already exists) and on `SessionRecord` only if the list UI needs it. List UI does not need it. So:

- Add `config_available` on `SessionRecord` in Rust **or** only set `ReviewDataset.config_available` from parse success.
- **Default:** set it on `ReviewDataset` from parse success; add an optional `configAvailable` on `SessionRecord` if serde wants one source of truth. Simplest: compute in `load_session` by attempting parse in `row_to_session` and storing a bool next to config.

Wire serde `camelCase` (`configAvailable`).

### Tests

1. Finalize a session with valid `config_json` → review `config_available == true`, port matches.
2. Manually `UPDATE sessions SET config_json = 'not-json'` → `load_session` succeeds, `config_available == false`, readings still load.
3. Existing CSV import tests still pass.

### Acceptance

- [x] Bad DB config never appears as a real COM5/device 1 run.
- [x] Graphs/values still load.

---

## Slice 7 — UI polish

### 3-graph layout (`MeterShell.tsx`)

Current: `graphCards.length === 1 ? "grid-cols-1" : "grid-cols-2"`. Three groups leave a half-empty second row.

Required:

| Visible groups | Layout |
|----------------|--------|
| 1 | one full tile |
| 2 | two columns, one row |
| 3 | row 1: first group full width; row 2: two columns |
| 4 | 2×2 |

Keep “no scroll in the graph region”. Keep at least one group selected (already implemented).

Implementation hint: do not force a uniform `grid-cols-2` for 3. Either split the third tile out or use `gridColumn: span 2` on the first tile when `length === 3`.

### Graph x-axis (`LiveGraph.tsx`)

Already has `padding: [4, 8, 12, 4]` and x-axis `size: 38`. If you can launch `bun run desktop` or `bun run dev:frontend`, look at 1-graph and 4-graph, light and dark.

- If timestamps are fully visible → **do not change**.
- If clipped → increase x-axis `size` / bottom padding slightly (try `size: 44`, padding bottom `16`) and re-check. Do not change chart library.

If you cannot launch a window, leave the graph code alone and say so in the handoff.

### Acceptance

- [x] Three groups do not sit as one leftover half-tile without a full-width top plot.
- [x] One / two / four layouts still fill the fixed graph region.
- [x] Axis change only if you observed clipping.

---

## Slice 8 — Append-only app log

Deferred in DECISIONS; include it now. Keep it small.

### Paths

`AppPaths` gains `logs: root.join("logs")` and `log_file: logs.join("app.log")`. Create `logs/` in `from_root` like `reports/` and `exports/`.

### Write policy

Helper `fn append_app_log(path: &Path, message: &str)`:

- Timestamp local, one line: `YYYY-MM-DD HH:MM:SS  message`
- Create parent dirs.
- If `app.log` exists and is **> 5 MB**, rename to `app.log.1` (replace previous `.1`) then start a new `app.log`.
- Best-effort: log write failures must **not** fail the monitor loop. Use `let _ = append_app_log(...)`.

### What to log

From the backend, at least:

- Monitor connect / start / finish / fail (same strings as `emit_log` is fine — call append next to `emit_log`).
- Recovered orphan session ids.
- Settings save errors are already returned to the UI; also append them if easy.
- Meter configure pass/fail summaries (the existing `[PASS]/[FAIL]` text).

Do not duplicate every `live-update`. Do not add a log viewer UI. Opening **App Data** already lets the operator find `logs\app.log`.

### Tests

Temp-dir unit test: write two lines, file contains both, order preserved. Optional: write enough to exceed a tiny threshold if you parameterize the rotate size for tests (e.g. `append_app_log_with_limit(..., 64)`). Do not depend on a 5 MB write in CI.

### Acceptance

- [x] After a monitor start/stop in software tests or a desktop smoke, `logs/app.log` exists when the backend ran.
- [x] Monitor still succeeds if the log file is read-only / missing parent that cannot be created (ignore IO errors).

---

## Slice 9 — Docs

### `AGENTS.md`

Replace “Current phase / Phase 0 scaffold / stubs” with the truth:

- Software port is feature-complete for the legacy workflow plus review/CSV/restore.
- Live Modbus must not be claimed in a session that did not smoke-test COM.
- Local data **is** `%LOCALAPPDATA%\com.accuenergy.metering\` (not “planned”).
- Stack line: SQLite and serialport are implemented, not planned.
- Point at `docs/DECISIONS.md` and this file.

Keep commands, identity, register-map pointer, release note (unique updater key).

### `docs/PORT_PLAN.md`

Update the IPC table to include:

| Command | Notes |
|---------|--------|
| `preview_meter_defaults` | Dry-run read `0x0FFE`×5 |
| `apply_meter_defaults` | Isolated + write FC10 + verify + save settings |
| `load_session_review` | Finalized session, downsampled |
| `load_csv_review` | Export-format CSV, read-only |
| `recover_orphaned_sessions` | Finalize leftover `running` rows if monitor is not alive |

Update the “10 Rust tests” line to whatever `cargo test` reports after this pass.

### `docs/DECISIONS.md`

Add a short “Review-fix pass (2026-08-12)” section: atomic settings, no silent default, orphan recover, exclusive probe lock, app log path, report no longer falls back to `sessions[0]`.

### `README.md`

If the uncommitted FTDI driver section is still only in the working tree, keep it (it is correct). Add one sentence under App data:

- Invalid `settings.json` is an error, not a silent reset to COM5.
- Leftover `running` sessions are finalized on next launch if the monitor is not active.

### This file

Tick the acceptance checkboxes as you complete slices.

---

## Out of scope (do not do)

- Signed NSIS, updater keypair, S-drive staging
- 24-hour soak, loaded-meter vs front-panel compare (owner lab)
- Auto ID/baud scan
- Multi-session overlay charts
- Persistent log **viewer** in the UI
- Changing decode, register map, or restore semantics
- Wiping `%LOCALAPPDATA%\com.accuenergy.metering\`
- “Mark abandoned” confirmation dialog — auto-recover is the default

---

## Tests you must add (checklist)

| Area | Minimum new coverage |
|------|----------------------|
| Settings | missing / valid / bad JSON / bad device id / save round-trip / tmp cleaned up |
| Orphans | running+readings recovered; finalized untouched; zero-reading running finalized |
| Controller | double start stays running; start fail when backend idle → error; connection-fail clears ghost id; report does not use `sessions[0]` |
| Review config | bad `config_json` → `configAvailable` false |
| App log | append two lines (and rotate if you parameterize the limit) |
| Existing | all previous Rust + Vitest cases still pass |

Do not add tests that open a real COM port.

---

## Verification (required before claiming done)

From `C:\Projects\Active\Accuenergy_Metering`:

```powershell
bun run lint
bun run test
bun run build:frontend
cd backend
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
```

Optional if a desktop window is easy and will not steal the owner’s session for long:

```powershell
bun run desktop
```

Then only: launch, confirm Settings load (COM3 if that file is valid), confirm session list shows the four historical runs, open Review on one, Exit review. **Do not** Apply meter defaults. **Do not** Start a long run.

If desktop launch is flaky, skip it and say so.

---

## Implementation notes (so you do not “fix” the wrong thing)

- `MeterValues` serde is **snake_case** on purpose (`frequency_hz`). LiveUpdate wrappers are camelCase. Do not “fix” that.
- `any_value()` treats `Some(0.0)` as a valid sample. Lab data is often 0 Hz / 0 V / PF 1. Do not treat 0 as a miss.
- `start_monitor` returning an id before connect is OK if the UI does not treat that id as a finalized session.
- `open_path` must stay rooted under the app-data directory.
- Prefer Inventory button/card/notice patterns. No new design system.
- `catch_unwind` on the monitor thread stays.

---

## Handoff template (write this when finished)

```text
## Review-fix pass handoff

- Commits: <list>
- Slices completed: 1–9 yes/no
- Verification: lint/test/build/fmt/test/clippy pass/fail (paste summary)
- Desktop smoke: done / skipped (why)
- Hardware: not claimed
- Settings: atomic save + load errors surface?
- Orphans: recover command + init wired?
- Start race / ghost session: tests added?
- Probe lock: reuse configure guard?
- Docs updated: AGENTS, PORT_PLAN, DECISIONS
- Risks left:
```

---

## Short paste prompt for the implementor

```
Read and implement C:\Projects\Active\Accuenergy_Metering\docs\REVIEW_FIX_PASS.md completely, unattended.

Work only in C:\Projects\Active\Accuenergy_Metering. Follow the slice order. Do not ask questions. Use the Default decisions table. Do not rewrite the monitor, replace uPlot, touch legacy folders, or claim live Modbus.

After each slice run the relevant tests and commit. At the end run bun run lint, bun run test, bun run build:frontend, and in backend: cargo fmt --check, cargo test, cargo clippy --all-targets -- -D warnings.

Update AGENTS.md, docs/PORT_PLAN.md, and docs/DECISIONS.md as specified. Finish with the handoff template in the doc. Start now at slice 1.
```
