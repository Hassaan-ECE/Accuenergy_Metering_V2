import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LiveGraph } from "./LiveGraph";

interface MockAxis {
  stroke?: string | ((plot: MockPlotInstance, axisIndex: number) => string);
}

interface MockPlotInstance {
  axes: MockAxis[];
  data: unknown[];
  destroy: ReturnType<typeof vi.fn>;
  redraw: ReturnType<typeof vi.fn>;
}

const uPlotMock = vi.hoisted(() => ({
  constructor: vi.fn(),
  instances: [] as MockPlotInstance[],
}));

vi.mock("uplot", () => {
  class MockUPlot implements MockPlotInstance {
    axes: MockAxis[];
    data: unknown[];
    destroy = vi.fn();
    over = document.createElement("div");
    redraw = vi.fn();
    scales = { x: { min: 1, max: 2 } };
    series: unknown[];
    setData = vi.fn((data: unknown[]) => {
      this.data = data;
    });
    setScale = vi.fn();
    setSeries = vi.fn();
    setSize = vi.fn();
    posToVal = vi.fn(() => 1);

    constructor(
      options: { axes?: MockAxis[]; series: unknown[] },
      data: unknown[],
      target: HTMLElement,
    ) {
      this.axes = options.axes ?? [];
      this.data = data;
      this.series = options.series;
      target.appendChild(this.over);
      uPlotMock.constructor();
      uPlotMock.instances.push(this);
    }
  }

  return { default: MockUPlot };
});

class ResizeObserverStub implements ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

beforeEach(() => {
  uPlotMock.constructor.mockClear();
  uPlotMock.instances.length = 0;
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(320);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LiveGraph theme lifecycle", () => {
  it("keeps the active plot and its data when the theme changes", () => {
    const props = {
      datasetId: "desktop:live",
      lines: [
        {
          key: "frequency_hz",
          label: "Frequency",
          color: "#2563eb",
          values: [60, 60.01],
        },
      ],
      times: [1, 2],
      title: "Frequency",
      unit: "Hz",
    };
    const rendered = render(<LiveGraph {...props} theme="dark" />);
    const plot = uPlotMock.instances[0];

    expect(plot).toBeDefined();
    expect(uPlotMock.constructor).toHaveBeenCalledTimes(1);
    expect(plot?.data[0]).toEqual([1, 2]);
    const redrawsBeforeThemeChange = plot?.redraw.mock.calls.length ?? 0;

    act(() => rendered.rerender(<LiveGraph {...props} theme="light" />));

    expect(uPlotMock.constructor).toHaveBeenCalledTimes(1);
    expect(plot?.destroy).not.toHaveBeenCalled();
    expect(plot?.data[0]).toEqual([1, 2]);
    expect(plot?.redraw.mock.calls.length).toBeGreaterThan(redrawsBeforeThemeChange);
    const axisStroke = plot?.axes[0]?.stroke;
    expect(typeof axisStroke).toBe("function");
    if (typeof axisStroke === "function" && plot) {
      expect(axisStroke(plot, 0)).toBe("rgba(0,0,0,0.55)");
    }
  });
});
