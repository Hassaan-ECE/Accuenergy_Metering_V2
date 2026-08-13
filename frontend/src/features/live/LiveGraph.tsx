import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";

import {
  graphDatasetExtent,
  isNewDataset,
  isZoomedXWindow,
  type GraphDatasetExtent,
} from "./LiveGraph.helpers";

export interface GraphLine {
  key: string;
  label: string;
  color: string;
  scale?: "y" | "y2";
  values: Array<number | null>;
}

interface LiveGraphProps {
  datasetId: string;
  lines: GraphLine[];
  theme: "light" | "dark";
  times: number[];
  title: string;
  unit: string;
  secondaryUnit?: string;
}

const EMPTY_WINDOW_SECONDS = 60;
const MAX_MOUNT_RETRIES = 30;
const MIN_X_RANGE_SECONDS = 2;
const PAN_DEADZONE_PIXELS = 6;

type LineDef = Pick<GraphLine, "color" | "key" | "label" | "scale">;

/** Keep axes/grid drawable when there are no samples yet. */
function alignedData(times: number[], lines: GraphLine[]): uPlot.AlignedData {
  if (times.length === 0) {
    const end = Math.floor(Date.now() / 1000);
    const start = end - EMPTY_WINDOW_SECONDS;
    return [[start, end], ...lines.map(() => [null, null])] as uPlot.AlignedData;
  }
  return [times, ...lines.map((line) => line.values)] as uPlot.AlignedData;
}

function scaleRange(_u: uPlot, dataMin: number | null, dataMax: number | null): [number, number] {
  if (
    dataMin == null ||
    dataMax == null ||
    !Number.isFinite(dataMin) ||
    !Number.isFinite(dataMax)
  ) {
    return [0, 1];
  }
  if (dataMin === dataMax) {
    const pad = Math.max(Math.abs(dataMin) * 0.05, 0.5);
    return [dataMin - pad, dataMax + pad];
  }
  return uPlot.rangeNum(dataMin, dataMax, 0.1, true) as [number, number];
}

/** Time-only tick labels (no calendar date). */
function formatTimeSplits(_u: uPlot, splits: number[]): string[] {
  return splits.map((value) => {
    if (value == null || !Number.isFinite(value)) return "";
    const date = new Date(value * 1000);
    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  });
}

function dataXBounds(u: uPlot): { min: number; max: number } | null {
  const xs = u.data[0];
  if (!xs || xs.length < 2) return null;
  const min = xs[0];
  const max = xs[xs.length - 1];
  if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max: max === min ? min + MIN_X_RANGE_SECONDS : max };
}

function syncZoomState(
  u: uPlot,
  bounds: { min: number; max: number } | null,
  onZoomChange: (zoomed: boolean) => void,
) {
  const scale = u.scales.x;
  const zoomed =
    bounds !== null &&
    scale.min != null &&
    scale.max != null &&
    isZoomedXWindow(scale.min, scale.max, bounds.min, bounds.max);
  onZoomChange(zoomed);
}

function resetPlotView(u: uPlot, onZoomChange: (zoomed: boolean) => void) {
  u.setData(u.data, true);
  syncZoomState(u, dataXBounds(u), onZoomChange);
}

