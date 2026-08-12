import type {
  ApplyMeterDefaultsRequest,
  ApplyMeterDefaultsResult,
  AppConfig,
  MeterConfigPreview,
  MeterSnapshot,
  MonitorRuntimeState,
  ReviewDataset,
  SessionRecord,
  StartMonitorResult,
} from "@/features/live/types";

export interface PortInfo {
  name: string;
  description?: string;
}

export interface AppPaths {
  root: string;
  settings: string;
  database: string;
  reports: string;
  exports: string;
}

async function invokeCommand<Result>(command: string, args?: Record<string, unknown>): Promise<Result> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Result>(command, args);
}

export async function isTauriRuntime(): Promise<boolean> {
  try {
    await invokeCommand<string>("ping");
    return true;
  } catch {
    return false;
  }
}

export function listSerialPorts(): Promise<PortInfo[]> {
  return invokeCommand<PortInfo[]>("list_serial_ports");
}

export function getConfig(): Promise<AppConfig> {
  return invokeCommand<AppConfig>("get_config");
}

export function saveConfig(config: AppConfig): Promise<AppConfig> {
  return invokeCommand<AppConfig>("save_config", { config });
}

export function getAppPaths(): Promise<AppPaths> {
  return invokeCommand<AppPaths>("get_app_paths");
}

export function testRs485(): Promise<MeterSnapshot> {
  return invokeCommand<MeterSnapshot>("test_rs485");
}

export function previewMeterDefaults(targetDeviceId: number, targetBaudrate: number): Promise<MeterConfigPreview> {
  return invokeCommand<MeterConfigPreview>("preview_meter_defaults", { targetDeviceId, targetBaudrate });
}

export function applyMeterDefaults(request: ApplyMeterDefaultsRequest): Promise<ApplyMeterDefaultsResult> {
  return invokeCommand<ApplyMeterDefaultsResult>("apply_meter_defaults", { request });
}

export function startMonitor(): Promise<StartMonitorResult> {
  return invokeCommand<StartMonitorResult>("start_monitor");
}

export function stopMonitor(): Promise<string | null> {
  return invokeCommand<string | null>("stop_monitor");
}

export function getMonitorState(): Promise<MonitorRuntimeState> {
  return invokeCommand<MonitorRuntimeState>("get_monitor_state");
}

export function recoverOrphanedSessions(): Promise<string[]> {
  return invokeCommand<string[]>("recover_orphaned_sessions");
}

export function listSessions(): Promise<SessionRecord[]> {
  return invokeCommand<SessionRecord[]>("list_sessions");
}

export function getLatestSession(): Promise<SessionRecord | null> {
  return invokeCommand<SessionRecord | null>("get_latest_session");
}

export function loadSessionReview(sessionId: string): Promise<ReviewDataset> {
  return invokeCommand<ReviewDataset>("load_session_review", { sessionId });
}

export function loadCsvReview(path: string): Promise<ReviewDataset> {
  return invokeCommand<ReviewDataset>("load_csv_review", { path });
}

export function generateReport(sessionId: string): Promise<string> {
  return invokeCommand<string>("generate_report", { sessionId });
}

export function exportSessionCsv(sessionId: string): Promise<string> {
  return invokeCommand<string>("export_session_csv", { sessionId });
}

export function openPath(path: string): Promise<void> {
  return invokeCommand<void>("open_path", { path });
}
