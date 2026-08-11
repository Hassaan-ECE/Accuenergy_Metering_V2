import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatMetric(value: number | null | undefined, decimals = 3): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "—";
  }
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (Math.abs(value) >= 1000) {
    return value.toPrecision(6).replace(/\.?0+$/, "");
  }
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}
