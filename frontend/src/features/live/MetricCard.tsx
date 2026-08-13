import { cn, formatMetric } from "@/shared/lib/utils";

interface MetricCardProps {
  label: string;
  unit?: string;
  value?: number | null;
  /** When set, shown instead of a numeric value (e.g. status text). */
  text?: string;
  large?: boolean;
  status?: "normal" | "error" | "ok";
}

export function MetricCard({
  label,
  unit,
  value,
  text,
  large = false,
  status = "normal",
}: MetricCardProps) {
  const display =
    text ??
    (value === null || value === undefined ? (status === "error" ? "ERR" : "—") : formatMetric(value));

  return (
    <div className="rounded-lg border border-border bg-muted/40 px-2 py-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span
          className={cn(
            "font-semibold tabular-nums tracking-tight",
            large ? "text-xl" : "text-lg",
            status === "error" && "text-destructive-foreground",
            status === "ok" && "text-success-foreground",
          )}
        >
          {display}
        </span>
        {unit ? <span className="text-[11px] font-medium text-muted-foreground">{unit}</span> : null}
      </div>
    </div>
  );
}
