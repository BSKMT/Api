/**
 * Recursively strip MongoDB operator keys (starting with $) from an object.
 * Prevents NoSQL operator injection via qs-parsed query parameters.
 *
 * Usage: call sanitizeQuery(filter) before passing to Mongoose find().
 */
export function sanitizeQuery<T extends Record<string, unknown>>(
  obj: T,
  depth = 0,
): T {
  if (!obj || typeof obj !== "object" || Array.isArray(obj) || depth > 10) {
    return obj;
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip keys that start with $ (MongoDB operators)
    if (key.startsWith("$")) continue;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      cleaned[key] = sanitizeQuery(value as Record<string, unknown>, depth + 1);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned as T;
}

/** Ensure a query parameter is a plain string (not an injected object). */
export function ensureString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return undefined;
}
