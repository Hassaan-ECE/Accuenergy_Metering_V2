export interface GraphDatasetExtent {
  first: number;
  last: number;
  length: number;
}

export function graphDatasetExtent(times: number[]): GraphDatasetExtent | null {
  const first = times[0];
  const last = times.at(-1);
  if (first == null || last == null || !Number.isFinite(first) || !Number.isFinite(last)) return null;
  return { first, last, length: times.length };
}

export function isZoomedXWindow(
  viewMin: number,
  viewMax: number,
  dataMin: number,
  dataMax: number,
  epsilonSeconds = 0.05,
): boolean {
  const view = viewMax - viewMin;
  const data = dataMax - dataMin;
  if (!(data > 0) || !(view > 0)) return false;
  return view + epsilonSeconds < data;
}

export function isNewDataset(
  previous: GraphDatasetExtent | null,
  next: GraphDatasetExtent | null,
): boolean {
  if (next === null) return previous !== null;
  if (previous === null) return true;
  if (next.first < previous.first - 0.001) return true;
  if (next.length + 5 < previous.length) return true;
  if (next.first > previous.last + 5) return true;
  return false;
}
