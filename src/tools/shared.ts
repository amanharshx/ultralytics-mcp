/** Shared helpers for tool logic. */

/** Coerce unknown JSON into a record for safe field access. */
export function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === "object"
    ? (data as Record<string, unknown>)
    : {};
}

/** Return `data[field]` as an array of records, or []. */
export function listField(
  data: unknown,
  field: string,
): Record<string, unknown>[] {
  const value = asRecord(data)[field];
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/** Render a summary field like Python's `dict.get(key)`: missing -> "None". */
export function pyField(value: unknown): string {
  return value === undefined || value === null ? "None" : String(value);
}

/** Render a count like Python's `dict.get(key, "?")`: absent -> "?", present-null -> "None". */
export function pyCount(fields: Record<string, unknown>, key: string): string {
  if (!(key in fields)) {
    return "?";
  }
  const value = fields[key];
  return value === undefined || value === null ? "None" : String(value);
}
