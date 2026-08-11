import { useCallback, useEffect, useRef, useState } from "react";

import { emptyValues, type LiveUpdate, type MeterValues, type MonitorStatus } from "./types";

const MAX_POINTS = 1800;

interface GraphSeries {
  times: number[];
  values: number[];
}

export function useDemoLiveStream() {
  const [status, setStatus] = useState<MonitorStatus>("idle");
  const [latest, setLatest] = useState<LiveUpdate | null>(null);
  const [values, setValues] = useState<MeterValues>(emptyValues);
  const [graph, setGraph] = useState<GraphSeries>({ times: [], values: [] });
  const [logLines, setLogLines] = useState<string[]>(["Application ready."]);
  const [sampleCount, setSampleCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [liveHz, setLiveHz] = useState(0);
  const timerRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const countRef = useRef(0);

  const pushLog = useCallback((message: string) => {
    const stamp = new Date().toLocaleTimeString();
    setLogLines((prev) => [`[${stamp}] ${message}`, ...prev].slice(0, 200));
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setStatus("idle");
    setLiveHz(0);
    pushLog("Demo stream stopped.");
  }, [pushLog]);

  const start = useCallback(() => {
    if (timerRef.current !== null) {
      return;
    }
    startRef.current = Date.now();
    countRef.current = 0;
    setSampleCount(0);
    setErrorCount(0);
    setGraph({ times: [], values: [] });
    setStatus("running");
    pushLog("Demo stream started (no meter attached — synthetic data).");

    timerRef.current = window.setInterval(() => {
      countRef.current += 1;
      const t = Date.now() / 1000;
      const frequency = 60 + Math.sin(t / 8) * 0.05 + (Math.random() - 0.5) * 0.01;
      const v1 = 120 + Math.sin(t / 12) * 0.8;
      const i1 = 10 + Math.sin(t / 5) * 0.4;
      const p1 = v1 * i1;
      const nextValues: MeterValues = {
        frequency_hz: frequency,
        phase_voltage_v1: v1,
        phase_voltage_v2: v1 * 0.998,
        phase_voltage_v3: v1 * 1.002,
        line_voltage_v12: v1 * Math.sqrt(3),
        current_i1: i1,
        current_i2: i1 * 0.99,
        current_i3: i1 * 1.01,
        active_power_p1: p1,
        power_factor_pf1: 0.97 + Math.sin(t / 20) * 0.01,
      };
      const elapsed = Math.max((Date.now() - startRef.current) / 1000, 1);
      const update: LiveUpdate = {
        sessionId: `demo_${startRef.current}`,
        timestampMs: Date.now(),
        values: nextValues,
        sampleCount: countRef.current,
        errorCount: 0,
        liveHz: countRef.current / elapsed,
        message: `${frequency.toFixed(3)} Hz`,
      };
      setLatest(update);
      setValues(nextValues);
      setSampleCount(countRef.current);
      setLiveHz(update.liveHz);
      setGraph((prev) => {
        const times = [...prev.times, update.timestampMs / 1000];
        const freqs = [...prev.values, frequency];
        if (times.length > MAX_POINTS) {
          return {
            times: times.slice(times.length - MAX_POINTS),
            values: freqs.slice(freqs.length - MAX_POINTS),
          };
        }
        return { times, values: freqs };
      });
    }, 200);
  }, [pushLog]);

  useEffect(() => () => stop(), [stop]);

  return {
    status,
    latest,
    values,
    graph,
    logLines,
    sampleCount,
    errorCount,
    liveHz,
    start,
    stop,
    pushLog,
    isRunning: status === "running" || status === "connecting" || status === "stopping",
  };
}
