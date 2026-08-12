export type MonitorStatus = "idle" | "connecting" | "running" | "stopping" | "error";

export const METER_KEYS = [
  "frequency_hz",
  "phase_voltage_v1",
  "phase_voltage_v2",
  "phase_voltage_v3",
  "line_voltage_v12",
  "current_i1",
  "current_i2",
  "current_i3",
  "active_power_p1",
  "power_factor_pf1",
] as const;

export type MeterKey = (typeof METER_KEYS)[number];

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

export interface GraphBuffer {
  times: number[];
  series: Record<MeterKey, Array<number | null>>;
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

export interface SessionRecord {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  status: string;
  stopReason: string | null;
  sampleCount: number;
  errorCount: number;
  reportPath: string | null;
  config: AppConfig;
}

export interface ReviewReading {
  sessionId: string;
  tsUnix: number;
  tsIso: string;
  values: MeterValues;
}

export interface ReviewDataset {
  source: "session" | "csv";
  sourceLabel: string;
  session: SessionRecord;
  readings: ReviewReading[];
  originalReadingCount: number;
  configAvailable: boolean;
}

export interface SessionSummary {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  sampleCount: number;
  errorCount: number;
  stopReason: string;
  status: string;
  databasePath: string;
  reportPath: string | null;
}

export interface MonitorLog {
  timestampMs: number;
  message: string;
}

export interface MonitorFailure {
  kind: "connection" | "runtime";
  message: string;
  sessionId: string | null;
}

export interface MeterReading {
  key: MeterKey;
  label: string;
  address: number;
  unit: string;
  responded: boolean;
  ok: boolean;
  message: string;
  registers: number[] | null;
  value: number | null;
}

export interface MeterSnapshot {
  port: string;
  detectedPorts: string[];
  connected: boolean;
  anyMeterReplied: boolean;
  allReadsOk: boolean;
  message: string;
  readings: MeterReading[];
  values: MeterValues;
  summary: string;
}

export interface MeterCommSettings {
  protocol: number;
  parityCode: number;
  password: number;
  deviceId: number;
  baudrate: number;
}

export interface MeterConfigPreview {
  registerStart: number;
  registerCount: number;
  readFunctionCode: number;
  writeFunctionCode: number;
  defaultDeviceId: number;
  defaultBaudrate: number;
  before: MeterCommSettings;
  after: MeterCommSettings;
  summary: string;
}

export interface ApplyMeterDefaultsRequest {
  targetDeviceId: number;
  targetBaudrate: number;
  isolated: boolean;
}

export interface ApplyMeterDefaultsResult {
  before: MeterCommSettings;
  after: MeterCommSettings;
  verified: MeterCommSettings;
  config: AppConfig;
  summary: string;
}

export interface StartMonitorResult {
  sessionId: string;
  databasePath: string;
}

export interface MonitorRuntimeState {
  running: boolean;
  sessionId: string | null;
}

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

export function emptyGraph(): GraphBuffer {
  return {
    times: [],
    series: Object.fromEntries(METER_KEYS.map((key) => [key, []])) as unknown as GraphBuffer["series"],
  };
}

export function appendGraphPoint(graph: GraphBuffer, update: LiveUpdate, maximum = 1800): GraphBuffer {
  const times = [...graph.times, update.timestampMs / 1000];
  const series = Object.fromEntries(
    METER_KEYS.map((key) => [key, [...graph.series[key], update.values[key]]]),
  ) as unknown as GraphBuffer["series"];
  if (times.length <= maximum) return { times, series };
  const start = times.length - maximum;
  return {
    times: times.slice(start),
    series: Object.fromEntries(
      METER_KEYS.map((key) => [key, series[key].slice(start)]),
    ) as unknown as GraphBuffer["series"],
  };
}

export function graphFromReviewReadings(readings: ReviewReading[]): GraphBuffer {
  return {
    times: readings.map((reading) => reading.tsUnix),
    series: Object.fromEntries(
      METER_KEYS.map((key) => [key, readings.map((reading) => reading.values[key])]),
    ) as unknown as GraphBuffer["series"],
  };
}

export function configSummary(config: AppConfig): string {
  const sampleText = config.sampleHz === 0 ? "max speed" : `${config.sampleHz} Hz`;
  const runText = config.runHours === 0 ? "until stopped" : `${config.runHours} h`;
  return `${config.port} @ ${config.baudrate} baud  ·  Device ${config.deviceId}  ·  ${config.parity}/${config.stopBits}  ·  ${sampleText}  ·  ${runText}`;
}

export function validateConfig(config: AppConfig): string | null {
  if (!config.port.trim()) return "COM port is required.";
  if (!Number.isInteger(config.baudrate) || config.baudrate <= 0) return "Baud rate must be greater than 0.";
  if (!Number.isInteger(config.deviceId) || config.deviceId < 1 || config.deviceId > 247) {
    return "Device ID must be between 1 and 247.";
  }
  if (!(["N", "E", "O"] as const).includes(config.parity)) return "Parity must be N, E, or O.";
  if (config.stopBits !== 1 && config.stopBits !== 2) return "Stop bits must be 1 or 2.";
  if (!Number.isFinite(config.sampleHz) || config.sampleHz < 0) return "Sample rate cannot be negative.";
  if (!Number.isFinite(config.runHours) || config.runHours < 0) return "Run hours cannot be negative.";
  if (!Number.isInteger(config.commitEvery) || config.commitEvery <= 0) {
    return "Commit every must be greater than 0.";
  }
  if (!Number.isFinite(config.timeoutSeconds) || config.timeoutSeconds <= 0) {
    return "Timeout must be greater than 0.";
  }
  if (!Number.isInteger(config.retries) || config.retries < 0) return "Retries cannot be negative.";
  return null;
}
