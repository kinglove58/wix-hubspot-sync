import "server-only";

export type SyncOrigin = "wix" | "hubspot";

export function isSameSyncEcho(currentUpdatedAt: string | null | undefined, syncedUpdatedAt: string | null | undefined): boolean {
  if (!currentUpdatedAt || !syncedUpdatedAt) return false;
  const current = Date.parse(currentUpdatedAt);
  const synced = Date.parse(syncedUpdatedAt);
  return Number.isFinite(current) && Number.isFinite(synced) && current <= synced;
}

/**
 * Suppresses a near-immediate echo from the provider we just wrote to.
 * Provider timestamps are required for a strong decision; missing timestamps
 * deliberately do not trigger suppression.
 */
export function isLikelySyncEcho(input: {
  incomingProvider: SyncOrigin;
  lastWrittenBy: SyncOrigin | null;
  lastSyncedAt: string | null;
  incomingUpdatedAt: string | null;
  toleranceMs?: number;
}): boolean {
  if (!input.lastWrittenBy || input.lastWrittenBy === input.incomingProvider) return false;
  if (!input.lastSyncedAt || !input.incomingUpdatedAt) return false;

  const syncedAt = Date.parse(input.lastSyncedAt);
  const updatedAt = Date.parse(input.incomingUpdatedAt);
  if (!Number.isFinite(syncedAt) || !Number.isFinite(updatedAt)) return false;

  // Only ignore an opposite-provider event whose source timestamp is no newer
  // than the sync write, within a small provider clock-skew allowance.
  const tolerance = input.toleranceMs ?? 0;
  return updatedAt <= syncedAt + tolerance;
}
