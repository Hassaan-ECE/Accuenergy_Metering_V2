import { useEffect, useRef } from "react";
import uPlot from "uplot";

export interface GraphLine {
  key: string;
  label: string;
  color: string;
  values: Array<number | null>;
}

interface LiveGraphProps {
  lines: GraphLine[];
  theme: "light" | "dark";
  times: number[];
  title: string;
  unit: string;
}

function alignedData(times: number[], lines: GraphLine[]): uPlot.AlignedData {
  return [times, ...lines.map((line) => line.values)] as uPlot.AlignedData;
}

function buildOptions(
  width: number,
  height: number,
  theme: "light" | "dark",
  title: string,
  unit: string,
  lines: GraphLine[],
): uPlot.Options {
  const isDark = theme === "dark";
  const grid = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const text = isDark ? "rgba(255,255,255,0.58)" : "rgba(0,0,0,0.55)";
  return {
    width,
    height,
    title,
    cursor: { show: true, x: true, y: true },
    legend: { show: lines.length > 1 },
    scales: { x: { time: true }, y: { auto: true } },
    axes: [
      { stroke: text, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid } },
      { stroke: text, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid }, label: unit },
    ],
    series: [
      {},
      ...lines.map((line) => ({
        label: line.label,
        stroke: line.color,
        width: 2,
        spanGaps: false,
        points: { show: false },
      })),
    ],
  };
}

export function LiveGraph({ lines, theme, times, title, unit }: LiveGraphProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);
  const dataRef = useRef({ lines, times });
  const lineDefinitionsRef = useRef(lines.map(({ color, key, label }) => ({ color, key, label, values: [] })));
  const lineSignature = lines.map((line) => `${line.key}:${line.label}:${line.color}`).join("|");

  useEffect(() => {
    dataRef.current = { lines, times };
    lineDefinitionsRef.current = lines.map(({ color, key, label }) => ({ color, key, label, values: [] }));
  }, [lines, times]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const currentData = dataRef.current;
    const lineDefinitions = lineDefinitionsRef.current;
    const plot = new uPlot(
      buildOptions(Math.max(host.clientWidth, 320), Math.max(host.clientHeight, 230), theme, title, unit, lineDefinitions),
      alignedData(currentData.times, currentData.lines),
      host,
    );
    plotRef.current = plot;
    const observer = new ResizeObserver(() => {
      if (!hostRef.current || !plotRef.current) return;
      plotRef.current.setSize({
        width: Math.max(hostRef.current.clientWidth, 320),
        height: Math.max(hostRef.current.clientHeight, 230),
      });
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [lineSignature, theme, title, unit]);

  useEffect(() => {
    plotRef.current?.setData(alignedData(times, lines));
  }, [lines, times]);

  return <div className="h-full min-h-[230px] w-full" ref={hostRef} />;
}
