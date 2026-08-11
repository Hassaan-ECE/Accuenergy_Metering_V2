import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  appendGraphPoint,
  DEFAULT_CONFIG,
  emptyGraph,
  emptyValues,
  type AppConfig,
  type GraphBuffer,
  type LiveUpdate,
  type MeterSnapshot,
  type MeterValues,
  type MonitorFailure,
  type MonitorLog,
  type MonitorStatus,
  type SessionRecord,
  type SessionSummary,
} from "./types";
import { useDemoLiveStream } from "./useDemoLiveStream";
import {
  exportSessionCsv,
  generateReport,
  getAppPaths,
  getConfig,
  getMonitorState,
  isTauriRuntime,
  listSerialPorts,
  listSessions,
  openPath,
  saveConfig,
  startMonitor,
  stopMonitor,
  testRs485,
  type AppPaths,
  type PortInfo,
} from "@/integrations/tauri/meterBridge";
import { THEME_STORAGE_KEY } from "@/platform/ui/theme";

const BROWSER_CONFIG_KEY = "accuenergyMetering.config";

export type RuntimeMode = "checking" | "desktop" | "browser";

export interface Notice {
  id: number;
  tone: "success" | "warning" | "error";
  title: string;
  message: string;
}

function browserConfig(): AppConfig {
  let storedConfig: Partial<AppConfig> = {};
  try {
    const stored = window.localStorage.getItem(BROWSER_CONFIG_KEY);
    if (stored) storedConfig = JSON.parse(stored) as Partial<AppConfig>;
  } catch {
    storedConfig = {};
  }
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return {
    ...DEFAULT_CONFIG,
    ...storedConfig,
    themeName: storedTheme === "dark" || storedTheme === "light" ? storedTheme : storedConfig.themeName ?? DEFAULT_CONFIG.themeName,
  };
}

function stamped(message: string, timestampMs = Date.now()): string {
  return `[${new Date(timestampMs).toLocaleTimeString()}] ${message}`;
}

