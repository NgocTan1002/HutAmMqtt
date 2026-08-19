export function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid PostgreSQL timestamp: ${value}`);
  return parsed.toISOString();
}