function interactionPlugin(onZoomChange: (zoomed: boolean) => void): uPlot.Plugin {
  let removeWindowListeners: (() => void) | null = null;

  return {
    hooks: {
      ready: (u) => {
        const over = u.over;
        let pointerDown = false;
        let panStarted = false;
        let startX = 0;
        let startY = 0;
        let originMin = 0;
        let originMax = 0;

        const onWheel = (event: WheelEvent) => {
          event.preventDefault();
          const scale = u.scales.x;
          if (scale.min == null || scale.max == null) return;

          const rect = over.getBoundingClientRect();
          const px = event.clientX - rect.left;
          const anchor = u.posToVal(px, "x");
          const range = scale.max - scale.min;
          if (!(range > 0) || !Number.isFinite(anchor)) return;

          const factor = event.deltaY < 0 ? 0.85 : 1.18;
          const nextRange = Math.max(range * factor, MIN_X_RANGE_SECONDS);
          const bounds = dataXBounds(u);
          if (!bounds) return;

          if (nextRange >= bounds.max - bounds.min) {
            resetPlotView(u, onZoomChange);
            return;
          }

          const leftFrac = (anchor - scale.min) / range;
          let nextMin = anchor - leftFrac * nextRange;
          let nextMax = nextMin + nextRange;

          if (nextMin < bounds.min) {
            nextMin = bounds.min;
            nextMax = nextMin + nextRange;
          }
          if (nextMax > bounds.max) {
            nextMax = bounds.max;
            nextMin = nextMax - nextRange;
          }

          u.setScale("x", { min: nextMin, max: nextMax });
          syncZoomState(u, bounds, onZoomChange);
        };

        const onMouseDown = (event: MouseEvent) => {
          if (event.button !== 0) return;
          const scale = u.scales.x;
          if (scale.min == null || scale.max == null) return;
          pointerDown = true;
          panStarted = false;
          startX = event.clientX;
          startY = event.clientY;
          originMin = scale.min;
          originMax = scale.max;
        };

        const onMouseMove = (event: MouseEvent) => {
          if (!pointerDown) return;
          if (!panStarted) {
            const movement = Math.hypot(event.clientX - startX, event.clientY - startY);
            if (movement < PAN_DEADZONE_PIXELS) return;
            panStarted = true;
            over.style.cursor = "grabbing";
          }
          const width = over.clientWidth || 1;
          const range = originMax - originMin;
          const delta = -((event.clientX - startX) / width) * range;
          let nextMin = originMin + delta;
          let nextMax = originMax + delta;
          const bounds = dataXBounds(u);
          if (!bounds) return;
          if (!isZoomedXWindow(originMin, originMax, bounds.min, bounds.max)) {
            resetPlotView(u, onZoomChange);
            return;
          }
          if (nextMin < bounds.min) {
            nextMin = bounds.min;
            nextMax = nextMin + range;
          }
          if (nextMax > bounds.max) {
            nextMax = bounds.max;
            nextMin = nextMax - range;
          }
          u.setScale("x", { min: nextMin, max: nextMax });
          syncZoomState(u, bounds, onZoomChange);
        };

        const endPan = () => {
          if (!pointerDown) return;
          pointerDown = false;
          panStarted = false;
          over.style.cursor = "grab";
        };

        const onDblClick = () => {
          resetPlotView(u, onZoomChange);
        };

        over.addEventListener("wheel", onWheel, { passive: false });
        over.addEventListener("mousedown", onMouseDown);
        over.addEventListener("mousemove", onMouseMove);
        over.addEventListener("dblclick", onDblClick);
        window.addEventListener("mouseup", endPan);
        window.addEventListener("blur", endPan);
        over.style.cursor = "grab";

        removeWindowListeners = () => {
          over.removeEventListener("wheel", onWheel);
          over.removeEventListener("mousedown", onMouseDown);
          over.removeEventListener("mousemove", onMouseMove);
          over.removeEventListener("dblclick", onDblClick);
          window.removeEventListener("mouseup", endPan);
          window.removeEventListener("blur", endPan);
        };
      },
      destroy: () => {
        removeWindowListeners?.();
        removeWindowListeners = null;
      },
    },
  };
}

