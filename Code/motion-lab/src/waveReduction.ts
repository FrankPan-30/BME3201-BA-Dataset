/** Keep the temporal order of both extrema in each screen-pixel bucket. A -1 breaks a path at a sample gap. */
export function extremaIndices(values: Float64Array, pixels: number): number[] {
  if (!values.length || !Number.isFinite(pixels) || pixels <= 0) return [];
  const count = Math.min(values.length, Math.max(1, Math.ceil(pixels)));
  const points: number[] = [];
  for (let bin = 0; bin < count; bin++) {
    const from = Math.floor(bin * values.length / count);
    const to = Math.floor((bin + 1) * values.length / count);
    for (let i = from; i < to;) {
      if (!Number.isFinite(values[i])) {
        if (points.length && points[points.length - 1] !== -1) points.push(-1);
        i++;
        continue;
      }
      const first = i;
      let low = i;
      let high = i;
      do {
        if (values[i] < values[low]) low = i;
        if (values[i] > values[high]) high = i;
        i++;
      } while (i < to && Number.isFinite(values[i]));
      if (first === 0 && low !== first && high !== first) points.push(first);
      points.push(Math.min(low, high));
      if (low !== high) points.push(Math.max(low, high));
      if (i === values.length && low !== i - 1 && high !== i - 1) points.push(i - 1);
    }
  }
  return points;
}
