import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  appendGraphPoint,
  DEFAULT_CONFIG,
  emptyGraph,
  emptyValues,
  hasDisplayValues,
  graphFromReviewReadings,
  type AppConfig,
  type ApplyMeterDefaultsRequest,
  type GraphBuffer,
  type LiveUpdate,
  type MeterDetectResult,
  type MeterSnapshot,
  type MeterConfigPreview,
  type MeterValues,
  type MonitorFailure,
  type MonitorLog,
  type MonitorStatus,
  type ReviewDataset,
  type SessionRecord,
  type SessionSummary,
} from "./types";
import { useDemoLiveStream } from "./useDemoLiveStream";
import {
  applyMeterDefaults,
  detectMeter,
  exportSessionCsv,
  generateReport,
  getAppPaths,
  getConfig,
  getMonitorState,
  isTauriRuntime,
  listSerialPorts,
  listSessions,
  loadCsvReview,
  loadSessionReview,
  openPath,
  previewMeterDefaults,
  recoverOrphanedSessions,
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

type StopOutcome = "requested" | "inactive" | "failed";

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
  const [detecting, setDetecting] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [refreshingPorts, setRefreshingPorts] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [exportingSessionId, setExportingSessionId] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewDataset | null>(null);
  const [loadingReview, setLoadingReview] = useState(false);
  const [meterConfigPreview, setMeterConfigPreview] = useState<MeterConfigPreview | null>(null);
  const [meterConfigAction, setMeterConfigAction] = useState<"idle" | "preview" | "apply">("idle");
  const pendingReportRef = useRef(false);
  const runningRef = useRef(false);
  const startingRef = useRef(false);
  const meterConfigActionRef = useRef<"idle" | "preview" | "apply">("idle");
  const testingRef = useRef(false);
  const detectingRef = useRef(false);
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
    return next;
  }, []);

  const refreshSessionsPreservingSelection = useCallback(async () => {
    const next = await listSessions();
    setSessions(next);
    const latest = next.find((session) => session.endedAt !== null) ?? null;
    if (latest) setLastReportPath(latest.reportPath);
    return next;
  }, []);

  const chooseSavePath = useCallback(
    async (options: {
      title: string;
      defaultFileName: string;
      defaultFolder?: string | null;
      filters: Array<{ name: string; extensions: string[] }>;
    }) => {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const folder = options.defaultFolder ?? paths?.root;
      const defaultPath = folder ? `${folder}\\${options.defaultFileName}` : options.defaultFileName;
      const selected = await save({
        title: options.title,
        defaultPath,
        filters: options.filters,
      });
      if (!selected || Array.isArray(selected)) return null;
      return selected;
    },
    [paths?.root],
  );

  const openUserFile = useCallback(async (path: string) => {
    try {
      const { openPath: openChosenPath } = await import("@tauri-apps/plugin-opener");
      await openChosenPath(path);
    } catch {
      try {
        await openPath(path);
      } catch {
        // The user already has the full path in the notice if the OS opener is unavailable.
      }
    }
  }, []);

  const generateAndOpen = useCallback(
    async (sessionId: string) => {
      const dest = await chooseSavePath({
        title: "Save HTML report",
        defaultFileName: `accuenergy_report_${sessionId}.html`,
        defaultFolder: paths?.reports,
        filters: [{ name: "HTML report", extensions: ["html"] }],
      });
      if (!dest) return;
      setReporting(true);
      try {
        const path = await generateReport(sessionId, dest);
        setLastReportPath(path);
        pushLog(`Report saved: ${path}`);
        await openUserFile(path);
        await refreshSessions();
        showNotice("success", "Report saved", `Saved to ${path} and opened if a browser was available.`);
      } catch (error) {
        const message = String(error);
        pushLog(`Report failed: ${message}`);
        showNotice("error", "Report failed", message);
      } finally {
        setReporting(false);
      }
    },
    [chooseSavePath, openUserFile, paths?.reports, pushLog, refreshSessions, showNotice],
  );

  const resolveMonitorEnd = useCallback(() => {
    for (const resolve of monitorEndWaiters.current) resolve();
    monitorEndWaiters.current.clear();
  }, []);

  useEffect(() => {
    runningRef.current = status === "connecting" || status === "running" || status === "stopping";
  }, [status]);

  useEffect(() => {
    meterConfigActionRef.current = meterConfigAction;
  }, [meterConfigAction]);

  useEffect(() => {
    testingRef.current = testing;
  }, [testing]);

  useEffect(() => {
    detectingRef.current = detecting;
  }, [detecting]);

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
        const [configResult, [loadedPaths, loadedPorts, initialSessions, monitorState]] = await Promise.all([
          getConfig()
            .then((value) => ({ value, error: null }))
            .catch((error: unknown) => ({ value: null, error })),
          Promise.all([getAppPaths(), listSerialPorts(), listSessions(), getMonitorState()]),
        ]);
        if (cancelled) return;
        let loadedSessions = initialSessions;
        let recoveredSessionIds: string[] = [];
        if (!monitorState.running) {
          recoveredSessionIds = await recoverOrphanedSessions();
          if (recoveredSessionIds.length > 0) loadedSessions = await listSessions();
        }
        if (cancelled) return;
        if (configResult.value) setConfig(configResult.value);
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
          pushLog(
            configResult.error
              ? "Desktop backend connected, but saved settings could not be loaded."
              : "Desktop backend connected; persisted settings and sessions loaded.",
          );
        }
        if (recoveredSessionIds.length > 0) {
          const message = `Recovered ${recoveredSessionIds.length} leftover session(s): ${recoveredSessionIds.join(", ")}`;
          pushLog(message);
          showNotice("success", "Previous session recovered", message);
        }
        if (configResult.error) {
          const message = `${String(configResult.error)} The saved settings were not replaced with defaults. Open Settings to correct or overwrite the file.`;
          pushLog(`Saved settings require attention: ${String(configResult.error)}`);
          showNotice("error", "Saved settings could not be loaded", message);
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
          if (payload.kind === "connection") {
            void getMonitorState()
              .then((monitorState) => {
                if (!monitorState.running || monitorState.sessionId !== payload.sessionId) {
                  setCurrentSessionId((current) => (current === payload.sessionId ? null : current));
                }
              })
              .catch(() => {
                setCurrentSessionId((current) => (current === payload.sessionId ? null : current));
              });
          }
          pushLog(`${payload.kind === "connection" ? "Connection" : "Monitoring"} error: ${payload.message}`);
          showNotice("error", payload.kind === "connection" ? "Meter not connected" : "Monitoring failed", payload.message);
          void (payload.kind === "connection" ? refreshSessionsPreservingSelection() : refreshSessions());
        }),
      ]);
      if (cancelled) next.forEach((unlisten) => unlisten());
      else unlisteners.push(...next);
    })();
    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [generateAndOpen, pushLog, refreshSessions, refreshSessionsPreservingSelection, resolveMonitorEnd, runtime, showNotice]);

  const start = useCallback(async () => {
    if (review) {
      showNotice("warning", "Review mode is read-only", "Exit review before starting a new monitoring session.");
      return;
    }
    if (runtime === "browser") {
      startDemo();
      return;
    }
    if (runtime !== "desktop") return;
    if (
      startingRef.current ||
      runningRef.current ||
      status === "connecting" ||
      status === "running" ||
      status === "stopping"
    ) {
      showNotice("warning", "Monitoring is already active", "Stop the active session before starting another one.");
      return;
    }
    startingRef.current = true;
    pendingReportRef.current = false;
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
      try {
        const monitorState = await getMonitorState();
        if (monitorState.running) {
          setStatus("running");
          setCurrentSessionId(monitorState.sessionId);
          pushLog(`Start request reported an error, but the backend is monitoring ${monitorState.sessionId ?? "an active session"}: ${String(error)}`);
          showNotice("warning", "Monitoring is already active", String(error));
          return;
        }
      } catch (stateError) {
        pushLog(`Could not confirm monitor state after the start error: ${String(stateError)}`);
      }
      setStatus("error");
      pushLog(`Could not start monitor: ${String(error)}`);
      showNotice("error", "Could not start monitor", String(error));
    } finally {
      startingRef.current = false;
    }
  }, [config.baudrate, config.port, pushLog, review, runtime, showNotice, startDemo, status]);

  const stop = useCallback(async (): Promise<StopOutcome> => {
    if (runtime === "browser") {
      stopDemo();
      return "inactive";
    }
    if (runtime !== "desktop") return "inactive";
    setStatus("stopping");
    try {
      const sessionId = await stopMonitor();
      if (sessionId) {
        pushLog("Stop requested; waiting for the current Modbus read to finish.");
        return "requested";
      }
      pendingReportRef.current = false;
      setStatus("idle");
      resolveMonitorEnd();
      return "inactive";
    } catch (error) {
      pendingReportRef.current = false;
      setStatus("error");
      pushLog(`Stop request failed: ${String(error)}`);
      showNotice("error", "Stop request failed", String(error));
      return "failed";
    }
  }, [pushLog, resolveMonitorEnd, runtime, showNotice, stopDemo]);

  useEffect(() => {
    if (runtime !== "desktop") return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const currentWindow = getCurrentWindow();
      const nextUnlisten = await currentWindow.onCloseRequested((event) => {
        if (allowCloseRef.current) return;
        if (meterConfigActionRef.current !== "idle" || testingRef.current || detectingRef.current) {
          event.preventDefault();
          showNotice(
            "warning",
            "Serial operation in progress",
            "Wait for Test, Detect, or meter configuration to finish, then close.",
          );
          return;
        }
        if (!runningRef.current) return;

        // preventDefault must stay synchronous. Confirm/stop run after that.
        event.preventDefault();
        void (async () => {
          let confirmed = true;
          try {
            const { confirm } = await import("@tauri-apps/plugin-dialog");
            confirmed = await confirm("Monitoring is still running. Stop it and exit?", {
              title: "Accuenergy Metering",
              kind: "warning",
              okLabel: "Stop and exit",
              cancelLabel: "Keep running",
            });
          } catch {
            confirmed = true;
          }
          if (!confirmed) return;
          const waitForEnd = new Promise<void>((resolve) => {
            monitorEndWaiters.current.add(resolve);
            const readWaitMs = config.timeoutSeconds * (config.retries + 1) * 1_000;
            window.setTimeout(resolve, Math.min(20_000, Math.max(3_000, readWaitMs + 2_000)));
          });
          await stop();
          await waitForEnd;
          allowCloseRef.current = true;
          await currentWindow.close();
        })();
      });
      if (cancelled) nextUnlisten();
      else unlisten = nextUnlisten;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [config.retries, config.timeoutSeconds, runtime, showNotice, stop]);

  const test = useCallback(async (): Promise<MeterSnapshot | null> => {
    if (review) {
      showNotice("warning", "Review mode is read-only", "Exit review before testing the meter connection.");
      return null;
    }
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
  }, [pushDemoLog, pushLog, review, runtime, showNotice]);

  const detect = useCallback(async (): Promise<MeterDetectResult | null> => {
    if (review) {
      showNotice("warning", "Review mode is read-only", "Exit review before detecting a meter.");
      return null;
    }
    if (runtime !== "desktop") {
      pushDemoLog("Meter detect is only available in the desktop app.");
      return null;
    }
    setDetecting(true);
    setProbeStatus(null);
    try {
      const result = await detectMeter();
      result.summary.split("\n").forEach((line) => pushLog(line || " "));
      if (result.config) setConfig(result.config);
      setProbeStatus(result.found ? "RS485 OK" : "No reply");
      showNotice(
        result.found ? "success" : "warning",
        result.found
          ? "Meter detected"
          : result.summary.includes("CDM21228")
            ? "Serial driver may be required"
            : "No meter found",
        result.found
          ? `Using ${result.config?.port ?? "the current port"}, device ${result.config?.deviceId ?? "?"}, ${result.config?.baudrate ?? "?"} baud.`
          : result.summary,
      );
      return result;
    } catch (error) {
      setProbeStatus("No reply");
      pushLog(`Meter detect failed: ${String(error)}`);
      showNotice("error", "Meter detect failed", String(error));
      return null;
    } finally {
      setDetecting(false);
    }
  }, [pushDemoLog, pushLog, review, runtime, showNotice]);

  const previewMeterConfig = useCallback(
    async (targetDeviceId: number, targetBaudrate: number): Promise<MeterConfigPreview | null> => {
      if (review) {
        showNotice("warning", "Review mode is read-only", "Exit review before configuring the meter.");
        return null;
      }
      if (runningRef.current) {
        showNotice("warning", "Monitoring is active", "Stop monitoring before configuring meter communication settings.");
        return null;
      }
      if (runtime !== "desktop") {
        showNotice("warning", "Desktop feature", "Meter configuration requires the desktop app and a serial connection.");
        return null;
      }
      meterConfigActionRef.current = "preview";
      setMeterConfigAction("preview");
      setMeterConfigPreview(null);
      try {
        const preview = await previewMeterDefaults(targetDeviceId, targetBaudrate);
        setMeterConfigPreview(preview);
        preview.summary.split("\n").forEach((line) => pushLog(line));
        showNotice("success", "Meter settings read", "Dry-run complete. Review the before/after registers before applying.");
        return preview;
      } catch (error) {
        const message = String(error);
        setMeterConfigPreview(null);
        message.split("\n").forEach((line) => pushLog(line));
        showNotice("error", "Could not read meter settings", message);
        return null;
      } finally {
        meterConfigActionRef.current = "idle";
        setMeterConfigAction("idle");
      }
    },
    [pushLog, review, runtime, showNotice],
  );

  const applyMeterConfig = useCallback(
    async (request: ApplyMeterDefaultsRequest): Promise<boolean> => {
      if (review) {
        showNotice("warning", "Review mode is read-only", "Exit review before configuring the meter.");
        return false;
      }
      if (runningRef.current) {
        showNotice("warning", "Monitoring is active", "Stop monitoring before configuring meter communication settings.");
        return false;
      }
      if (runtime !== "desktop") return false;
      if (!request.isolated) {
        showNotice("warning", "Isolation required", "Isolate this meter from the RS485 daisy chain before applying.");
        return false;
      }
      const { confirm } = await import("@tauri-apps/plugin-dialog");
      const confirmed = await confirm(
        `This writes the meter's communication registers and changes how it talks on the RS485 bus.\n\nTarget: device ${request.targetDeviceId}, ${request.targetBaudrate} baud, 8N1.\n\nConfirm the meter is isolated from the daisy chain before continuing.`,
        {
          title: "Configure meter communication",
          kind: "warning",
          okLabel: "Write and verify",
          cancelLabel: "Cancel",
        },
      );
      if (!confirmed) return false;

      meterConfigActionRef.current = "apply";
      setMeterConfigAction("apply");
      try {
        const result = await applyMeterDefaults(request);
        result.summary.split("\n").forEach((line) => pushLog(line));
        setConfig(result.config);
        setProbeStatus(null);
        setMeterConfigPreview(null);
        showNotice(
          "success",
          "Meter configured and verified",
          `The meter and app now use ${result.config.port}, device ${result.config.deviceId}, ${result.config.baudrate} baud, 8N1.`,
        );
        return true;
      } catch (error) {
        const message = String(error);
        setMeterConfigPreview(null);
        message.split("\n").forEach((line) => pushLog(line));
        showNotice("error", "Meter configuration failed", message);
        return false;
      } finally {
        meterConfigActionRef.current = "idle";
        setMeterConfigAction("idle");
      }
    },
    [pushLog, review, runtime, showNotice],
  );

  const clearMeterConfigPreview = useCallback(() => setMeterConfigPreview(null), []);

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
    if (review?.source === "csv") {
      showNotice("warning", "Report unavailable", "Imported CSV data is read-only and is not linked to a database session.");
      return;
    }
    if (runningRef.current) {
      const requestedSessionId = currentSessionId;
      pendingReportRef.current = true;
      pushLog("Report requested; stopping the active session first.");
      const outcome = await stop();
      if (outcome === "requested") return;
      pendingReportRef.current = false;
      if (outcome === "failed") return;

      try {
        const refreshedSessions = await refreshSessions();
        const finalizedSession = refreshedSessions.find(
          (session) =>
            session.sessionId === requestedSessionId &&
            session.endedAt !== null &&
            session.status !== "running",
        );
        if (finalizedSession) {
          await generateAndOpen(finalizedSession.sessionId);
          return;
        }
      } catch (error) {
        const message = `Could not refresh sessions after the monitor stopped: ${String(error)}`;
        pushLog(message);
        showNotice("error", "Report unavailable", message);
        return;
      }

      const message = requestedSessionId
        ? `Session ${requestedSessionId} is not finalized yet. Wait for monitoring to finish, then generate the report again.`
        : "The backend no longer has an active monitor and no finalized session matches this report request. Refresh Sessions and try again.";
      pushLog(`Report not generated: ${message}`);
      showNotice("warning", "Report not ready", message);
      return;
    }
    const target =
      review?.session ??
      sessions.find(
        (session) =>
          session.sessionId === currentSessionId && session.endedAt !== null && session.status !== "running",
      ) ??
      null;
    if (!target) {
      showNotice(
        "warning",
        "No finalized session selected",
        "Select a finished session before generating a report.",
      );
      return;
    }
    await generateAndOpen(target.sessionId);
  }, [currentSessionId, generateAndOpen, pushLog, refreshSessions, review, runtime, sessions, showNotice, stop]);

  const openSessionReport = useCallback(
    async (sessionId: string) => generateAndOpen(sessionId),
    [generateAndOpen],
  );

  const exportCsv = useCallback(
    async (sessionId: string) => {
      if (runtime !== "desktop") return;
      const dest = await chooseSavePath({
        title: "Save session CSV",
        defaultFileName: `accuenergy_readings_${sessionId}.csv`,
        defaultFolder: paths?.exports,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!dest) return;
      setExportingSessionId(sessionId);
      try {
        const path = await exportSessionCsv(sessionId, dest);
        const settingsPath = path.replace(/\.csv$/i, ".settings.json");
        pushLog(`CSV exported: ${path}`);
        pushLog(`Session settings saved: ${settingsPath}`);
        await openUserFile(path);
        showNotice(
          "success",
          "CSV exported",
          `Readings saved to ${path}. Session settings saved once beside it as ${settingsPath}.`,
        );
      } catch (error) {
        pushLog(`CSV export failed: ${String(error)}`);
        showNotice("error", "CSV export failed", String(error));
      } finally {
        setExportingSessionId(null);
      }
    },
    [chooseSavePath, openUserFile, paths?.exports, pushLog, runtime, showNotice],
  );

  const exportCurrentCsv = useCallback(async () => {
    if (review?.source === "csv") {
      showNotice("warning", "Already reviewing CSV", "The loaded data is already an exported CSV file.");
      return;
    }
    const target =
      review?.session ??
      sessions.find(
        (session) =>
          session.sessionId === currentSessionId &&
          session.endedAt !== null &&
          session.status !== "running" &&
          session.sampleCount > 0,
      ) ??
      null;
    if (!target) {
      showNotice("warning", "No finished session", "Complete a monitoring session before exporting CSV.");
      return;
    }
    await exportCsv(target.sessionId);
  }, [currentSessionId, exportCsv, review, sessions, showNotice]);

  const loadReviewSession = useCallback(
    async (sessionId: string) => {
      if (runtime !== "desktop") {
        showNotice("warning", "Desktop feature", "Saved session review is available in the desktop app.");
        return;
      }
      if (runningRef.current) {
        showNotice("warning", "Monitoring is active", "Stop monitoring before loading a saved session.");
        return;
      }
      setLoadingReview(true);
      try {
        const dataset = await loadSessionReview(sessionId);
        setReview(dataset);
        pushLog(
          `Reviewing ${dataset.session.sessionId}: ${dataset.readings.length.toLocaleString()} displayed of ${dataset.originalReadingCount.toLocaleString()} readings.`,
        );
        showNotice("success", "Session loaded", `${dataset.session.sessionId} is open in read-only review mode.`);
      } catch (error) {
        pushLog(`Session review failed: ${String(error)}`);
        showNotice("error", "Could not load session", String(error));
      } finally {
        setLoadingReview(false);
      }
    },
    [pushLog, runtime, showNotice],
  );

  const loadReviewCsv = useCallback(async () => {
    if (runtime !== "desktop") {
      showNotice("warning", "Desktop feature", "CSV review is available in the desktop app.");
      return;
    }
    if (runningRef.current) {
      showNotice("warning", "Monitoring is active", "Stop monitoring before loading a CSV file.");
      return;
    }
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      title: "Load Accuenergy session CSV",
      defaultPath: paths?.exports,
      multiple: false,
      directory: false,
      filters: [{ name: "Accuenergy CSV", extensions: ["csv"] }],
    });
    if (!selected || Array.isArray(selected)) return;

    setLoadingReview(true);
    try {
      const dataset = await loadCsvReview(selected);
      setReview(dataset);
      pushLog(
        `Loaded CSV ${selected}: ${dataset.readings.length.toLocaleString()} displayed of ${dataset.originalReadingCount.toLocaleString()} readings.`,
      );
      showNotice("success", "CSV loaded", `${dataset.session.sessionId} is open in read-only review mode.`);
    } catch (error) {
      pushLog(`CSV review failed: ${String(error)}`);
      showNotice("error", "Could not load CSV", String(error));
    } finally {
      setLoadingReview(false);
    }
  }, [paths?.exports, pushLog, runtime, showNotice]);

  const exitReview = useCallback(() => {
    if (!review) return;
    pushLog(`Exited review mode for ${review.session.sessionId}.`);
    setReview(null);
  }, [pushLog, review]);

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

  const clearDisplay = useCallback(() => {
    if (runtime === "browser") {
      demo.clear();
      setProbeStatus(null);
      return;
    }
    if (review) setReview(null);
    setValues(emptyValues());
    setGraph(emptyGraph());
    setLatestUpdate(null);
    setSampleCount(0);
    setErrorCount(0);
    setLiveHz(0);
    setProbeStatus(null);
    if (status === "error") setStatus("idle");
    pushLog("Live display cleared.");
  }, [demo, pushLog, review, runtime, status]);

  const usingDemo = runtime === "browser";
  const reviewGraph = useMemo(() => (review ? graphFromReviewReadings(review.readings) : null), [review]);
  const reviewValues = review?.readings.at(-1)?.values ?? null;
  const activeStatus = usingDemo ? demo.status : status;
  const activeValues = reviewValues ?? (usingDemo ? demo.values : values);
  const activeGraph = reviewGraph ?? (usingDemo ? demo.graph : graph);
  const activeLatest = review ? null : usingDemo ? demo.latest : latestUpdate;
  const activeSampleCount = review ? review.session.sampleCount : usingDemo ? demo.sampleCount : sampleCount;
  const activeErrorCount = review ? review.session.errorCount : usingDemo ? demo.errorCount : errorCount;
  const activeLiveHz = review ? 0 : usingDemo ? demo.liveHz : liveHz;
  const activeLogs = usingDemo ? demo.logLines : logLines;
  const isRunning = activeStatus === "connecting" || activeStatus === "running" || activeStatus === "stopping";
  const liveHasData =
    graph.times.length > 0 ||
    sampleCount > 0 ||
    errorCount > 0 ||
    hasDisplayValues(values) ||
    probeStatus !== null;
  const demoHasData =
    demo.graph.times.length > 0 || demo.sampleCount > 0 || hasDisplayValues(demo.values);
  const canClear = !isRunning && (review !== null || (usingDemo ? demoHasData : liveHasData));
  const latestSession = useMemo(
    () => review?.session ?? sessions.find((session) => session.sessionId === currentSessionId) ?? sessions[0] ?? null,
    [currentSessionId, review, sessions],
  );

  return {
    runtime,
    config,
    ports,
    paths,
    sessions,
    latestSession,
    review,
    isReviewing: review !== null,
    status: activeStatus,
    values: activeValues,
    graph: activeGraph,
    latestUpdate: activeLatest,
    sampleCount: activeSampleCount,
    errorCount: activeErrorCount,
    liveHz: activeLiveHz,
    logLines: activeLogs,
    currentSessionId: review?.session.sessionId ?? (usingDemo ? demo.latest?.sessionId ?? null : currentSessionId),
    lastReportPath,
    probeStatus,
    notice,
    testing,
    detecting,
    savingConfig,
    refreshingPorts,
    reporting,
    exportingSessionId,
    loadingReview,
    meterConfigPreview,
    meterConfigAction,
    isRunning,
    canClear,
    start,
    stop,
    clearDisplay,
    test,
    detect,
    previewMeterConfig,
    applyMeterConfig,
    clearMeterConfigPreview,
    persistConfig,
    updateTheme,
    refreshPorts,
    refreshSessions,
    openReport,
    openSessionReport,
    exportCsv,
    exportCurrentCsv,
    loadReviewSession,
    loadReviewCsv,
    exitReview,
    openDataPath,
    dismissNotice,
  };
}
