/**
 * Safe positive-integer parser for pagination query parameters (M-11).
 * Prevents NaN (e.g. `?limit=abc`) from bypassing `Math.min`/`Math.max`
 * and translating to unbounded MongoDB `.limit(0)` / full-collection scans.
 */
export function parsePositiveInt(
  value: unknown,
  fallback: number,
  max: number,
): number {
  let parsed: number;
  if (typeof value === "number") {
    parsed = Math.trunc(value);
  } else if (typeof value === "string") {
    parsed = Number.parseInt(value.trim(), 10);
  } else {
    return Math.min(Math.max(fallback, 1), max);
  }

  if (!Number.isFinite(parsed) || parsed < 1) {
    return Math.min(Math.max(fallback, 1), max);
  }
  return Math.min(parsed, max);
}
