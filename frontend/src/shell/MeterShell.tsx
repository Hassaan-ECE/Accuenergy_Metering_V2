import { useEffect, useMemo, useState } from "react";
import {
  Database,
  Download,
  FileChartColumnIncreasing,
  FolderOpen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RefreshCw,
  Settings2,
  Square,
  Wifi,
  X,
} from "lucide-react";

import { APP_NAME, APP_VERSION, DEVICE_MODEL, DEVICE_PROTOCOL } from "@/app/branding";
import { LiveGraph, type GraphLine } from "@/features/live/LiveGraph";
import { MetricCard } from "@/features/live/MetricCard";
import { configSummary, type AppConfig, type MeterKey, type SessionRecord } from "@/features/live/types";
import { useMeterController, type Notice } from "@/features/live/useMeterController";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { THEME_STORAGE_KEY } from "@/platform/ui/theme";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";
import { cn } from "@/shared/lib/utils";

import { ShellHeader } from "./ShellHeader";
import { ShellStatusStrip } from "./ShellStatusStrip";

type GraphMode = "frequency" | "voltage" | "current" | "power";

const ACTIVITY_PANEL_STORAGE_KEY = "accuenergyMetering.showActivityPanel";
const GRAPH_SELECTION_STORAGE_KEY = "accuenergyMetering.visibleGraphs";

const GRAPH_PRESETS: Record<
  GraphMode,
  {
    label: string;
    title: string;
    unit: string;
    secondaryUnit?: string;
    keys: Array<{ key: MeterKey; label: string; color: string; scale?: "y" | "y2" }>;
  }
> = {
  frequency: {
    label: "Frequency",
    title: "Frequency vs time",
    unit: "Hz",
    keys: [{ key: "frequency_hz", label: "Frequency", color: "#2563eb" }],
  },
  voltage: {
    label: "Voltage",
    title: "Voltage vs time",
    unit: "V",
    keys: [
      { key: "phase_voltage_v1", label: "V1", color: "#2563eb" },
      { key: "phase_voltage_v2", label: "V2", color: "#0f9f6e" },
      { key: "phase_voltage_v3", label: "V3", color: "#d97706" },
      { key: "line_voltage_v12", label: "V12", color: "#9333ea" },
    ],
  },
  current: {
    label: "Current",
    title: "Current vs time",
    unit: "A",
    keys: [
      { key: "current_i1", label: "I1", color: "#2563eb" },
      { key: "current_i2", label: "I2", color: "#0f9f6e" },
      { key: "current_i3", label: "I3", color: "#d97706" },
    ],
  },
  power: {
    label: "Power / PF",
    title: "Active power and power factor",
    unit: "W",
    secondaryUnit: "PF",
    keys: [
      { key: "active_power_p1", label: "P1", color: "#dc2626", scale: "y" },
      { key: "power_factor_pf1", label: "PF1", color: "#7c3aed", scale: "y2" },
    ],
  },
};

const GRAPH_MODES = Object.keys(GRAPH_PRESETS) as GraphMode[];

function readActivityPanelPreference(): boolean {
  try {
    return window.localStorage.getItem(ACTIVITY_PANEL_STORAGE_KEY) !== "hidden";
  } catch {
    return true;
  }
}

function readGraphSelection(): GraphMode[] {
  try {
    const stored = window.localStorage.getItem(GRAPH_SELECTION_STORAGE_KEY);
    if (!stored) return GRAPH_MODES;
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return GRAPH_MODES;
    const selected = GRAPH_MODES.filter((mode) => parsed.includes(mode));
    return selected.length ? selected : GRAPH_MODES;
  } catch {
    return GRAPH_MODES;
  }
}

