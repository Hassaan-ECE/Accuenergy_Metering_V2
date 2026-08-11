import { describe, expect, it } from "vitest";

import { configSummary, DEFAULT_CONFIG, validateConfig } from "./types";

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
