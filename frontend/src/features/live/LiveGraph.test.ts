import { describe, expect, it } from "vitest";

import { isNewDataset, isZoomedXWindow, type GraphDatasetExtent } from "./LiveGraph.helpers";

const extent = (first: number, last: number, length: number): GraphDatasetExtent => ({
  first,
  last,
  length,
});

describe("isZoomedXWindow", () => {
  it("treats the full data extent as follow mode", () => {
    expect(isZoomedXWindow(0, 100, 0, 100)).toBe(false);
  });

  it("detects a meaningfully smaller X window", () => {
    expect(isZoomedXWindow(25, 75, 0, 100)).toBe(true);
  });

  it("ignores differences within the zoom epsilon", () => {
    expect(isZoomedXWindow(0, 99.96, 0, 100)).toBe(false);
    expect(isZoomedXWindow(0, 100.04, 0, 100)).toBe(false);
  });
});

describe("isNewDataset", () => {
  it("detects the first points after an empty graph", () => {
    expect(isNewDataset(null, extent(100, 101, 2))).toBe(true);
  });

  it("keeps a growing live run in the same dataset", () => {
    expect(isNewDataset(extent(100, 109, 10), extent(100, 110, 11))).toBe(false);
  });

  it("keeps a sliding 1,800-point live window in the same dataset", () => {
    expect(isNewDataset(extent(100, 1_899, 1_800), extent(101, 1_900, 1_800))).toBe(false);
  });

  it("detects a graph becoming empty", () => {
    expect(isNewDataset(extent(100, 109, 10), null)).toBe(true);
  });

  it("detects time moving backward", () => {
    expect(isNewDataset(extent(100, 109, 10), extent(90, 99, 10))).toBe(true);
  });

  it("detects a new first point after a discontinuity", () => {
    expect(isNewDataset(extent(100, 109, 10), extent(115, 116, 2))).toBe(true);
  });
});
