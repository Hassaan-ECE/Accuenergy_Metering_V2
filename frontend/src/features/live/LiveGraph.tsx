import { useEffect, useRef } from "react";
import uPlot from "uplot";

interface LiveGraphProps {
  times: number[];
  values: number[];
  theme: "light" | "dark";
  title?: string;
  unit?: string;
}

function buildOptions(width: number, height: number, theme: "light" | "dark", title: string, unit: string): uPlot.Options {
  const isDark = theme === "dark";
  const grid = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const text = isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.5)";
  const stroke = isDark ? "#60a5fa" : "#2563eb";

  return {
    width,
    height,
    title,
    cursor: { show: true, x: true, y: true },
    scales: {
      x: { time: true },
      y: { auto: true },
    },
    axes: [
      {
        stroke: text,
        grid: { stroke: grid, width: 1 },
        ticks: { stroke: grid },
      },
      {
        stroke: text,
        grid: { stroke: grid, width: 1 },
        ticks: { stroke: grid },
        label: unit,
      },
    ],
    series: [
      {},
      {
        label: title,
        stroke,
        width: 2,
        spanGaps: false,
      },
    ],
  };
}

export function LiveGraph({ times, values, theme, title = "Frequency", unit = "Hz" }: LiveGraphProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const width = Math.max(host.clientWidth, 320);
    const height = Math.max(host.clientHeight, 220);
    const plot = new uPlot(buildOptions(width, height, theme, title, unit), [times, values], host);
    plotRef.current = plot;

    const observer = new ResizeObserver(() => {
      if (!hostRef.current || !plotRef.current) {
        return;
      }
      plotRef.current.setSize({
        width: Math.max(hostRef.current.clientWidth, 320),
        height: Math.max(hostRef.current.clientHeight, 220),
      });
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
    // Recreate when theme/title/unit change; data updates use setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, title, unit]);

  useEffect(() => {
    plotRef.current?.setData([times, values]);
  }, [times, values]);

  return <div className="h-full min-h-[220px] w-full" ref={hostRef} />;
}
