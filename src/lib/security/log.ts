/** Metadata only: callers must never pass provider bodies, tokens or contacts. */
export type OperationContext = {
  eventId?: string; correlationId?: string; provider?: "wix" | "hubspot";
  connectionId?: string; pairId?: string; contactLinkId?: string;
  operation?: string; result?: string; attempt?: number; status?: number;
};
export function logOperationFailure(code: string, context: OperationContext = {}): void {
  console.error(JSON.stringify({ level: "error", code, ...context, timestamp: new Date().toISOString() }));
}
