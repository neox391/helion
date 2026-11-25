export function formatBytes(bytes: number): string {
  const sign = bytes < 0 ? "−" : "";
  const n = Math.abs(bytes);
  const gib = 1024 ** 3;
  const mib = 1024 ** 2;
  if (n >= gib) return `${sign}${(n / gib).toFixed(2)} Go`;
  return `${sign}${(n / mib).toFixed(0)} Mo`;
}

/** Bandwidth ceiling, labeled as such by callers. Not a frame time. */
export function formatCeiling(seconds: number): string {
  const ms = seconds * 1000;
  if (ms < 0.01) return `${(ms * 1000).toFixed(1)} µs`;
  if (ms < 10) return `${ms.toFixed(2)} ms`;
  return `${ms.toFixed(1)} ms`;
}
