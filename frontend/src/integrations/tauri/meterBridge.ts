/**
 * Tauri IPC bridge for Accuenergy Metering.
 * Commands are stubbed until the Rust monitor module is wired (see docs/PORT_PLAN.md).
 */

import type { AppConfig } from "@/features/live/types";

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

export async function isTauriRuntime(): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("ping");
    return true;
  } catch {
    return false;
  }
}

export async function listSerialPorts(): Promise<PortInfo[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<PortInfo[]>("list_serial_ports");
}

export async function getConfig(): Promise<AppConfig> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AppConfig>("get_config");
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("save_config", { config });
}

export async function getAppPaths(): Promise<AppPaths> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AppPaths>("get_app_paths");
}

export async function testRs485(): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("test_rs485");
}

export async function startMonitor(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("start_monitor");
}

export async function stopMonitor(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("stop_monitor");
}