export function useMeterController() {
  const demo = useDemoLiveStream();
  const { pushLog: pushDemoLog, start: startDemo, stop: stopDemo } = demo;
  const [runtime, setRuntime] = useState<RuntimeMode>("checking");
  const [config, setConfig] = useState<AppConfig>(browserConfig);
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [paths, setPaths] = useState<AppPaths | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [status, setStatus] = useState<MonitorStatus>("idle");
  const [values, setValues] = useState<MeterValues>(emptyValues);
  const [graph, setGraph] = useState<GraphBuffer>(emptyGraph);
  const [logLines, setLogLines] = useState<string[]>([stamped("Application ready.")]);
  const [sampleCount, setSampleCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [liveHz, setLiveHz] = useState(0);
  const [latestUpdate, setLatestUpdate] = useState<LiveUpdate | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [lastReportPath, setLastReportPath] = useState<string | null>(null);
  const [probeStatus, setProbeStatus] = useState<"RS485 OK" | "No reply" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [testing, setTesting] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [refreshingPorts, setRefreshingPorts] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [exportingSessionId, setExportingSessionId] = useState<string | null>(null);
  const pendingReportRef = useRef(false);
  const runningRef = useRef(false);
  const allowCloseRef = useRef(false);
  const monitorEndWaiters = useRef(new Set<() => void>());

  const pushLog = useCallback((message: string, timestampMs = Date.now()) => {
    setLogLines((previous) => [stamped(message, timestampMs), ...previous].slice(0, 500));
  }, []);

  const showNotice = useCallback((tone: Notice["tone"], title: string, message: string) => {
    setNotice({ id: Date.now(), tone, title, message });
  }, []);

  const refreshSessions = useCallback(async () => {
    const next = await listSessions();
    setSessions(next);
    const latest = next.find((session) => session.endedAt !== null) ?? null;
    if (latest) {
      setLastReportPath(latest.reportPath);
      if (!runningRef.current) setCurrentSessionId(latest.sessionId);
    }
  }, []);

  const generateAndOpen = useCallback(
    async (sessionId: string) => {
      setReporting(true);
      try {
        const path = await generateReport(sessionId);
        setLastReportPath(path);
        pushLog(`Report saved: ${path}`);
        await openPath(path);
        await refreshSessions();
        showNotice("success", "Report ready", "The self-contained HTML report opened in your default browser.");
      } catch (error) {
        const message = String(error);
        pushLog(`Report failed: ${message}`);
        showNotice("error", "Report failed", message);
      } finally {
        setReporting(false);
      }
    },
    [pushLog, refreshSessions, showNotice],
  );

  const resolveMonitorEnd = useCallback(() => {
    for (const resolve of monitorEndWaiters.current) resolve();
    monitorEndWaiters.current.clear();
  }, []);

  useEffect(() => {
    runningRef.current = status === "connecting" || status === "running" || status === "stopping";
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const desktop = await isTauriRuntime();
      if (cancelled) return;
      if (!desktop) {
        setRuntime("browser");
        setConfig(browserConfig());
        pushDemoLog("Browser mode detected; meter values are synthetic and no files are written.");
        return;
      }
      setRuntime("desktop");
      try {
        const [loadedConfig, loadedPaths, loadedPorts, loadedSessions, monitorState] = await Promise.all([
          getConfig(),
          getAppPaths(),
          listSerialPorts(),
          listSessions(),
          getMonitorState(),
        ]);
        if (cancelled) return;
        setConfig(loadedConfig);
        setPaths(loadedPaths);
        setPorts(loadedPorts);
        setSessions(loadedSessions);
        const latest = loadedSessions.find((session) => session.endedAt !== null) ?? null;
        if (latest) {
          setCurrentSessionId(latest.sessionId);
          setSampleCount(latest.sampleCount);
          setErrorCount(latest.errorCount);
          setLastReportPath(latest.reportPath);
        }
        if (monitorState.running) {
          setStatus("running");
          setCurrentSessionId(monitorState.sessionId);
          pushLog(`Reattached to active session ${monitorState.sessionId ?? ""}.`);
        } else {
          pushLog("Desktop backend connected; persisted settings and sessions loaded.");
        }
      } catch (error) {
        pushLog(`Desktop initialization failed: ${String(error)}`);
        showNotice("error", "Desktop initialization failed", String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pushDemoLog, pushLog, showNotice]);

  useEffect(() => {
    if (runtime !== "desktop") return;
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const next = await Promise.all([
        listen<LiveUpdate>("live-update", ({ payload }) => {
          setLatestUpdate(payload);
          setValues(payload.values);
          setSampleCount(payload.sampleCount);
          setErrorCount(payload.errorCount);
          setLiveHz(payload.liveHz);
          setCurrentSessionId(payload.sessionId);
          setGraph((previous) => appendGraphPoint(previous, payload));
          setStatus("running");
        }),
        listen<MonitorLog>("monitor-log", ({ payload }) => {
          pushLog(payload.message, payload.timestampMs);
          if (payload.message.startsWith("Connected to")) setStatus("running");
        }),
        listen<SessionSummary>("monitor-finished", ({ payload }) => {
          setStatus("idle");
          setLiveHz(0);
          setSampleCount(payload.sampleCount);
          setErrorCount(payload.errorCount);
          setCurrentSessionId(payload.sessionId);
          resolveMonitorEnd();
          showNotice("success", "Monitoring finished", `${payload.sampleCount} samples · ${payload.stopReason}`);
          void refreshSessions();
          if (pendingReportRef.current) {
            pendingReportRef.current = false;
            void generateAndOpen(payload.sessionId);
          }
        }),
        listen<MonitorFailure>("monitor-failed", ({ payload }) => {
          pendingReportRef.current = false;
          setStatus("error");
          setLiveHz(0);
          resolveMonitorEnd();
          pushLog(`${payload.kind === "connection" ? "Connection" : "Monitoring"} error: ${payload.message}`);
          showNotice("error", payload.kind === "connection" ? "Meter not connected" : "Monitoring failed", payload.message);
          void refreshSessions();
        }),
      ]);
      if (cancelled) next.forEach((unlisten) => unlisten());
      else unlisteners.push(...next);
    })();
    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [generateAndOpen, pushLog, refreshSessions, resolveMonitorEnd, runtime, showNotice]);

  const start = useCallback(async () => {
    if (runtime === "browser") {
      startDemo();
      return;
    }
    if (runtime !== "desktop") return;
    setStatus("connecting");
    setProbeStatus(null);
    setValues(emptyValues());
    setGraph(emptyGraph());
    setLatestUpdate(null);
    setSampleCount(0);
    setErrorCount(0);
    setLiveHz(0);
    try {
      const result = await startMonitor();
      setCurrentSessionId(result.sessionId);
      pushLog(`Starting monitor ${result.sessionId} · ${config.port} @ ${config.baudrate} baud.`);
    } catch (error) {
      setStatus("error");
      pushLog(`Could not start monitor: ${String(error)}`);
      showNotice("error", "Could not start monitor", String(error));
    }
  }, [config.baudrate, config.port, pushLog, runtime, showNotice, startDemo]);

  const stop = useCallback(async () => {
    if (runtime === "browser") {
      stopDemo();
      return;
    }
    if (runtime !== "desktop") return;
    setStatus("stopping");
    try {
      const sessionId = await stopMonitor();
      if (sessionId) pushLog("Stop requested; waiting for the current Modbus read to finish.");
      else {
        setStatus("idle");
        resolveMonitorEnd();
      }
    } catch (error) {
      setStatus("error");
      pushLog(`Stop request failed: ${String(error)}`);
      showNotice("error", "Stop request failed", String(error));
    }
  }, [pushLog, resolveMonitorEnd, runtime, showNotice, stopDemo]);

  useEffect(() => {
    if (runtime !== "desktop") return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const [{ getCurrentWindow }, { confirm }] = await Promise.all([
        import("@tauri-apps/api/window"),
        import("@tauri-apps/plugin-dialog"),
      ]);
      const currentWindow = getCurrentWindow();
      const nextUnlisten = await currentWindow.onCloseRequested(async (event) => {
        if (allowCloseRef.current || !runningRef.current) return;
        event.preventDefault();
        const confirmed = await confirm("Monitoring is still running. Stop it and exit?", {
          title: "Accuenergy Metering",
          kind: "warning",
          okLabel: "Stop and exit",
          cancelLabel: "Keep running",
        });
        if (!confirmed) return;
        const waitForEnd = new Promise<void>((resolve) => {
          monitorEndWaiters.current.add(resolve);
          window.setTimeout(resolve, Math.min(15_000, Math.max(7_000, config.timeoutSeconds * 11_000)));
        });
        await stop();
        await waitForEnd;
        allowCloseRef.current = true;
        await currentWindow.close();
      });
      if (cancelled) nextUnlisten();
      else unlisten = nextUnlisten;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [config.timeoutSeconds, runtime, stop]);

  const test = useCallback(async (): Promise<MeterSnapshot | null> => {
    if (runtime !== "desktop") {
      pushDemoLog("RS485 testing is only available in the desktop app.");
      return null;
    }
    setTesting(true);
    setProbeStatus(null);
    try {
      const snapshot = await testRs485();
      snapshot.summary.split("\n").forEach((line) => pushLog(line || " "));
      setValues(snapshot.values);
      setProbeStatus(snapshot.anyMeterReplied ? "RS485 OK" : "No reply");
      showNotice(
        snapshot.anyMeterReplied ? "success" : "warning",
        snapshot.anyMeterReplied ? "RS485 response received" : "No meter response",
        snapshot.message,
      );
      return snapshot;
    } catch (error) {
      setProbeStatus("No reply");
      pushLog(`RS485 test failed: ${String(error)}`);
      showNotice("error", "RS485 test failed", String(error));
      return null;
    } finally {
      setTesting(false);
    }
  }, [pushDemoLog, pushLog, runtime, showNotice]);

  const persistConfig = useCallback(
    async (nextConfig: AppConfig) => {
      setSavingConfig(true);
      try {
        const saved = runtime === "desktop" ? await saveConfig(nextConfig) : nextConfig;
        if (runtime === "browser") window.localStorage.setItem(BROWSER_CONFIG_KEY, JSON.stringify(saved));
        setConfig(saved);
        pushLog("Settings saved.");
      } finally {
        setSavingConfig(false);
      }
    },
    [pushLog, runtime],
  );

  const updateTheme = useCallback(
    async (themeName: AppConfig["themeName"]) => {
      const next = { ...config, themeName };
      setConfig(next);
      if (runtime === "browser") window.localStorage.setItem(BROWSER_CONFIG_KEY, JSON.stringify(next));
      if (runtime === "desktop") {
        try {
          await saveConfig(next);
        } catch (error) {
          pushLog(`Theme persistence failed: ${String(error)}`);
        }
      }
    },
    [config, pushLog, runtime],
  );

  const refreshPorts = useCallback(async () => {
    if (runtime !== "desktop") return;
    setRefreshingPorts(true);
    try {
      setPorts(await listSerialPorts());
    } catch (error) {
      pushLog(`Port enumeration failed: ${String(error)}`);
      showNotice("error", "Port enumeration failed", String(error));
    } finally {
      setRefreshingPorts(false);
    }
  }, [pushLog, runtime, showNotice]);

  const openReport = useCallback(async () => {
    if (runtime !== "desktop") {
      showNotice("warning", "Desktop feature", "Reports are generated from SQLite sessions in the desktop app.");
      return;
    }
    if (runningRef.current) {
      pendingReportRef.current = true;
      pushLog("Report requested; stopping the active session first.");
      await stop();
      return;
    }
    const target = sessions.find((session) => session.sessionId === currentSessionId) ?? sessions[0];
    if (!target) {
      showNotice("warning", "No session available", "Complete a monitoring session before generating a report.");
      return;
    }
    await generateAndOpen(target.sessionId);
  }, [currentSessionId, generateAndOpen, pushLog, runtime, sessions, showNotice, stop]);

  const openSessionReport = useCallback(
    async (sessionId: string) => generateAndOpen(sessionId),
    [generateAndOpen],
  );

  const exportCsv = useCallback(
    async (sessionId: string) => {
      if (runtime !== "desktop") return;
      setExportingSessionId(sessionId);
      try {
        const path = await exportSessionCsv(sessionId);
        pushLog(`CSV exported: ${path}`);
        await openPath(path);
        showNotice("success", "CSV exported", "The session export opened in your default CSV application.");
      } catch (error) {
        pushLog(`CSV export failed: ${String(error)}`);
        showNotice("error", "CSV export failed", String(error));
      } finally {
        setExportingSessionId(null);
      }
    },
    [pushLog, runtime, showNotice],
  );

  const openDataPath = useCallback(
    async (path: string | null | undefined) => {
      if (!path || runtime !== "desktop") return;
      try {
        await openPath(path);
      } catch (error) {
        showNotice("error", "Could not open path", String(error));
      }
    },
    [runtime, showNotice],
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  const usingDemo = runtime === "browser";
  const activeStatus = usingDemo ? demo.status : status;
  const activeValues = usingDemo ? demo.values : values;
  const activeGraph = usingDemo ? demo.graph : graph;
  const activeLatest = usingDemo ? demo.latest : latestUpdate;
  const activeSampleCount = usingDemo ? demo.sampleCount : sampleCount;
  const activeErrorCount = usingDemo ? demo.errorCount : errorCount;
  const activeLiveHz = usingDemo ? demo.liveHz : liveHz;
  const activeLogs = usingDemo ? demo.logLines : logLines;
  const isRunning = activeStatus === "connecting" || activeStatus === "running" || activeStatus === "stopping";
  const latestSession = useMemo(
    () => sessions.find((session) => session.sessionId === currentSessionId) ?? sessions[0] ?? null,
    [currentSessionId, sessions],
  );

  return {
    runtime,
    config,
    ports,
    paths,
    sessions,
    latestSession,
    status: activeStatus,
    values: activeValues,
    graph: activeGraph,
    latestUpdate: activeLatest,
    sampleCount: activeSampleCount,
    errorCount: activeErrorCount,
    liveHz: activeLiveHz,
    logLines: activeLogs,
    currentSessionId: usingDemo ? demo.latest?.sessionId ?? null : currentSessionId,
    lastReportPath,
    probeStatus,
    notice,
    testing,
    savingConfig,
    refreshingPorts,
    reporting,
    exportingSessionId,
    isRunning,
    start,
    stop,
    test,
    persistConfig,
    updateTheme,
    refreshPorts,
    refreshSessions,
    openReport,
    openSessionReport,
    exportCsv,
    openDataPath,
    dismissNotice,
  };
}
