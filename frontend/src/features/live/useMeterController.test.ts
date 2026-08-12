import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_CONFIG, emptyValues, type SessionRecord, type SessionSummary } from "./types";
import { useMeterController } from "./useMeterController";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => void>();
  return {
    listeners,
    exportSessionCsv: vi.fn(),
    generateReport: vi.fn(),
    getAppPaths: vi.fn(),
    getConfig: vi.fn(),
    getMonitorState: vi.fn(),
    isTauriRuntime: vi.fn(),
    listSerialPorts: vi.fn(),
    listSessions: vi.fn(),
    loadCsvReview: vi.fn(),
    loadSessionReview: vi.fn(),
    openPath: vi.fn(),
    saveConfig: vi.fn(),
    startMonitor: vi.fn(),
    stopMonitor: vi.fn(),
    testRs485: vi.fn(),
    listen: vi.fn(async (eventName: string, handler: (event: { payload: unknown }) => void) => {
      listeners.set(eventName, handler);
      return () => listeners.delete(eventName);
    }),
    onCloseRequested: vi.fn(async () => () => undefined),
    closeWindow: vi.fn(),
    confirm: vi.fn(),
    openDialog: vi.fn(),
  };
});

vi.mock("@/integrations/tauri/meterBridge", () => ({
  exportSessionCsv: mocks.exportSessionCsv,
  generateReport: mocks.generateReport,
  getAppPaths: mocks.getAppPaths,
  getConfig: mocks.getConfig,
  getMonitorState: mocks.getMonitorState,
  isTauriRuntime: mocks.isTauriRuntime,
  listSerialPorts: mocks.listSerialPorts,
  listSessions: mocks.listSessions,
  loadCsvReview: mocks.loadCsvReview,
  loadSessionReview: mocks.loadSessionReview,
  openPath: mocks.openPath,
  saveConfig: mocks.saveConfig,
  startMonitor: mocks.startMonitor,
  stopMonitor: mocks.stopMonitor,
  testRs485: mocks.testRs485,
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: mocks.closeWindow,
    onCloseRequested: mocks.onCloseRequested,
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: mocks.confirm, open: mocks.openDialog }));

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionId: "run_requested",
    startedAt: "2026-08-12T01:00:00-04:00",
    endedAt: null,
    status: "running",
    stopReason: null,
    sampleCount: 0,
    errorCount: 0,
    reportPath: null,
    config: DEFAULT_CONFIG,
    ...overrides,
  };
}

function finishedSummary(sessionId = "run_unrelated"): SessionSummary {
  return {
    sessionId,
    startedAt: "2026-08-12T01:00:00-04:00",
    endedAt: "2026-08-12T01:01:00-04:00",
    sampleCount: 10,
    errorCount: 0,
    stopReason: "Stopped by user",
    status: "stopped",
    databasePath: "C:\\data\\meter_log.db",
    reportPath: null,
  };
}

async function renderRunningController(initialSessions: SessionRecord[]) {
  mocks.listSessions.mockResolvedValueOnce(initialSessions);
  mocks.getMonitorState.mockResolvedValue({ running: true, sessionId: "run_requested" });
  const rendered = renderHook(() => useMeterController());
  await waitFor(() => expect(rendered.result.current.status).toBe("running"));
  await waitFor(() => expect(mocks.listeners.has("monitor-finished")).toBe(true));
  return rendered;
}

