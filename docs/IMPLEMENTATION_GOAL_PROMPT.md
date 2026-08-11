# Implementation goal prompt — Accuenergy Metering V2

**Paste this entire document into a new agent chat** (or hand it to the implementer) to complete the port to functional parity with the Python app — and beyond where noted.

---

## Goal (one sentence)

Finish **Accuenergy Metering V2** so it is **at least as functional as the legacy Python/PySide6 app**, with a **snappier UI/UX** (Inventory Management–quality shell, real-time graphs), using **Rust + Tauri 2 + Bun/React** — without claiming hardware features work until they are smoke-tested on a real meter.

---

## Unattended overnight run (critical)

The **owner will not be available** during this run. They will review the result **after** the build is complete and only then request modifications.

### Do

- **Drive to full parity end-to-end** without waiting for human input. Treat this prompt + legacy code + docs as the full decision authority.
- **Make reasonable product/engineering choices yourself** when something is ambiguous (crate versions, exact UI layout details, event payload field names as long as the contract is met, report chart styling, file paths under app data, etc.).
- **Prefer the legacy Python behavior** when choosing between two valid options.
- **Prefer Inventory Management UI patterns** for visual/UX choices.
- **Log decisions** in `docs/DECISIONS.md` (create if missing) or a short “Decisions made” section at the end of your final summary — so the owner can reverse anything later.
- If blocked by missing hardware: **still finish the software**, add mock/demo paths + unit tests, document “not hardware-verified,” and continue to the next slice. Do **not** stop and wait.
- If blocked by a tooling failure: try a practical alternative, note it, and keep going. Only stop if the workspace is unusable (e.g. no Rust/Bun at all).
- Leave the tree **buildable** (`bun run build:frontend`, `cargo test`, preferably `bun run desktop` smoke if possible).
- End with a **handoff summary**: what was implemented, parity checklist status, what was verified, open risks, and where to look to change decisions.

### Do not

- **Do not ask the owner questions** and wait for answers (no “which option do you prefer?”, no multi-choice confirmations, no “shall I proceed?”).
- **Do not pause mid-plan** for approval of intermediate designs.
- **Do not** leave the project half-finished because a preference was unclear — pick the legacy-compatible default and document it.
- **Do not** require interactive secrets, S-drive deploy, or signed release unless already trivial; skip release/signing unless the full app is done and signing keys are already present without a passphrase prompt.

### Default decisions (use these; do not ask)

