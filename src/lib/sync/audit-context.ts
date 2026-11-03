import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

type AuditContext = { eventId: string; attempt: number };
const context = new AsyncLocalStorage<AuditContext>();
export function withSyncAuditContext<T>(value: AuditContext, run: () => Promise<T>): Promise<T> {
  return context.run(value, run);
}
export function syncAuditContext(): Partial<AuditContext> { return context.getStore() ?? {}; }