function emitFinished(payload: SessionSummary) {
  const listener = mocks.listeners.get("monitor-finished");
  if (!listener) throw new Error("monitor-finished listener was not registered");
  act(() => listener({ payload }));
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.isTauriRuntime.mockResolvedValue(true);
  mocks.getConfig.mockResolvedValue(DEFAULT_CONFIG);
  mocks.getAppPaths.mockResolvedValue({
    root: "C:\\data",
    settings: "C:\\data\\settings.json",
    database: "C:\\data\\meter_log.db",
    reports: "C:\\data\\reports",
    exports: "C:\\data\\exports",
  });
  mocks.listSerialPorts.mockResolvedValue([]);
  mocks.listSessions.mockResolvedValue([]);
  mocks.getMonitorState.mockResolvedValue({ running: false, sessionId: null });
  mocks.stopMonitor.mockResolvedValue(null);
  mocks.generateReport.mockResolvedValue("C:\\data\\reports\\report.html");
  mocks.exportSessionCsv.mockResolvedValue("C:\\data\\exports\\readings.csv");
  mocks.loadSessionReview.mockResolvedValue({
    source: "session",
    sourceLabel: "C:\\data\\meter_log.db",
    session: session({
      endedAt: "2026-08-12T01:01:00-04:00",
      status: "completed",
      stopReason: "Run duration reached",
      sampleCount: 2,
    }),
    readings: [
      {
        sessionId: "run_requested",
        tsUnix: 1,
        tsIso: "2026-08-12T01:00:00-04:00",
        values: { ...emptyValues(), frequency_hz: 60 },
      },
    ],
    originalReadingCount: 2,
    configAvailable: true,
  });
  mocks.loadCsvReview.mockResolvedValue({
    source: "csv",
    sourceLabel: "C:\\imports\\run_requested.csv",
    session: session({
      endedAt: "2026-08-12T01:01:00-04:00",
      status: "completed",
      stopReason: "Imported CSV",
      sampleCount: 1,
    }),
    readings: [
      {
        sessionId: "run_requested",
        tsUnix: 2,
        tsIso: "2026-08-12T01:00:01-04:00",
        values: { ...emptyValues(), frequency_hz: 59.9 },
      },
    ],
    originalReadingCount: 1,
    configAvailable: true,
  });
  mocks.openPath.mockResolvedValue(undefined);
  mocks.onCloseRequested.mockResolvedValue(() => undefined);
  mocks.confirm.mockResolvedValue(false);
  mocks.openDialog.mockResolvedValue(null);
});

afterEach(() => cleanup());

