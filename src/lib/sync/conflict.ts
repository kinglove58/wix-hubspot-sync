export type Provider = "wix" | "hubspot";

export interface ContactVersion {
  provider: Provider;
  updatedAt: string | null;
  externalId: string;
}

export interface ConflictDecision {
  winner: Provider;
  reason: string;
}

/**
 * Deterministic baseline policy:
 * 1. Prefer the version with a valid, later timestamp.
 * 2. If timestamps are equal/missing/invalid, use a stable provider tie-break.
 *
 * Production webhooks should supply provider timestamps and retain the decision
 * in an audit record. This helper never compares arbitrary user-supplied fields.
 */
export function resolveConflict(
  wix: ContactVersion,
  hubspot: ContactVersion,
): ConflictDecision {
  const wixTime = wix.updatedAt ? Date.parse(wix.updatedAt) : Number.NaN;
  const hubspotTime = hubspot.updatedAt ? Date.parse(hubspot.updatedAt) : Number.NaN;

  if (Number.isFinite(wixTime) && Number.isFinite(hubspotTime) && wixTime !== hubspotTime) {
    return wixTime > hubspotTime
      ? { winner: "wix", reason: "wix_updated_more_recently" }
      : { winner: "hubspot", reason: "hubspot_updated_more_recently" };
  }

  if (Number.isFinite(wixTime) && !Number.isFinite(hubspotTime)) {
    return { winner: "wix", reason: "only_wix_timestamp_is_valid" };
  }

  if (Number.isFinite(hubspotTime) && !Number.isFinite(wixTime)) {
    return { winner: "hubspot", reason: "only_hubspot_timestamp_is_valid" };
  }

  // Stable tie-breaker prevents different workers choosing different winners.
  return { winner: "hubspot", reason: "timestamp_tie_or_unavailable_stable_tiebreak" };
}
