# LiveGraph + chrome wrap-up pass — Accuenergy Metering V2

**Status:** implemented (frontend verified; hardware unverified)
**Date:** 2026-08-13
**Source review:** local frontend review of the uncommitted lab-density UI (review id `bcf7f074`)
**Owner intent:** Fix the ship blockers so this UI can go on the lab floor. Then leave a clean, lint-clean, committed tree. Do **not** build the installer or write meter registers.

**Hand to implementor:** read this file end-to-end and implement it. Do not ask the owner questions. Use the Default decisions table. Commit when done. Leave the tree buildable.

**App:** `C:\Projects\Active\Accuenergy_Metering`
**Do not modify:** `Accuenergy_Metering_Legacy`, `Accuenergy_Metering_Legacy_2`
**Decisions log:** `docs/DECISIONS.md`

The owner already applied an uncommitted frontend polish (header menus, tighter metrics, graph tiling, zoom/pan LiveGraph). **Keep those features.** They are not the problem. The problem is LiveGraph interaction state plus two lint errors.

---

## Unattended rules

### Do

- Fix every in-scope slice. If two approaches are valid, use the **Default** below and log it in `docs/DECISIONS.md`.
- Keep diffs local to the listed frontend files. Do not rewrite the monitor, storage, or report stack.
- Stay on **uPlot**. Do not swap chart libraries.
- Stay on version **0.1.0**.
- After the work: run the full verification block, commit locally, write the handoff template.
- Hardware is optional. Prefer **not** opening COM or writing meter registers. Do not claim live Modbus.

### Do not

- Do not ask the owner questions or wait for approval.
- Do not build NSIS / `.exe` / S-drive staging. Packaging is a later owner step.
- Do not revert the header menus, metric shrink, or 1–2 graph stack. Those stay.
- Do not change Start / Stop / Test wiring or their disable rules.
- Do not change backend monitor semantics, register map, or settings/orphan recovery.
- Do not push unless `git push` works with no prompts. Local commit is enough.
- Do not invent new graph types, overlays, or a settings field for zoom.

### Default decisions

| Ambiguity | Default |
|-----------|---------|
| After `setData(..., false)` | Always `plot.redraw()` (or equivalent that actually paints). This uPlot **does not commit** when `resetScales === false`. |
| What counts as zoomed | X window is meaningfully smaller than the current data X extent (epsilon, e.g. 0.05 s or 0.5% of span). Full-extent view = follow live. |
| Accidental click-drag | Require ~6 px movement before a pan starts. A click with no move must not latch zoom. |
| Returning to full X extent (wheel out, pan to edge, Reset, double-click) | Clear the zoom latch and resume follow (`setData(data, true)` on the next update). |
| Start / enter review / exit review / empty → first sample | Clear zoom latch and auto-range X and Y. Treat as a new dataset. |
| Reset button / double-click | Full auto-range (X to data bounds **and** Y auto), not only `setScale("x")`. |
| Host still &lt; 8×8 px | Cap `requestAnimationFrame` remount retries (~30 frames) or wait on `ResizeObserver`. Do not spin forever. |
| Desktop vs Demo chip | Put a compact runtime + version cue back in the header (see slice 3). |
| Load CSV location | Keep it in the download menu; relabel the menu so it is not only “Export.” |
| Hidden-keys cleanup | Do it without `setState` synchronously in an effect (lint must pass). |
| Tests | Extract pure helpers and Vitest them. Do not add a live COM test. |
| Version | Stay `0.1.0`. |

---

## Why this blocks the lab floor

This uPlot (`node_modules/uplot/dist/uPlot.esm.js`, `setData` ~line 3829):

```js
if (_resetScales !== false) {
  // autoScaleX / _setScale ...
  commit();
}
```

When `resetScales === false`, uPlot updates internal data and **does not `commit()`**. The current live path does:

```ts
plot.setData(alignedData(times, lines), !zoomedRef.current);
```

After any zoom/pan, `zoomedRef` is true, so every new sample updates data and **does not paint**. A bench user who zooms (or even click-drags) will think the meter stopped. SQLite can still be logging.

That is a **ship blocker**. Metric cards can still move; the graph lies.

---

## Current working tree (start here)

HEAD is `6ccd736` (review-fix pass, committed). Uncommitted / untracked frontend:

| Path | Role |
|------|------|
| `frontend/src/features/live/LiveGraph.tsx` | Zoom/pan, empty axes, time ticks — **primary fix target** |
| `frontend/src/shell/MeterShell.tsx` | Toolbar + tiling; keep Start/Stop/Test |
| `frontend/src/shell/ShellHeader.tsx` | Header menus + status pill |
| `frontend/src/shell/HeaderMenus.tsx` | Settings / Export menus |
| `frontend/src/shell/ShellStatusStrip.tsx` | Footer credit |
| `frontend/src/features/live/MetricCard.tsx` | Denser cards — leave unless a fix requires it |
| `frontend/src/app/branding.ts` | `APP_CREDIT` — keep |
| `frontend/src/shared/hooks/useDropdownMenu.ts` | Click-outside / Escape — leave |
| `frontend/src/shared/components/ui/dropdown-menu.tsx` | Menu primitives — leave |

Owner docs that must stay **untracked** (do not commit unless they are already committed):

- `docs/CODE_REVIEW_PROMPT.md`
- `docs/FEATURE_PASS_UI_SESSION_RECALL.md`

You **may** commit this file (`docs/LIVEGRAPH_FIX_PASS.md`) with the implementation.

---

## Slice order

1. LiveGraph paint + zoom latch + dataset reset (the three bugs)
2. Lint-clean hidden-keys + `const nextRange` + remount cap
3. Header/menu wrap-up (runtime chip, menu label, delete restating comment)
4. Tests for extracted helpers
5. `docs/DECISIONS.md` note + full verification + one local commit

You may combine 1–2 in one commit if that is cleaner. Do not leave lint red.

---

## Slice 1 — LiveGraph must keep painting

**File:** `frontend/src/features/live/LiveGraph.tsx`

### Bug A — `setData(false)` does not paint

Today (~line 379–383):

```ts
plot.setData(alignedData(times, lines), !zoomedRef.current);
```

**Required:**

- If **not** zoomed: `setData(data, true)` so X follows the ring buffer and Y auto-ranges.
- If zoomed: `setData(data, false)` **then** `plot.redraw()` so the new points appear in the current window.

Do not pass `false` unless you immediately paint.

### Bug B — any drag latches zoom

Today `onMouseMove` always calls `onZoomChange(true)`, including a no-op pan at full X extent (clamped min/max unchanged). Combined with Bug A, a slight click-drag freezes follow mode.

**Required:**

1. Do not start a pan until the pointer has moved ~6 px from mousedown.
2. Call `onZoomChange(true)` only when the applied X window is **smaller** than the data X bounds (use a small epsilon).
3. If the window is back to full data extent, call `onZoomChange(false)`.
4. Wheel-zoom already clears latch when `nextRange >= bounds` — keep that, and use the same helper.

Extract a pure helper (name as you like):

```ts
export function isZoomedXWindow(
  viewMin: number,
  viewMax: number,
  dataMin: number,
  dataMax: number,
  epsilonSeconds = 0.05,
): boolean {
  const view = viewMax - viewMin;
  const data = dataMax - dataMin;
  if (!(data > 0) || !(view > 0)) return false;
  return view + epsilonSeconds < data;
}
```

Use it from the wheel, pan, Reset, and double-click paths.

### Bug C — latch survives Start / review / exit

`zoomedRef` is only cleared on remount (theme / series identity) or Reset / double-click. `start()` → `emptyGraph()`, load review, and `exitReview()` reuse the same uPlot (`lineSignature` unchanged) and call `setData(..., !zoomedRef.current)`.

**Required:** detect a **dataset identity** change and then:

1. `zoomedRef.current = false` + `setZoomed(false)`
2. `setData(data, true)` (full auto-range)

Identity signals (use all that are cheap and reliable):

- `times.length` went to `0` or came back from `0`
- first timestamp changed by more than a sample (live `timestampMs/1000` vs review `tsUnix` is a different domain)
- last-to-first span jumped discontinuously (review 12k-point load)

A simple, sufficient default:

```ts
function datasetKey(times: number[]): string {
  if (times.length === 0) return "empty";
  return `${times.length}:${times[0]}:${times[times.length - 1]}`;
}
```

When `datasetKey` changes **and** it is not just the live ring buffer sliding (same cadence, last timestamp increased by a few seconds, length capped at 1800):

- Treat as a new dataset → clear zoom + `setData(true)`.

Live follow while not zoomed must **not** reset zoom every sample. Distinguish:

| Change | Action |
|--------|--------|
| Empty → has points | Clear zoom, auto-range |
| Has points → empty (`start()`) | Clear zoom, auto-range |
| First timestamp jumps (review load / exit) | Clear zoom, auto-range |
| Length 1800, window slides by ~1 s | Keep current zoom latch; if not zoomed, `setData(true)` |
| Length grows 10 → 11 during a run | If not zoomed, `setData(true)`; if zoomed, `setData(false)` + `redraw()` |

**Default implementation:** store `prevFirst = times[0]`. If `times[0]` is missing or `|times[0] - prevFirst| > 2` seconds (not a 1 Hz slide of a full 1800-point buffer — on a sliding buffer `times[0]` also moves, so use a tighter rule):

Better default for the sliding 1800-point live buffer:

- Live slide: `times[0]` increases by about the sample period each tick once full.
- Review load: `times[0]` jumps to a historical `tsUnix` (often a different epoch style) **or** length jumps by many points at once.

Use:

```ts
const first = times[0] ?? null;
const last = times[times.length - 1] ?? null;
const jumped =
  prevFirst != null &&
  first != null &&
  Math.abs(first - prevFirst) > 30; // 30s is larger than one live tick even on a full buffer at 1 Hz? WAIT
```

**Correction:** once the live buffer is full, `times[0]` advances ~1 s per sample. A 30 s threshold would false-trigger after 30 samples and clear zoom during a live inspect. Do **not** use a 30 s first-timestamp delta alone.

**Use this instead:**

```ts
function isNewDataset(
  prev: { first: number; last: number; length: number } | null,
  next: { first: number; last: number; length: number } | null,
): boolean {
  if (next == null) return prev != null;           // → empty
  if (prev == null) return true;                   // empty → data
  if (next.first < prev.first - 0.001) return true; // time went backwards
  if (next.length + 5 < prev.length) return true;  // large shrink (new empty-ish run)
  if (next.first > prev.last + 5) return true;     // discontinuity after previous last
  return false;
}
```

Live 1 Hz append: `first` stays or slides forward, `last` increases, `length` grows or stays 1800. Not a new dataset.
`start()`: empty then new times near `Date.now()/1000`. Previous last is old; new first ≫ prev.last **or** empty in between. New dataset.
Review: first is session `tsUnix`, often far from live `Date.now()/1000`. New dataset.

### Reset / double-click

Must:

1. Set X to data bounds
2. Clear zoom latch
3. Re-enable Y auto-range (`setData(data, true)` is the reliable way)

Do not only `setScale("x", bounds)`.

### Keep

- Empty-state fake 60 s window so axes exist before the first sample
- `HH:MM:SS` tick labels
- Series hide (at least one series remains visible)
- `spanGaps: false`
- Wheel zoom toward cursor, clamp to data bounds
- Cursor drag-to-select stays **off** (`drag.setScale: false`)

---

## Slice 2 — Lint and remount cap

`bun run lint` is currently **red** on this working tree:

1. `LiveGraph.tsx` ~97: `nextRange` is never reassigned → `const`.
2. `LiveGraph.tsx` ~314: `setHiddenKeys` synchronously inside `useEffect` (`react-hooks/set-state-in-effect`).

**Hidden keys:** do not call `setState` in that effect.

Defaults that satisfy the linter:

- Filter hidden keys at **render** time: `visibleHidden = hiddenKeys` intersect current `lines` keys. When toggling, only add keys that still exist.
- Or reset `hiddenKeys` in `toggleLine` / when `lineSignature` changes by computing the next set in the click handler / in the same `setHiddenKeys` as a toggle, not in an effect.
- Or derive `hiddenKeys` with a `useMemo` from a raw set + current keys.

**Remount cap (review suggestion, in scope):** if `clientWidth/Height < 8`, do not `requestAnimationFrame(mount)` forever. Cap at ~30 frames **or** observe `ResizeObserver` and mount once both dimensions are ≥ 8. Unmount must still cancel.

After this slice: `bun run lint` exits 0.

---

## Slice 3 — Chrome wrap-up (small, required)

Keep the new header layout. Apply these only:

### Runtime + version

`ShellHeader` dropped the Desktop / Demo / Connecting badge. `APP_VERSION` is only in `document.title`.

**Required:** show a compact cue in the header, next to the title or in the status area:

- Desktop / Demo / Connecting (same meaning as before: `controller.runtime`)
- `v0.1.0` (`APP_VERSION`) next to `APP_NAME` is enough