| Ambiguity | Default |
|-----------|---------|
| Config/DB location | `%LOCALAPPDATA%\com.accuenergy.metering\` (`settings.json`, `meter_log.db`, `reports/`) |
| Modbus crates | `serialport` + a maintained RTU client (`tokio-modbus` or solid sync RTU); match legacy sequential 2-register reads |
| Demo mode | Keep for browser-only; desktop uses real backend when `ping` works |
| Graph beyond frequency | Multi-series or tabs if time allows; frequency graph is mandatory |
| Report charts | HTML with embedded SVG or static chart images — no hard dependency on Python/matplotlib |
| Theme | Light/dark like Inventory; persist in settings + localStorage |
| Commit/push to GitHub | **Do commit locally** with clear messages when milestones land; **push to `origin`** if credentials work, otherwise leave commits local and note “not pushed” |
| Version bump | Stay on `0.1.0` until parity works, or bump patch only if you need a clean desktop title; keep triple in sync |
| Beyond-Python extras | Implement if they fit after parity (CSV, session list, multi-series); never block parity for extras |

---

## Workspaces (do not invent paths)

| Path | Role |
|------|------|
| `C:\Projects\Active\Accuenergy_Metering` | **Active V2 app** — implement here |
| `C:\Projects\Active\Accuenergy_Metering_Legacy` | **Read-only** Python reference (behavioral source of truth) |
| `C:\Projects\Active\Inventory_Management` | **UI/UX and release conventions** only (not domain) |
| GitHub V2 | https://github.com/Hassaan-ECE/Accuenergy_Metering_V2.git |
| GitHub legacy | https://github.com/Hassaan-ECE/Accuenergy_Metering.git |

**Read first (in order):**

1. `docs/LEGACY_ANALYSIS.md` — full behavior of the old app  
2. `docs/PORT_PLAN.md` — architecture and phases  
3. `AGENTS.md` — identity, stack, commands  
4. Legacy sources: `Code/core/{meter,monitor,database,report,config}.py`, `Code/gui/main_window.py`  

**Do not** modify the legacy folder except to read it. **Do not** put source on S-drive.

---

## What “done” means (parity checklist)

The V2 app must support everything the Python app does today, end-to-end on Windows desktop:

### Connection & diagnostics

- [ ] Enumerate serial COM ports from the OS  
- [ ] Settings for: port, baud, device ID, parity (N/E/O), stop bits, sample rate Hz, run hours, commit-every, timeout, retries  
- [ ] Persist settings across restarts  
- [ ] **Test RS485**: one-shot read of the full Acuvim basic register set; clear pass/fail in UI + detailed log  
- [ ] Lab-proven defaults remain available: **COM5, device 1, 19200 8N1, sample 1 Hz, run 24 h** (sample Hz `0` = as fast as hardware allows; run hours `0` = until stopped)

### Monitoring session

- [ ] **Start** opens a long-lived Modbus RTU connection and logs samples  
- [ ] **Stop** cleanly ends the run (after current read), flushes DB, finalizes session  
- [ ] Auto-stop when run duration is reached (`completed`)  
- [ ] Session ID format comparable to legacy (`run_YYYYMMDD_HHMMSS_…`)  
- [ ] Sample counting: a sample counts only if **any** metric decoded successfully; total miss increments error count and does **not** insert a reading row  
- [ ] Consecutive error logging (first error, then 5, 10, every 25) + “communication restored”  
- [ ] Only one active monitor session at a time  
- [ ] Closing the window while running: confirm, stop, wait reasonably, then exit  

### Live UI (must feel better than Python)

- [ ] Live metric cards: at minimum Frequency, V1, I1, P1, Samples, Sample rate (effective Hz), Errors, Status — preferably **all 10** basic metrics visible or one click away  
- [ ] Live graph of frequency vs time (ring buffer ~1800 points or better); **stretch goal:** multi-series (voltage / current / power) with metric picker  
- [ ] Activity log with timestamps  
- [ ] Session info: last session id, DB path, last report path  
- [ ] Light/dark theme (persist preference)  
- [ ] Disable Start/Test/Settings while running; Stop only while running  
- [ ] UI stays responsive during long runs (monitor work **off** the UI thread; stream via Tauri events)

### Storage

- [ ] SQLite DB (WAL) with `sessions` + `readings` tables equivalent to legacy schema  
- [ ] Batch inserts every `commit_every` samples  
- [ ] Config snapshot stored with each session (`config_json`)  
- [ ] App data under `%LOCALAPPDATA%\com.accuenergy.metering\` (settings + DB); optionally allow opening Data/Output-style folders for lab familiarity  

### Reports & export

- [ ] Generate **self-contained HTML report** for a session: header/device, sample/error counts, config summary, latest values, n/mean/min/max/std per metric, trend charts (voltage, current, frequency/power/PF)  
- [ ] Open report in default browser / OS handler  
- [ ] Open data / output (or app-data) folders from UI  
- [ ] **Beyond Python:** CSV export of a session’s readings  

### Packaging / quality

- [ ] `bun run desktop` runs the full app  
- [ ] `bun run build:frontend` and `cargo test` pass  
- [ ] Rust unit tests for float decode (and config validation)  
- [ ] No claim of Modbus success without live hardware smoke when a meter is available; if no meter, document demo mode and what was verified  

**Beyond-Python improvements (required if low cost, else note as follow-up):**

1. Multi-series live graphs + metric selector  
2. Session list / re-open last reports  
3. CSV export  
4. Structured connection errors (not only raw stack traces)  
5. Port dropdown from live enumeration  

**Explicitly out of scope unless the owner asks:** multi-meter simultaneous sessions, cloud sync, Ethernet/AXM-WEB2 path, FeOx, Inventory module switcher, signed S-drive release (can be a final optional step).

---

## Non-negotiable technical constraints

### Stack

- Tauri 2, Rust backend, React 19 + TypeScript + Vite + Tailwind v4 + Bun  
- Graphs: **uPlot** (already scaffolded)  
- Storage: **SQLite** via `rusqlite` (bundled) — **not FeOx**  
- Serial/Modbus: real crates (e.g. `serialport` + `tokio-modbus` RTU, or equivalent proven RTU stack)  
- UI look/feel: match **Inventory Management** patterns (DM Sans, CSS tokens, buttons/cards, status strip) — copy style, not inventory domain  

### Protocol / domain (copy from legacy exactly)

Register map (holding registers, **2 regs each**, **big-endian IEEE-754 float**):

| Key | Address | Unit |
|-----|---------|------|
| `frequency_hz` | 0x4000 | Hz |
| `phase_voltage_v1` | 0x4002 | V |
| `phase_voltage_v2` | 0x4004 | V |
| `phase_voltage_v3` | 0x4006 | V |
| `line_voltage_v12` | 0x400A | V |
| `current_i1` | 0x4012 | A |
| `current_i2` | 0x4014 | A |
| `current_i3` | 0x4016 | A |
| `active_power_p1` | 0x401C | W |
| `power_factor_pf1` | 0x4034 | — |

Canonical source of truth: `backend/src/domain/meter.rs` and legacy `Code/core/meter.py`.

- Reads may remain sequential per-pair (like Python) for parity; **do not** invent multi-register block reads unless verified against Accuenergy docs and tested  
- RS485 bus speed is the physical limit — make UI/storage/report path snappy instead  

### IPC contract (implement fully)

**Commands (camelCase JSON where applicable):**

| Command | Behavior |
|---------|----------|
| `ping` | `"pong"` for runtime detection |
| `get_config` / `save_config` | Load/save persisted config; validate on save |
| `list_serial_ports` | Real OS ports |
| `test_rs485` | One-shot basic targets; return human-readable or structured snapshot |
| `start_monitor` / `stop_monitor` | Background session; single-flight |
| `generate_report` | Session id → report file path |
| `list_sessions` / `get_latest_session` | Session browser support |
| `export_session_csv` | Optional stretch |
| `open_path` | Open file/folder via opener plugin |

**Events (AppHandle emit):**

| Event | Payload |
|-------|---------|
| `live-update` | sessionId, timestampMs, values map, sampleCount, errorCount, liveHz, message |
| `monitor-log` | timestamp + message |
| `monitor-finished` | SessionSummary (status, stopReason, counts, times) |
| `monitor-failed` | kind (`connection` \| `runtime`) + message |

Frontend: replace demo stream when Tauri `ping` works; keep **demo mode** for browser-only UI work if useful, clearly labeled.

---

## Current scaffold state (start from here — do not rescaffold)

Already exists:

- Frontend shell: metrics grid, uPlot graph, log, theme toggle, demo stream (`useDemoLiveStream`)  
- `meterBridge.ts` with invoke stubs  
- Rust: `domain/config`, `domain/meter` (decode + unit test), `api/*` **stubs** that return placeholder errors  
- Docs and GitHub remote  

**Implement thin vertical slices** (smallest shippable path first):

1. **Config persist + list ports + settings UI**  
2. **`test_rs485` live path** (smallest real Modbus proof)  
3. **Monitor loop + SQLite + live events** wired to UI (remove demo when desktop)  
4. **HTML report + open paths**  
5. **CSV + session list + multi-series graph** (beyond parity)  
6. Polish: window-close guard, error UX, tests, README update  

---

## Workflow rules (owner standards)

1. **Understand before coding** — restate success criteria; list assumptions **to yourself and in the final handoff**, not as questions to the owner.  
2. **Verify the critical path** — real COM open / real Modbus body when claiming I/O works; not “crate compiles”.  
3. **Evidence before claims** — paste command output / UI behavior for done gates.  
4. **Separate failures:** app bug vs environment (no adapter / wrong COM) vs bad assumption.  
5. **UI changes:** if browser tools exist, exercise Start/Stop/settings/graph; otherwise `bun run desktop` + document what could not be verified.  
6. Keep changes scoped; no drive-by refactors of Inventory or legacy.  
7. Update `docs/PORT_PLAN.md` / `AGENTS.md` / `docs/DECISIONS.md` when reality diverges (paths, crates, verified hardware).  
8. **Unattended mode overrides normal “ask before commit”:** make milestone commits as you go; push if possible. Owner will review the finished tree, not approve each step.

### Verification gates (must run before saying “parity”)

```powershell
cd C:\Projects\Active\Accuenergy_Metering
bun install
bun run build:frontend
bun run test
cd backend; cargo test
# then:
bun run desktop
```

**Hardware gate (when meter available):**  
Test RS485 → Start ~30–60 s → live cards + graph update → Stop → generate report → open HTML → confirm rows in SQLite.

**No meter:** implement fully + unit/integration tests with mocked frames if possible; leave demo mode; **do not** claim live Modbus works.

---

## Identity (stable)

| Item | Value |
|------|--------|
| Product name | Accuenergy Metering |
| Package | `accuenergy-metering` |
| Tauri identifier | `com.accuenergy.metering` |
| Version triple | keep `package.json`, `backend/Cargo.toml`, `backend/tauri.conf.json` in sync when bumping |

Release/signing/S-drive is **optional after functional parity** — if done, use a **new** updater keypair (never reuse Inventory/PDU keys).

---

## Success definition (acceptance)

The owner can uninstall/ignore the Python app for daily lab work because V2 can:

1. Connect to the Acuvim IIW on RS485 with the same defaults  
2. Log a timed or until-stopped session to SQLite  
3. Show live values and a smooth frequency (or multi-metric) graph  
4. Produce an HTML report equivalent to the Python report  
5. Feel faster and cleaner in the UI than the Qt app  

When that is true, mark Phase 1–3 complete in `docs/PORT_PLAN.md` and summarize what was verified with/without hardware.

### Final handoff (required — owner is offline until then)

Write a clear closing report the owner can read in the morning:

1. Parity checklist with ✅ / ⚠️ / ❌  
2. Commands run and results (`build:frontend`, `cargo test`, desktop smoke if any)  
3. Hardware verified or not  
4. Decisions taken (link `docs/DECISIONS.md`)  
5. Known bugs / follow-ups  
6. How to run: `bun install`, `bun run desktop`  
7. Git status: commits made, pushed or not  

Do **not** end with “let me know if you want me to continue” as a blocker — finish the implementation first; optional next steps are fine as a list only.

---

## Suggested first message after pasting this

> Unattended overnight build: do not ask me any questions; decide using this prompt and the legacy app. Implement full functional parity (and better UI) in `C:\Projects\Active\Accuenergy_Metering`. Start Phase 1 then Phase 2 (`test_rs485` then monitor) then reports. Read `docs/LEGACY_ANALYSIS.md` and legacy `monitor.py`/`meter.py` before serial code. Commit as you go; leave a full morning handoff with checklist status. I will review after you finish.
