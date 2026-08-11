export type MonitorStatus = "idle" | "connecting" | "running" | "stopping" | "error";

export interface MeterValues {
  frequency_hz: number | null;
  phase_voltage_v1: number | null;
  phase_voltage_v2: number | null;
  phase_voltage_v3: number | null;
  line_voltage_v12: number | null;
  current_i1: number | null;
  current_i2: number | null;
  current_i3: number | null;
  active_power_p1: number | null;
  power_factor_pf1: number | null;
}

export interface LiveUpdate {
  sessionId: string;
  timestampMs: number;
  values: MeterValues;
  sampleCount: number;
  errorCount: number;
  liveHz: number;
  message: string;
}

export interface AppConfig {
  themeName: "light" | "dark";
  port: string;
  baudrate: number;
  deviceId: number;
  parity: "N" | "E" | "O";
  stopBits: 1 | 2;
  sampleHz: number;
  runHours: number;
  commitEvery: number;
  timeoutSeconds: number;
  retries: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  themeName: "light",
  port: "COM5",
  baudrate: 19200,
  deviceId: 1,
  parity: "N",
  stopBits: 1,
  sampleHz: 1,
  runHours: 24,
  commitEvery: 50,
  timeoutSeconds: 1,
  retries: 1,
};

export function emptyValues(): MeterValues {
  return {
    frequency_hz: null,
    phase_voltage_v1: null,
    phase_voltage_v2: null,
    phase_voltage_v3: null,
    line_voltage_v12: null,
    current_i1: null,
    current_i2: null,
    current_i3: null,
    active_power_p1: null,
    power_factor_pf1: null,
  };
}

export function configSummary(config: AppConfig): string {
  const sampleText = config.sampleHz === 0 ? "manual max" : `${config.sampleHz} Hz`;
  const runText = config.runHours === 0 ? "until stopped" : `${config.runHours} h`;
  return `${config.port} @ ${config.baudrate} baud  ·  Device ${config.deviceId}  ·  ${config.parity}/${config.stopBits}  ·  ${sampleText}  ·  ${runText}`;
}