function buildOptions(
  width: number,
  height: number,
  theme: "light" | "dark",
  unit: string,
  secondaryUnit: string | undefined,
  lines: LineDef[],
  onZoomChange: (zoomed: boolean) => void,
): uPlot.Options {
  const isDark = theme === "dark";
  const grid = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const text = isDark ? "rgba(255,255,255,0.58)" : "rgba(0,0,0,0.55)";
  const hasSecondaryScale = lines.some((line) => line.scale === "y2");

  return {
    width,
    height,
    padding: [4, 8, 12, 4],
    cursor: {
      show: true,
      x: true,
      y: false,
      drag: { setScale: false, x: false, y: false },
      points: { show: false },
    },
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
    legend: { show: false },
    plugins: [interactionPlugin(onZoomChange)],
    scales: {
      x: { time: true },
      y: { auto: true, range: scaleRange },
      ...(hasSecondaryScale ? { y2: { auto: true, range: scaleRange } } : {}),
    },
    axes: [
      {
        stroke: text,
        grid: { stroke: grid, width: 1 },
        ticks: { stroke: grid },
        size: 36,
        gap: 6,
        space: 60,
        font: "10px DM Sans",
        values: formatTimeSplits,
      },
      {
        scale: "y",
        stroke: text,
        grid: { stroke: grid, width: 1 },
        ticks: { stroke: grid },
        size: 48,
        gap: 5,
        space: 36,
        font: "10px DM Sans",
        label: unit,
        labelFont: "600 10px DM Sans",
        labelSize: 14,
      },
      ...(hasSecondaryScale
        ? [
            {
              scale: "y2",
              side: 1,
              stroke: text,
              grid: { show: false },
              ticks: { stroke: grid },
              size: 42,
              gap: 5,
              space: 36,
              font: "10px DM Sans",
              label: secondaryUnit ?? "",
              labelFont: "600 10px DM Sans",
              labelSize: 14,
            } satisfies uPlot.Axis,
          ]
        : []),
    ],
    series: [
      {},
      ...lines.map((line) => ({
        label: line.label,
        scale: line.scale ?? "y",
        stroke: line.color,
        width: 2,
        spanGaps: false,
        points: { show: false },
      })),
    ],
  };
}