Pass `runtime` from `MeterShell` into `ShellHeader`. Match existing Inventory-like chip styles already used for the status pill.

### Export menu label

Load CSV is in the download menu. Behavior is correct; the title says “Export.”

**Required:** `ariaLabel` / `title` become **“Export & load”** (or “Files”). Keep the three actions and their disable rules.

### Restating comment

Delete this comment in `MeterShell.tsx`:

```ts
// 1–2 graphs stack full-width; 3–4 use a 2-column layout
```

The classes already say that.

### Log & sessions

The icon already has a `title`. Optional: mention “Sessions” in that title if it does not already. Do not restore a large labeled toolbar button.

---

## Slice 4 — Tests

Add `frontend/src/features/live/LiveGraph.test.ts` (or next to extracted helpers) covering **pure functions only**:

1. `isZoomedXWindow` — full extent → false; half extent → true; equal ± epsilon → false.
2. `isNewDataset` —
   - `null` → first points: true
   - live append (`last` +1 s, length +1): false
   - live slide at length 1800 (`first` +1 s, `last` +1 s): false
   - empty after points: true
   - first jumps backward: true
   - new first after previous last + 5 s: true

Do not try to mount uPlot in jsdom unless it already works; helpers are enough.

Existing `useMeterController.test.ts` (25 tests) must still pass. Do not weaken those cases.

---

## Files you should not need

Backend, `useMeterController.ts` (except if you must pass `runtime` — that is already on the controller return), meter config, reports, SQLite.

Do **not** “fix” `MeterValues` snake_case. Do not treat `0.0` as a missing sample.

---

## Verification (required before claiming done)

From `C:\Projects\Active\Accuenergy_Metering`:

```powershell
bun run lint
bun run test
bun run build:frontend
```

Lint must be **0 errors**. Tests must include the new helper cases and the previous 25 controller/types tests.

If `bun run desktop` is already running, do **not** start a second copy. If you can use an existing window without stealing a long owner session: Start (or demo in browser) → drag the plot → confirm new points still draw → Reset → confirm follow resumes. Browser demo is enough for this check. Do not write meter registers.

Optional browser-only: `bun run dev:frontend` and exercise zoom on the synthetic stream.

---

## Commit

One or two local commits, for example:

```text
Fix LiveGraph follow mode after zoom and review swaps
```

```text
Restore header runtime chip and relabel export menu
```

Do not commit `docs/CODE_REVIEW_PROMPT.md` or `docs/FEATURE_PASS_UI_SESSION_RECALL.md`.

`git status` at the end should be clean except those two owner docs (and this pass file if you choose not to commit it — **Default: commit this file**).

---

## Out of scope

- Signed NSIS, updater keys, S-drive
- 24 h soak, loaded-meter vs front panel
- Dropdown arrow-key roving tabindex
- Replacing uPlot
- Backend / monitor / settings / orphan recovery

---

## Handoff template (write this when finished)

```text
## LiveGraph wrap-up handoff

- Commits: <hashes>
- setData + redraw when zoomed: yes/no
- Zoom latch only when X window shrinks + pan deadzone: yes/no
- Dataset change clears zoom (start / review / exit): yes/no
- Reset does full auto-range: yes/no
- Lint: pass/fail (paste)
- Tests: N/N (paste)
- build:frontend: pass/fail
- Desktop/Demo + version visible: yes/no
- Export menu relabeled: yes/no
- Hardware: not claimed
- Risks left:
```

---

## Short paste prompt for the implementor

```
Read and implement C:\Projects\Active\Accuenergy_Metering\docs\LIVEGRAPH_FIX_PASS.md completely, unattended.

Work only in C:\Projects\Active\Accuenergy_Metering. Keep the uncommitted header-menu / denser-UI / zoom-pan work. Fix the three LiveGraph ship blockers (setData false does not paint in this uPlot, zoom latch on any drag, latch survives Start/review/exit), make bun run lint pass, add helper tests, restore a compact Desktop/Demo + version cue, and relabel the export menu to include load.

Do not ask questions. Use the Default decisions table. Do not replace uPlot, do not touch the Rust monitor, do not build an installer, do not claim live Modbus.

When finished run bun run lint, bun run test, and bun run build:frontend. Commit locally. Leave docs/CODE_REVIEW_PROMPT.md and docs/FEATURE_PASS_UI_SESSION_RECALL.md untracked. Finish with the handoff template in the doc. Start now at slice 1.
```
