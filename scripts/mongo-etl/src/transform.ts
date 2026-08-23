import { money, type Money } from '@nexmarket/shared';

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * The legacy server stored prices as floats and did `parseInt(price * 100)`,
 * which truncates: 19.99 * 100 is 1998.9999999999998 in IEEE 754, so it charged
 * 1998. We round half away from zero instead, and the verify stage reconciles
 * the totals so the difference is reported rather than silent.
 */
export function toMinorUnits(price: number | undefined, currency: string): Money {
  if (price === undefined || !Number.isFinite(price)) {
    return money(0, currency);
  }
  const raw = price * 100;
  const rounded = raw < 0 ? -Math.round(-raw) : Math.round(raw);
  return money(rounded, currency);
}

/**
 * Section 12.1 hazard 1: `cart._id` values like `temp-1699999999999` are not
 * ObjectIds. The legacy client generated them and `new ObjectId()` throws on
 * them, which is why the load stage quarantines rather than crashes.
 */
export function isMigratableObjectId(id: string | undefined): boolean {
  return typeof id === 'string' && OBJECT_ID_RE.test(id);
}

export type NormalisedRole = 'admin' | 'seller' | 'buyer';

const KNOWN_ROLES = new Set<NormalisedRole>(['admin', 'seller', 'buyer']);

/** Section 12.1 hazard 4: users with no role default to buyer-only. */
export function normaliseRole(role: string | undefined): NormalisedRole {
  if (!role) return 'buyer';
  const lower = role.toLowerCase() as NormalisedRole;
  return KNOWN_ROLES.has(lower) ? lower : 'buyer';
}

export type LegacyAd = { _id: string; title: string; status?: string };
export type MergedAd = LegacyAd & { status: 'APPROVED' | 'PENDING' };

/**
 * Section 12.1 hazard 2: `approvedAds` duplicates rows already in `ads`. The
 * legacy DELETE /approvedAds/:id handler even deleted from the wrong
 * collection, which is why orphaned approvals exist. Both collections collapse
 * into one ad_campaigns table with a status enum.
 */
export function dedupeAds(ads: LegacyAd[], approvedAds: LegacyAd[]): MergedAd[] {
  const approvedIds = new Set(approvedAds.map((a) => a._id));
  const byId = new Map<string, MergedAd>();

  for (const ad of [...ads, ...approvedAds]) {
    if (byId.has(ad._id)) continue;
    byId.set(ad._id, { ...ad, status: approvedIds.has(ad._id) ? 'APPROVED' : 'PENDING' });
  }

  return [...byId.values()];
}
