/**
 * Recursively strip MongoDB operator keys (starting with $) from objects and nested arrays.
 * Prevents NoSQL operator injection via qs-parsed query parameters.
 */
function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 10 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    return sanitizeQuery(value as Record<string, unknown>, depth + 1);
  }
  return value;
}

export function sanitizeQuery<T extends Record<string, unknown>>(
  obj: T,
  depth = 0,
): T {
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || depth > 10) {
    return obj;
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("$")) continue;
    cleaned[key] = sanitizeValue(value, depth + 1);
  }
  return cleaned as T;
}

/** Ensure a query parameter is a plain string (not an injected object). */
export function ensureString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return undefined;
}
