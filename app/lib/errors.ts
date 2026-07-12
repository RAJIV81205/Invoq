export function getErrorMessage(error: unknown, fallback = "Network error"): string {
  return error instanceof Error ? error.message : fallback;
}

export function getApiError(data: unknown, fallback = "Request failed"): string {
  if (typeof data === "object" && data !== null && "error" in data) {
    const value = (data as { error?: unknown }).error;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return fallback;
}
