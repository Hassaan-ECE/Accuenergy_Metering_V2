import { describe, expect, it } from "vitest";

import {
  appendGraphPoint,
  configSummary,
  DEFAULT_CONFIG,
  emptyGraph,
  emptyValues,
  graphFromReviewReadings,
  validateConfig,
} from "./types";

describe("meter config", () => {
  it("summarizes lab defaults", () => {
    expect(configSummary(DEFAULT_CONFIG)).toContain("COM5 @ 19200 baud");
    expect(configSummary(DEFAULT_CONFIG)).toContain("Device 1");
  });

  it("validates slave range and max-speed semantics", () => {
    expect(validateConfig({ ...DEFAULT_CONFIG, sampleHz: 0, runHours: 0 })).toBeNull();
    expect(validateConfig({ ...DEFAULT_CONFIG, deviceId: 248 })).toBe("Device ID must be between 1 and 247.");
  });
});

describe("live graph buffer", () => {
  it("keeps aligned meter series within the configured limit", () => {
    let graph = emptyGraph();
    for (let sample = 1; sample <= 4; sample += 1) {
      graph = appendGraphPoint(
        graph,
        {
          sessionId: "run_test",
          timestampMs: sample * 1_000,
          values: { ...emptyValues(), frequency_hz: 59 + sample, current_i1: sample },
          sampleCount: sample,
          errorCount: 0,
          liveHz: 1,
          message: "ok",
        },
        3,
      );
    }

    expect(graph.times).toEqual([2, 3, 4]);
    expect(graph.series.frequency_hz).toEqual([61, 62, 63]);
    expect(graph.series.current_i1).toEqual([2, 3, 4]);
    expect(graph.series.phase_voltage_v1).toEqual([null, null, null]);
  });
});

describe("review graph buffer", () => {
  it("converts saved readings into aligned graph series", () => {
    const graph = graphFromReviewReadings([
      {
        sessionId: "run_review",
        tsUnix: 10,
        tsIso: "2026-08-12T10:00:00Z",
        values: { ...emptyValues(), frequency_hz: 60, current_i1: 2 },
      },
      {
        sessionId: "run_review",
        tsUnix: 11,
        tsIso: "2026-08-12T10:00:01Z",
        values: { ...emptyValues(), frequency_hz: 60.1, current_i1: 2.1 },
      },
    ]);

    expect(graph.times).toEqual([10, 11]);
    expect(graph.series.frequency_hz).toEqual([60, 60.1]);
    expect(graph.series.current_i1).toEqual([2, 2.1]);
  });
});