export function LiveGraph({ datasetId, lines, secondaryUnit, theme, times, title, unit }: LiveGraphProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const dataRef = useRef({ datasetId, lines, times });
  const datasetRef = useRef<{ id: string; extent: GraphDatasetExtent | null } | null>(null);
  const zoomedRef = useRef(false);
  const hiddenKeysRef = useRef<Set<string>>(new Set());
  const [zoomed, setZoomed] = useState(false);
  const [hiddenState, setHiddenState] = useState<{ lineSignature: string; keys: Set<string> }>(() => ({
    lineSignature: "",
    keys: new Set(),
  }));

  const lineSignature = lines.map((line) => `${line.key}:${line.label}:${line.color}:${line.scale ?? "y"}`).join("|");
  const lineDefinitions: LineDef[] = lines.map(({ color, key, label, scale }) => ({ color, key, label, scale }));
  const hiddenKeys = useMemo(
    () => (hiddenState.lineSignature === lineSignature ? hiddenState.keys : new Set<string>()),
    [hiddenState, lineSignature],
  );

  const onZoomChange = useCallback((next: boolean) => {
    if (zoomedRef.current === next) return;
    zoomedRef.current = next;
    setZoomed(next);
  }, []);

  useEffect(() => {
    dataRef.current = { datasetId, lines, times };
  }, [datasetId, lines, times]);

  useEffect(() => {
    hiddenKeysRef.current = hiddenKeys;
  }, [hiddenKeys]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const defs = dataRef.current.lines.map(({ color, key, label, scale }) => ({ color, key, label, scale }));
    let plot: uPlot | null = null;
    let observer: ResizeObserver | null = null;
    let mountFrame: number | null = null;
    let mountRetries = 0;
    let cancelled = false;

    const mount = () => {
      mountFrame = null;
      if (cancelled || plot || !hostRef.current) return;
      const node = hostRef.current;
      const plotWidth = Math.max(Math.floor(node.clientWidth), 1);
      const plotHeight = Math.max(Math.floor(node.clientHeight), 1);
      if ((plotWidth < 8 || plotHeight < 8) && node.isConnected) {
        if (mountRetries < MAX_MOUNT_RETRIES) {
          mountRetries += 1;
          mountFrame = requestAnimationFrame(mount);
        }
        return;
      }

      plot = new uPlot(
        buildOptions(plotWidth, plotHeight, theme, unit, secondaryUnit, defs, onZoomChange),
        alignedData(dataRef.current.times, dataRef.current.lines),
        node,
      );
      plotRef.current = plot;
      datasetRef.current = {
        id: dataRef.current.datasetId,
        extent: graphDatasetExtent(dataRef.current.times),
      };
      onZoomChange(false);

      defs.forEach((line, index) => {
        plot?.setSeries(index + 1, { show: !hiddenKeysRef.current.has(line.key) }, false);
      });
      plot.redraw();

    };

    observer = new ResizeObserver(() => {
      if (!hostRef.current) return;
      if (!plotRef.current) {
        mount();
        return;
      }
      plotRef.current.setSize({
        width: Math.max(Math.floor(hostRef.current.clientWidth), 1),
        height: Math.max(Math.floor(hostRef.current.clientHeight), 1),
      });
    });
    observer.observe(host);
    mountFrame = requestAnimationFrame(mount);

    return () => {
      cancelled = true;
      if (mountFrame !== null) cancelAnimationFrame(mountFrame);
      observer?.disconnect();
      plot?.destroy();
      if (plotRef.current === plot) plotRef.current = null;
    };
  }, [lineSignature, onZoomChange, secondaryUnit, theme, unit]);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const data = alignedData(times, lines);
    const nextExtent = graphDatasetExtent(times);
    const previousDataset = datasetRef.current;
    const datasetChanged =
      previousDataset === null ||
      previousDataset.id !== datasetId ||
      isNewDataset(previousDataset.extent, nextExtent);
    datasetRef.current = { id: datasetId, extent: nextExtent };

    if (datasetChanged) {
      onZoomChange(false);
      plot.setData(data, true);
      return;
    }
    if (zoomedRef.current) {
      plot.setData(data, false);
      plot.redraw();
      return;
    }
    plot.setData(data, true);
  }, [datasetId, lines, onZoomChange, times]);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    lineDefinitions.forEach((line, index) => {
      if (index + 1 >= plot.series.length) return;
      plot.setSeries(index + 1, { show: !hiddenKeys.has(line.key) }, false);
    });
    plot.redraw(true, true);
  }, [hiddenKeys, lineSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleLine = (key: string) => {
    setHiddenState((current) => {
      const keys = current.lineSignature === lineSignature ? current.keys : new Set<string>();
      const visibleCount = lines.filter((line) => !keys.has(line.key)).length;
      const next = new Set(keys);
      if (next.has(key)) {
        next.delete(key);
        return { lineSignature, keys: next };
      }
      if (visibleCount <= 1) return current;
      next.add(key);
      return { lineSignature, keys: next };
    });
  };

  const resetView = () => {
    const plot = plotRef.current;
    if (!plot) return;
    resetPlotView(plot, onZoomChange);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 px-2.5 pb-0.5 pt-1.5">
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground" title={title}>
          {title}
        </p>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5">
          {zoomed ? (
            <button
              className="rounded px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              onClick={resetView}
              title="Reset zoom (or double-click plot)"
              type="button"
            >
              Reset
            </button>
          ) : null}
          {lines.map((line) => {
            const hidden = hiddenKeys.has(line.key);
            const canToggle = lines.length > 1;
            return (
              <button
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1 py-0.5 text-[9px] transition ${
                  hidden ? "text-muted-foreground/45 line-through" : "text-muted-foreground hover:text-foreground"
                } ${canToggle ? "cursor-pointer hover:bg-muted/70" : "cursor-default"}`}
                disabled={!canToggle}
                key={line.key}
                onClick={() => {
                  if (canToggle) toggleLine(line.key);
                }}
                title={canToggle ? (hidden ? `Show ${line.label}` : `Hide ${line.label}`) : line.label}
                type="button"
              >
                <span
                  className="h-0.5 w-2.5 rounded-full"
                  style={{ backgroundColor: line.color, opacity: hidden ? 0.35 : 1 }}
                />
                {line.label}
              </button>
            );
          })}
        </div>
      </div>
      <div
        className="min-h-0 flex-1 overflow-hidden"
        ref={hostRef}
        title="Scroll to zoom · drag to pan · double-click to reset"
      />
    </div>
  );
}
