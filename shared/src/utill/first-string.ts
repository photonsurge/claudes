// Returns the first non-empty, trimmed string from the provided values (or "" if none).
export const firstString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return "";
};