export function MeterShell() {
  const controller = useMeterController();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [visibleGraphs, setVisibleGraphs] = useState<GraphMode[]>(readGraphSelection);
  const [showActivityPanel, setShowActivityPanel] = useState(readActivityPanelPreference);
  const [sideTab, setSideTab] = useState<"activity" | "sessions">("activity");
  const theme = controller.config.themeName;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.title = `${APP_NAME} v${APP_VERSION}`;
  }, []);

  useEffect(() => {
    window.localStorage.setItem(ACTIVITY_PANEL_STORAGE_KEY, showActivityPanel ? "shown" : "hidden");
  }, [showActivityPanel]);

  useEffect(() => {
    window.localStorage.setItem(GRAPH_SELECTION_STORAGE_KEY, JSON.stringify(visibleGraphs));
  }, [visibleGraphs]);

  useEffect(() => {
    if (!controller.notice) return;
    const timer = window.setTimeout(controller.dismissNotice, 6500);
    return () => window.clearTimeout(timer);
  }, [controller.dismissNotice, controller.notice]);

  const graphCards = useMemo(
    () =>
      visibleGraphs.map((mode) => {
        const preset = GRAPH_PRESETS[mode];
        const lines: GraphLine[] = preset.keys.map((line) => ({
          ...line,
          values: controller.graph.series[line.key],
        }));
        return { mode, preset, lines };
      }),
    [controller.graph.series, visibleGraphs],
  );
  const summary = useMemo(() => configSummary(controller.config), [controller.config]);

  const onThemeToggle = () => {
    const next: AppConfig["themeName"] = theme === "light" ? "dark" : "light";
    void controller.updateTheme(next);
  };

  const onSaveSettings = async (config: AppConfig) => {
    await controller.persistConfig(config);
    setSettingsOpen(false);
  };

  const toggleGraph = (mode: GraphMode) => {
    setVisibleGraphs((current) => {
      if (current.includes(mode)) {
        return current.length === 1 ? current : current.filter((candidate) => candidate !== mode);
      }
      const selected = new Set([...current, mode]);
      return GRAPH_MODES.filter((candidate) => selected.has(candidate));
    });
  };

  const statusText = controller.testing
    ? "Testing…"
    : controller.probeStatus ??
      ({ idle: "Ready", connecting: "Connecting…", running: "Running", stopping: "Stopping…", error: "Error" }[
        controller.status
      ] ?? "Ready");
  const statusTone =
    controller.status === "error" || controller.probeStatus === "No reply"
      ? "error"
      : controller.status === "running" || controller.probeStatus === "RS485 OK"
        ? "ok"
        : "normal";
  const statusMessage =
    controller.latestUpdate?.message ??
    (controller.runtime === "browser"
      ? "Browser demo mode · synthetic values · no serial I/O or files"
      : controller.runtime === "checking"
        ? "Connecting to desktop backend…"
        : `${statusText} · ${DEVICE_MODEL} · ${DEVICE_PROTOCOL}`);
  const controlsBusy = controller.testing || controller.reporting || controller.runtime === "checking";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <ShellHeader
        configSummary={summary}
        onThemeToggle={onThemeToggle}
        runtime={controller.runtime}
        theme={theme}
      />

      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-3 py-3 sm:px-4">
        <section className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
          <Button disabled={controller.isRunning || controlsBusy} onClick={controller.start} variant="default">
            <Play className="size-4" />
            Start
          </Button>
          <Button disabled={!controller.isRunning || controller.status === "stopping"} onClick={controller.stop} variant="destructive">
            <Square className="size-4" />
            {controller.status === "stopping" ? "Stopping…" : "Stop"}
          </Button>
          <Button disabled={controller.isRunning || controlsBusy} onClick={controller.test} variant="outline">
            <Wifi className={controller.testing ? "size-4 animate-pulse" : "size-4"} />
            {controller.testing ? "Testing…" : "Test RS485"}
          </Button>
          <Button disabled={controller.isRunning || controlsBusy} onClick={() => setSettingsOpen(true)} variant="outline">
            <Settings2 className="size-4" />
            Settings
          </Button>
          <Button disabled={controller.reporting || controller.runtime !== "desktop"} onClick={controller.openReport} variant="outline">
            <FileChartColumnIncreasing className="size-4" />
            {controller.reporting ? "Generating…" : "Generate Report"}
          </Button>
          <Button
            disabled={controller.exportingSessionId !== null || controller.runtime !== "desktop"}
            onClick={controller.exportCurrentCsv}
            variant="outline"
          >
            <Download className="size-4" />
            {controller.exportingSessionId ? "Exporting…" : "Export CSV"}
          </Button>
          <div className="mx-1 hidden h-6 w-px bg-border lg:block" />
          <div className="flex items-center gap-1 rounded-lg bg-muted/70 p-1" aria-label="Visible graph groups">
            <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Graphs</span>
            {GRAPH_MODES.map((mode) => (
              <button
                aria-pressed={visibleGraphs.includes(mode)}
                className={cn(
                  "rounded-md px-2 py-1 text-[11px] font-medium transition",
                  visibleGraphs.includes(mode)
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                key={mode}
                onClick={() => toggleGraph(mode)}
                type="button"
              >
                {GRAPH_PRESETS[mode].label}
              </button>
            ))}
          </div>
          <Button
            aria-pressed={showActivityPanel}
            onClick={() => setShowActivityPanel((current) => !current)}
            size="sm"
            variant={showActivityPanel ? "secondary" : "ghost"}
          >
            {showActivityPanel ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            Log & sessions
          </Button>
          <div className="mx-1 hidden h-6 w-px bg-border xl:block" />
          <Button
            disabled={controller.runtime !== "desktop"}
            onClick={() => controller.openDataPath(controller.paths?.root)}
            size="sm"
            variant="ghost"
          >
            <Database className="size-4" />
            App Data
          </Button>
          <Button
            disabled={controller.runtime !== "desktop"}
            onClick={() => controller.openDataPath(controller.paths?.reports)}
            size="sm"
            variant="ghost"
          >
            <FolderOpen className="size-4" />
            Reports
          </Button>
          <div
            className={cn(
              "ml-auto flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium",
              statusTone === "ok" && "border-success/30 bg-success/10 text-success-foreground",
              statusTone === "error" && "border-destructive/30 bg-destructive/10 text-destructive-foreground",
              statusTone === "normal" && "border-border bg-muted/50 text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "size-2 rounded-full",
                statusTone === "ok" && "bg-success",
                statusTone === "error" && "bg-destructive",
                statusTone === "normal" && "bg-muted-foreground/60",
                controller.status === "connecting" && "animate-pulse",
              )}
            />
            {statusText}
          </div>
        </section>

        <section className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
          <MetricCard label="Frequency" large unit="Hz" value={controller.values.frequency_hz} />
          <MetricCard label="V1" unit="V" value={controller.values.phase_voltage_v1} />
          <MetricCard label="V2" unit="V" value={controller.values.phase_voltage_v2} />
          <MetricCard label="V3" unit="V" value={controller.values.phase_voltage_v3} />
          <MetricCard label="V12" unit="V" value={controller.values.line_voltage_v12} />
          <MetricCard label="I1" unit="A" value={controller.values.current_i1} />
          <MetricCard label="I2" unit="A" value={controller.values.current_i2} />
          <MetricCard label="I3" unit="A" value={controller.values.current_i3} />
          <MetricCard label="P1" unit="W" value={controller.values.active_power_p1} />
          <MetricCard label="PF1" value={controller.values.power_factor_pf1} />
          <MetricCard label="Samples" value={controller.sampleCount} />
          <MetricCard label="Live rate" unit="Hz" value={controller.liveHz} />
          <MetricCard label="Errors" status={controller.errorCount > 0 ? "error" : "normal"} value={controller.errorCount} />
          <MetricCard label="Status" status={statusTone} text={statusText} />
        </section>

        <section
          className={cn(
            "grid min-h-0 flex-1 gap-3 overflow-hidden",
            showActivityPanel && "md:grid-cols-[minmax(0,1.55fr)_minmax(330px,0.85fr)]",
          )}
        >
          <Card className="flex min-h-0 flex-col overflow-hidden">
            <CardHeader className="shrink-0 gap-2 pb-0">
              <div className="flex items-center justify-between gap-2">
                <CardTitle>Live graphs</CardTitle>
                <span className="text-[11px] text-muted-foreground">
                  {graphCards.length} group{graphCards.length === 1 ? "" : "s"} · aligned time window
                </span>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-hidden pb-3 pt-2">
              <div
                className={cn(
                  "grid h-full min-h-0 gap-2 overflow-hidden",
                  graphCards.length === 1 ? "grid-cols-1" : "grid-cols-2",
                )}
                style={{ gridTemplateRows: `repeat(${Math.ceil(graphCards.length / 2)}, minmax(0, 1fr))` }}
              >
                {graphCards.map(({ lines, mode, preset }) => (
                  <div className="min-h-0 overflow-hidden rounded-lg border border-border bg-muted/15 p-1.5" key={mode}>
                    <LiveGraph
                      lines={lines}
                      secondaryUnit={preset.secondaryUnit}
                      theme={theme}
                      times={controller.graph.times}
                      title={preset.title}
                      unit={preset.unit}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {showActivityPanel ? <Card className="flex min-h-0 flex-col overflow-hidden">
            <CardHeader className="shrink-0 gap-3 pb-0">
              <SessionInfo
                databasePath={controller.paths?.database ?? null}
                reportPath={controller.lastReportPath}
                session={controller.latestSession}
                sessionId={controller.currentSessionId}
              />
              <div className="flex items-center justify-between border-t border-border pt-2">
                <div className="flex gap-1 rounded-lg bg-muted/70 p-1">
                  <TabButton active={sideTab === "activity"} label="Activity" onClick={() => setSideTab("activity")} />
                  <TabButton active={sideTab === "sessions"} label={`Sessions (${controller.sessions.length})`} onClick={() => setSideTab("sessions")} />
                </div>
                {sideTab === "sessions" && controller.runtime === "desktop" ? (
                  <Button onClick={controller.refreshSessions} size="icon" variant="ghost" aria-label="Refresh sessions">
                    <RefreshCw className="size-4" />
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-auto pt-2">
              {sideTab === "activity" ? (
                <ul className="space-y-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {controller.logLines.map((line, index) => (
                    <li className="break-words" key={`${index}-${line}`}>{line}</li>
                  ))}
                </ul>
              ) : (
                <SessionList
                  exportingSessionId={controller.exportingSessionId}
                  onExport={controller.exportCsv}
                  onReport={controller.openSessionReport}
                  reporting={controller.reporting}
                  sessions={controller.sessions}
                />
              )}
            </CardContent>
          </Card> : null}
        </section>
      </main>

      <ShellStatusStrip message={statusMessage} tone={statusTone} />
      {settingsOpen ? (
        <SettingsDialog
          config={controller.config}
          onClose={() => setSettingsOpen(false)}
          onRefreshPorts={controller.refreshPorts}
          onSave={onSaveSettings}
          ports={controller.ports}
          refreshingPorts={controller.refreshingPorts}
          saving={controller.savingConfig}
        />
      ) : null}
      {controller.notice ? <NoticeToast notice={controller.notice} onClose={controller.dismissNotice} /> : null}
    </div>
  );
}

function SessionInfo({
  databasePath,
  reportPath,
  session,
  sessionId,
}: {
  databasePath: string | null;
  reportPath: string | null;
  session: SessionRecord | null;
  sessionId: string | null;
}) {
  return (
    <div className="space-y-1.5">
      <CardTitle>Session workspace</CardTitle>
      <InfoRow label="Session" value={sessionId ?? "No completed run yet"} />
      <InfoRow label="Database" value={databasePath ?? "Desktop backend not connected"} />
      <InfoRow label="Report" value={reportPath ?? "No report generated yet"} />
      {session ? (
        <p className="text-[11px] text-muted-foreground">
          {session.sampleCount.toLocaleString()} samples · {session.errorCount} errors · {session.stopReason ?? session.status}
        </p>
      ) : null}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[58px_minmax(0,1fr)] gap-2 text-[11px]">
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-foreground/80" title={value}>{value}</span>
    </div>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-medium transition",
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function SessionList({
  exportingSessionId,
  onExport,
  onReport,
  reporting,
  sessions,
}: {
  exportingSessionId: string | null;
  onExport: (sessionId: string) => Promise<void>;
  onReport: (sessionId: string) => Promise<void>;
  reporting: boolean;
  sessions: SessionRecord[];
}) {
  if (!sessions.length) {
    return <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No sessions recorded yet.</p>;
  }
  return (
    <div className="space-y-2">
      {sessions.map((session) => (
        <div className="rounded-xl border border-border bg-muted/30 p-3" key={session.sessionId}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-mono text-xs font-semibold" title={session.sessionId}>{session.sessionId}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {formatSessionTime(session.endedAt ?? session.startedAt)} · {session.sampleCount.toLocaleString()} samples · {session.errorCount} errors
              </p>
            </div>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
              session.status === "error" ? "bg-destructive/10 text-destructive-foreground" : "bg-success/10 text-success-foreground",
            )}>{session.status}</span>
          </div>
          <div className="mt-2 flex gap-2">
            <Button disabled={reporting || session.sampleCount === 0} onClick={() => onReport(session.sessionId)} size="xs" variant="outline">
              <FileChartColumnIncreasing className="size-3.5" />
              Report
            </Button>
            <Button disabled={exportingSessionId !== null || session.sampleCount === 0} onClick={() => onExport(session.sessionId)} size="xs" variant="outline">
              <Download className="size-3.5" />
              {exportingSessionId === session.sessionId ? "Exporting…" : "CSV"}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function NoticeToast({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  return (
    <div
      className={cn(
        "fixed right-4 top-4 z-[60] w-[min(420px,calc(100vw-2rem))] rounded-xl border bg-card p-4 shadow-2xl",
        notice.tone === "success" && "border-success/30",
        notice.tone === "warning" && "border-warning/40",
        notice.tone === "error" && "border-destructive/40",
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn(
          "mt-1 size-2.5 shrink-0 rounded-full",
          notice.tone === "success" && "bg-success",
          notice.tone === "warning" && "bg-warning",
          notice.tone === "error" && "bg-destructive",
        )} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{notice.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{notice.message}</p>
        </div>
        <Button aria-label="Dismiss notification" onClick={onClose} size="icon" variant="ghost">
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
