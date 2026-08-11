import { describe, expect, it } from "vitest";

import { formatMetric } from "./utils";

describe("formatMetric", () => {
  it("formats normal and missing values", () => {
    expect(formatMetric(60)).toBe("60");
    expect(formatMetric(120.1259)).toBe("120.126");
    expect(formatMetric(null)).toBe("—");
  });
});
