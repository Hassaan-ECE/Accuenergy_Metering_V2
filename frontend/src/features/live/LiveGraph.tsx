import { useEffect, useRef } from "react";
import uPlot from "uplot";

export interface GraphLine {
  key: string;
  label: string;
  color: string;
  scale?: "y" | "y2";
  values: Array<number | null>;
}

interface LiveGraphProps {
  lines: GraphLine[];
  theme: "light" | "dark";
  times: number[];
  title: string;
  unit: string;
  secondaryUnit?: string;
}

function alignedData(times: number[], lines: GraphLine[]): uPlot.AlignedData {
  return [times, ...lines.map((line) => line.values)] as uPlot.AlignedData;
}

function buildOptions(
  width: number,
  height: number,
  theme: "light" | "dark",
  unit: string,
  secondaryUnit: string | undefined,
  lines: GraphLine[],
): uPlot.Options {
  const isDark = theme === "dark";
  const grid = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const text = isDark ? "rgba(255,255,255,0.58)" : "rgba(0,0,0,0.55)";
  const hasSecondaryScale = lines.some((line) => line.scale === "y2");
  return {
    width,
    height,
    padding: [4, 8, 12, 4],
    cursor: { show: true, x: true, y: true },
    legend: { show: false },
    scales: {
      x: { time: true },
      y: { auto: true },
      ...(hasSecondaryScale ? { y2: { auto: true } } : {}),
    },
    axes: [
      {
        stroke: text,
        grid: { stroke: grid, width: 1 },
        ticks: { stroke: grid },
        size: 38,
        gap: 6,
        space: 70,
        font: "10px DM Sans",
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

export function LiveGraph({ lines, secondaryUnit, theme, times, title, unit }: LiveGraphProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const dataRef = useRef({ lines, times });
  const lineDefinitionsRef = useRef(lines.map(({ color, key, label, scale }) => ({ color, key, label, scale, values: [] })));
  const lineSignature = lines.map((line) => `${line.key}:${line.label}:${line.color}:${line.scale ?? "y"}`).join("|");

  useEffect(() => {
    dataRef.current = { lines, times };
    lineDefinitionsRef.current = lines.map(({ color, key, label, scale }) => ({ color, key, label, scale, values: [] }));
  }, [lines, times]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const currentData = dataRef.current;
    const lineDefinitions = lineDefinitionsRef.current;
    const plotWidth = Math.max(Math.floor(host.clientWidth), 1);
    const plotHeight = Math.max(Math.floor(host.clientHeight), 1);
    const plot = new uPlot(
      buildOptions(plotWidth, plotHeight, theme, unit, secondaryUnit, lineDefinitions),
      alignedData(currentData.times, currentData.lines),
      host,
    );
    plotRef.current = plot;
    const observer = new ResizeObserver(() => {
      if (!hostRef.current || !plotRef.current) return;
      plotRef.current.setSize({
        width: Math.max(Math.floor(hostRef.current.clientWidth), 1),
        height: Math.max(Math.floor(hostRef.current.clientHeight), 1),
      });
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [lineSignature, secondaryUnit, theme, title, unit]);

  useEffect(() => {
    plotRef.current?.setData(alignedData(times, lines));
  }, [lines, times]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 px-1 pb-1">
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground" title={title}>
          {title}
        </p>
        <div className="flex min-w-0 flex-wrap justify-end gap-x-2 gap-y-0.5 text-[9px] text-muted-foreground">
          {lines.map((line) => (
            <span className="inline-flex items-center gap-1 whitespace-nowrap" key={line.key}>
              <span className="h-0.5 w-2.5 rounded-full" style={{ backgroundColor: line.color }} />
              {line.label}
            </span>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden" ref={hostRef} />
    </div>
  );
}
