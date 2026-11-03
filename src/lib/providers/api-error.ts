/** Failure before a remote write was attempted; safe to retry the create. */
export class ProviderPreflightError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "Provider preflight failed", { cause });
    this.name = "ProviderPreflightError";
  }
}

export class ProviderApiError extends Error {
  readonly retryAfterSeconds: number | null;
  constructor(readonly provider: "wix" | "hubspot", readonly status: number, retryAfter: string | null) {
    super(`${provider} API request failed: ${status}`);
    this.name = "ProviderApiError";
    const seconds = retryAfter ? Number(retryAfter) : NaN;
    const date = retryAfter ? Date.parse(retryAfter) : NaN;
    const delay = Number.isFinite(seconds) ? seconds : (date - Date.now()) / 1000;
    this.retryAfterSeconds = Number.isFinite(delay) && delay >= 0 ? Math.min(Math.ceil(delay), 86_400) : null;
  }
}