describe("pending report lifecycle", () => {
  it("generates the requested report immediately when a null stop reveals a finalized session", async () => {
    const runningSession = session();
    const finalizedSession = session({
      endedAt: "2026-08-12T01:01:00-04:00",
      status: "stopped",
      stopReason: "Stopped by user",
      sampleCount: 10,
    });
    mocks.listSessions.mockResolvedValue([finalizedSession]);
    const { result } = await renderRunningController([runningSession]);

    await act(async () => result.current.openReport());

    expect(mocks.stopMonitor).toHaveBeenCalledTimes(1);
    expect(mocks.generateReport).toHaveBeenCalledTimes(1);
    expect(mocks.generateReport).toHaveBeenCalledWith("run_requested");
    expect(mocks.openPath).toHaveBeenCalledTimes(1);
    expect(mocks.openPath).toHaveBeenCalledWith("C:\\data\\reports\\report.html");

    emitFinished(finishedSummary());
    expect(mocks.generateReport).toHaveBeenCalledTimes(1);
    expect(mocks.openPath).toHaveBeenCalledTimes(1);
  });

  it("clears pending intent when a null stop has no finalized matching session", async () => {
    const runningSession = session();
    mocks.listSessions.mockResolvedValue([runningSession]);
    const { result } = await renderRunningController([runningSession]);

    await act(async () => result.current.openReport());

    expect(mocks.stopMonitor).toHaveBeenCalledTimes(1);
    expect(mocks.generateReport).not.toHaveBeenCalled();
    expect(result.current.notice).toMatchObject({
      tone: "warning",
      title: "Report not ready",
    });
    expect(result.current.notice?.message).toContain("not finalized yet");

    emitFinished(finishedSummary());
    expect(mocks.generateReport).not.toHaveBeenCalled();
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it("clears pending intent when the stop request fails", async () => {
    const runningSession = session();
    mocks.stopMonitor.mockRejectedValueOnce(new Error("stop failed"));
    const { result } = await renderRunningController([runningSession]);

    await act(async () => result.current.openReport());

    expect(mocks.stopMonitor).toHaveBeenCalledTimes(1);
    expect(mocks.generateReport).not.toHaveBeenCalled();
    expect(mocks.openPath).not.toHaveBeenCalled();
    expect(result.current.notice).toMatchObject({
      tone: "error",
      title: "Stop request failed",
    });
    expect(result.current.notice?.message).toContain("stop failed");

    emitFinished(finishedSummary());
    expect(mocks.generateReport).not.toHaveBeenCalled();
    expect(mocks.openPath).not.toHaveBeenCalled();
  });
});

describe("CSV export", () => {
  it("exports and opens the selected finished session", async () => {
    const finalizedSession = session({
      endedAt: "2026-08-12T01:01:00-04:00",
      status: "completed",
      stopReason: "Run duration reached",
      sampleCount: 10,
    });
    mocks.listSessions.mockResolvedValue([finalizedSession]);
    const rendered = renderHook(() => useMeterController());
    await waitFor(() => expect(rendered.result.current.currentSessionId).toBe("run_requested"));

    await act(async () => rendered.result.current.exportCurrentCsv());

    expect(mocks.exportSessionCsv).toHaveBeenCalledWith("run_requested");
    expect(mocks.openPath).toHaveBeenCalledWith("C:\\data\\exports\\readings.csv");
    expect(rendered.result.current.notice).toMatchObject({
      tone: "success",
      title: "CSV exported",
    });
  });
});

describe("database session review", () => {
  it("loads saved values read-only and restores live-ready state on exit", async () => {
    const finalizedSession = session({
      endedAt: "2026-08-12T01:01:00-04:00",
      status: "completed",
      stopReason: "Run duration reached",
      sampleCount: 2,
    });
    mocks.listSessions.mockResolvedValue([finalizedSession]);
    const rendered = renderHook(() => useMeterController());
    await waitFor(() => expect(rendered.result.current.currentSessionId).toBe("run_requested"));

    await act(async () => rendered.result.current.loadReviewSession("run_requested"));

    expect(mocks.loadSessionReview).toHaveBeenCalledWith("run_requested");
    expect(rendered.result.current.isReviewing).toBe(true);
    expect(rendered.result.current.values.frequency_hz).toBe(60);
    expect(rendered.result.current.graph.times).toEqual([1]);

    await act(async () => rendered.result.current.start());
    await act(async () => rendered.result.current.test());
    expect(mocks.startMonitor).not.toHaveBeenCalled();
    expect(mocks.testRs485).not.toHaveBeenCalled();

    act(() => rendered.result.current.exitReview());
    expect(rendered.result.current.isReviewing).toBe(false);
    expect(rendered.result.current.graph.times).toEqual([]);
  });
});

describe("CSV review", () => {
  it("loads a selected exported CSV into review mode", async () => {
    mocks.openDialog.mockResolvedValueOnce("C:\\imports\\run_requested.csv");
    const rendered = renderHook(() => useMeterController());
    await waitFor(() => expect(rendered.result.current.runtime).toBe("desktop"));

    await act(async () => rendered.result.current.loadReviewCsv());

    expect(mocks.loadCsvReview).toHaveBeenCalledWith("C:\\imports\\run_requested.csv");
    expect(rendered.result.current.review?.source).toBe("csv");
    expect(rendered.result.current.values.frequency_hz).toBe(59.9);
    expect(rendered.result.current.graph.times).toEqual([2]);
    expect(rendered.result.current.notice).toMatchObject({
      tone: "success",
      title: "CSV loaded",
    });
  });

  it("does nothing when the file picker is cancelled", async () => {
    const rendered = renderHook(() => useMeterController());
    await waitFor(() => expect(rendered.result.current.runtime).toBe("desktop"));

    await act(async () => rendered.result.current.loadReviewCsv());

    expect(mocks.loadCsvReview).not.toHaveBeenCalled();
    expect(rendered.result.current.isReviewing).toBe(false);
  });
});
