# Code review pass prompt — Accuenergy Metering V2

**Paste this entire document into a new agent chat** for an independent review of the completed overnight implementation.

---

```
CODE REVIEW PASS — Accuenergy Metering V2 (0.1.0)

You are an independent senior reviewer. Do NOT implement large features unless you find a critical fix the owner must have. Prefer findings over rewrites. Do not ask the owner questions mid-review unless blocked by a missing workspace; decide and document.

GOAL
Review the completed V2 port for correctness, parity with the legacy Python app, safety, and maintainability. Produce a structured review the owner can act on tomorrow. Software parity is claimed complete; hardware was NOT verified (no serial ports). Treat live Modbus as unproven.

WORKSPACE
- App (review target): C:\Projects\Active\Accuenergy_Metering
- GitHub: https://github.com/Hassaan-ECE/Accuenergy_Metering_V2.git  (main @ 318dea6 or later)
- Legacy reference (read-only): C:\Projects\Active\Accuenergy_Metering_Legacy
- UI style reference only: C:\Projects\Active\Inventory_Management
- Do not modify legacy or S-drive. Prefer not to change production code unless Critical; small clear fixes OK if verified.

READ FIRST
1. docs/DECISIONS.md
2. docs/LEGACY_ANALYSIS.md
3. docs/PORT_PLAN.md
4. README.md
5. AGENTS.md
6. Legacy: Code/core/{meter,monitor,database,report,config}.py and Code/gui/main_window.py
7. git log fde8299..HEAD and git show of key commits

SCOPE (all first-party code)
Backend:
  backend/src/api/mod.rs
  backend/src/meter_io.rs
  backend/src/monitor/mod.rs
  backend/src/storage/mod.rs
  backend/src/report/mod.rs
  backend/src/paths.rs
  backend/src/domain/{config,meter}.rs
  backend/src/lib.rs
Frontend:
  frontend/src/shell/*
  frontend/src/features/live/*
  frontend/src/features/settings/*
  frontend/src/integrations/tauri/meterBridge.ts
  frontend/src/platform/ui/theme.ts
  frontend/src/shared/**
Config: package.json, backend/Cargo.toml, backend/tauri.conf.json, capabilities

OUT OF SCOPE
- Full product redesign
- Signed NSIS / S-drive release
- Inventing multi-meter / Ethernet features
- Replacing uPlot (owner confirmed it is the right chart choice)

REVIEW DIMENSIONS

1) Correctness & legacy parity
- Register map addresses and big-endian float32 decode match legacy meter.py
- Sequential 2-register reads; no unsafe block-read assumptions
- Sample vs error semantics (any value = sample row; full miss = error, no row)
- Session IDs, stop reasons, run_hours=0 forever, sample_hz=0 max rate
- Config defaults COM5/19200/N/1/device1 and validation
- Consecutive error logging thresholds 1,5,10,every 25 + restore
- Single active monitor session
- Report stats (n/mean/min/max/std) and content vs report.py intent

2) Concurrency & lifecycle
- Monitor thread/task isolation from UI
- Stop token mid multi-register loop
- Window close: confirm → stop → finalize → exit
- Race: double Start, Stop without Start, close during probe
- Dropped events / backpressure if UI slow
- What happens on abrupt process kill (documented: session may stay "running")

3) Storage safety
- SQLite WAL, schema, migrations/ensure_schema, batch flush, finalize paths
- Path handling under %LOCALAPPDATA%\com.accuenergy.metering\
- open_path restricted to app-data root (path traversal?)
- Config JSON integrity; concurrent file access

4) IPC / Tauri security
- Commands: types, error strings, no panics across FFI boundary
- Events: live-update, monitor-log, finished/failed payload consistency FE↔BE
- Capability permissions minimal?
- CSP and opener/dialog scope

5) Frontend quality
- useMeterController desktop vs browser demo separation (no accidental serial claims in browser)
- MeterShell wiring, control enable/disable while running
- uPlot multi-series memory (1800 pts), null/gap handling, theme
- SettingsDialog validation UX
- Notice/error handling; no silent failures

6) Reports / export
- HTML self-contained (no CDN)
- SVG correctness with missing data
- CSV columns and escaping
- generate_report on empty/running session

7) Tests & build
- Run: bun run lint, bun run test, bun run build:frontend
- Run: cargo fmt --check, cargo test, cargo clippy --all-targets -- -D warnings (if env allows)
- Note coverage gaps (especially meter_io/monitor without hardware mocks)

8) Docs accuracy
- README / DECISIONS / PORT_PLAN match code
- Hardware boundary clearly stated
- No overclaim of live Modbus

SEVERITY
- Critical: data loss, wrong register decode, unsafe path escape, crash on normal use, incorrect sample semantics
- High: parity breaks, race leaving bad session state, UI can start two monitors, report wrong stats
- Medium: UX bugs, weak error messages, missing tests for core paths, maintainability
- Low: nits, style, optional polish
- Question / Risk: needs hardware or product decision

METHOD
1. Fetch/status: confirm clean tree on latest main.
2. Map architecture briefly (diagram or bullets).
3. Deep-read monitor + meter_io + storage + api first (highest risk).
4. Then FE controller + shell + bridge.
5. Then report + settings + paths.
6. Run verification commands; paste evidence.
7. Spot-check against legacy Python for 3–5 behavioral invariants.

OUTPUT FORMAT (required)
## Summary
Verdict: Approve / Approve with fixes / Request changes
1–2 paragraphs overall.

## Architecture notes
Short map of modules and data flow.

## Findings
For each finding:
### [Critical|High|Medium|Low|Risk] Title
- Where: path:line (approx)
- Evidence: what the code does
- Impact: why it matters
- Recommendation: concrete fix
- Suggested owner action: must-fix before lab / can defer

## Parity checklist (reviewer view)
Mark each area: OK / Issue / Unverified (hardware)
Connection, Monitor, UI, Storage, Reports, Polish

## Verification you ran
Commands + pass/fail.

## What’s solid
Bullet the strong parts (so owner knows what not to rewrite).

## Recommended fix order
Prioritized list if any Critical/High exist.

## Optional follow-ups
Non-blocking improvements (tests, logging file, etc.)

RULES
- Be specific; quote or cite lines. No vague “consider improving quality.”
- Prefer legacy behavior when judging intentional differences (see DECISIONS.md).
- Do not demand FeOx, multi-meter, or chart library swaps.
- If you apply Critical fixes only: keep diffs minimal, re-run tests, note what you changed. Otherwise review-only.
- End with a clear morning handoff for the owner. No “shall I continue?” blocker.

START NOW with git status/log and reading DECISIONS.md + monitor/mod.rs + meter_io.rs.
```
