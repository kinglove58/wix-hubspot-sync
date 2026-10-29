import type { ConflictDecision, Provider } from "./types";

export interface ConflictInput {
  wixUpdatedAt: string | null;
  hubspotUpdatedAt: string | null;
  wixChangedSinceLastSync: boolean;
  hubspotChangedSinceLastSync: boolean;
}

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Decide which side should win without performing provider writes.
 * Invalid/missing timestamps never silently override a known valid timestamp.
 * When both sides changed at the same instant, HubSpot wins as the documented
 * deterministic tie-breaker. This policy can be changed, but must stay explicit.
 */
export function decideConflict(input: ConflictInput): ConflictDecision {
  const { wixChangedSinceLastSync, hubspotChangedSinceLastSync } = input;

  if (!wixChangedSinceLastSync && !hubspotChangedSinceLastSync) {
    return { winner: "none", reason: "no_change" };
  }

  if (wixChangedSinceLastSync && !hubspotChangedSinceLastSync) {
    return { winner: "wix", reason: "only_one_side_changed" };
  }

  if (hubspotChangedSinceLastSync && !wixChangedSinceLastSync) {
    return { winner: "hubspot", reason: "only_one_side_changed" };
  }

  const wixTime = timestamp(input.wixUpdatedAt);
  const hubspotTime = timestamp(input.hubspotUpdatedAt);

  if (wixTime !== null && hubspotTime !== null && wixTime !== hubspotTime) {
    const winner: Provider = wixTime > hubspotTime ? "wix" : "hubspot";
    return { winner, reason: "newer_source_timestamp" };
  }

  if (wixTime !== null && hubspotTime === null) {
    return { winner: "wix", reason: "newer_source_timestamp" };
  }

  if (hubspotTime !== null && wixTime === null) {
    return { winner: "hubspot", reason: "newer_source_timestamp" };
  }

  return { winner: "hubspot", reason: "deterministic_tie_break" };
}
