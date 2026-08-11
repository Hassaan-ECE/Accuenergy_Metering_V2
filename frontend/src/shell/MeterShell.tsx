import { useEffect, useMemo, useState } from "react";
import { FolderOpen, Play, Settings2, Square, Wifi } from "lucide-react";

import { APP_NAME, APP_VERSION, DEVICE_MODEL, DEVICE_PROTOCOL } from "@/app/branding";
import { LiveGraph } from "@/features/live/LiveGraph";
import { MetricCard } from "@/features/live/MetricCard";
import { configSummary, DEFAULT_CONFIG } from "@/features/live/types";
import { useDemoLiveStream } from "@/features/live/useDemoLiveStream";
import { readTheme, THEME_STORAGE_KEY, type ThemeMode } from "@/platform/ui/theme";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/card";

import { ShellHeader } from "./ShellHeader";
import { ShellStatusStrip } from "./ShellStatusStrip";

export function MeterShell() {
  const [theme, setTheme] = useState<ThemeMode>(() => readTheme());
  const [config] = useState(DEFAULT_CONFIG);
  const stream = useDemoLiveStream();
  const summary = useMemo(() => configSummary({ ...config, themeName: theme }), [config, theme]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.title = `${APP_NAME} v${APP_VERSION}`;
  }, []);

  const onThemeToggle = (): void => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  };

  const statusMessage =
    stream.latest?.message ??
    (stream.isRunning ? "Running demo stream…" : `Ready · ${DEVICE_MODEL} · ${DEVICE_PROTOCOL}`);

  const statusTone =
    stream.status === "error" ? "error" : stream.status === "running" ? "ok" : "normal";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <ShellHeader configSummary={summary} onThemeToggle={onThemeToggle} theme={theme} />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={stream.isRunning} onClick={stream.start} variant="default">
            <Play className="size-4" />
            Start
          </Button>
          <Button disabled={!stream.isRunning} onClick={stream.stop} variant="destructive">
            <Square className="size-4" />
            Stop
          </Button>
          <Button
            disabled={stream.isRunning}
            onClick={() => stream.pushLog("RS485 test will use the Rust Modbus client (not wired yet).")}
            variant="outline"
          >
            <Wifi className="size-4" />
            Test RS485
          </Button>
          <Button
            disabled={stream.isRunning}
            onClick={() => stream.pushLog("Settings dialog — coming in port Phase 2.")}
            variant="outline"
          >
            <Settings2 className="size-4" />
            Settings
          </Button>
          <Button
            onClick={() => stream.pushLog("Report generation will open HTML/export from Rust.")}
            variant="outline"
          >
            <FolderOpen className="size-4" />
            Open Report
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            UI scaffold · demo stream only until backend Modbus is connected
          </span>
        </div>

        <section className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <MetricCard
            label="Frequency"
            large
            status={stream.values.frequency_hz === null && stream.isRunning ? "error" : "normal"}
            unit="Hz"
            value={stream.values.frequency_hz}
          />
          <MetricCard label="V1" unit="V" value={stream.values.phase_voltage_v1} />
          <MetricCard label="I1" unit="A" value={stream.values.current_i1} />
          <MetricCard label="P1" unit="W" value={stream.values.active_power_p1} />
          <MetricCard label="Samples" value={stream.sampleCount} />
          <MetricCard label="Sample rate" unit="Hz" value={stream.liveHz} />
          <MetricCard
            label="Errors"
            status={stream.errorCount > 0 ? "error" : "normal"}
            value={stream.errorCount}
          />
          <MetricCard
            label="Status"
            status={statusTone === "error" ? "error" : statusTone === "ok" ? "ok" : "normal"}
            text={stream.isRunning ? "Running" : "Ready"}
          />
        </section>

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.4fr_1fr]">
          <Card className="flex min-h-0 flex-col overflow-hidden">
            <CardHeader className="shrink-0 pb-0">
              <CardTitle>Live graph · Frequency vs time</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-hidden pt-2">
              <LiveGraph
                theme={theme}
                times={stream.graph.times}
                title="Frequency"
                unit="Hz"
                values={stream.graph.values}
              />
            </CardContent>
          </Card>

          <Card className="flex min-h-0 flex-col overflow-hidden">
            <CardHeader className="shrink-0 pb-0">
              <CardTitle>Activity log</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 flex-1 overflow-auto pt-2">
              <ul className="space-y-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {stream.logLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>

      <ShellStatusStrip message={statusMessage} tone={statusTone} />
    </div>
  );
}
