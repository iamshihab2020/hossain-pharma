import { describe, expect, it } from 'vitest';
import {
  ALL_CAPABILITIES,
  ORG_ROLE_CAPABILITIES,
  hasCapability,
  type OrgRole,
} from './capabilities.js';

describe('capabilities', () => {
  it('gives OWNER every capability any role has', () => {
    const all = new Set(Object.values(ORG_ROLE_CAPABILITIES).flat());
    for (const cap of all) {
      expect(ORG_ROLE_CAPABILITIES.OWNER).toContain(cap);
    }
  });

  it('matches the PRD 5.3 matrix for STAFF', () => {
    expect(hasCapability(['STAFF'], 'order:write')).toBe(true);
    expect(hasCapability(['STAFF'], 'product:read')).toBe(true);
    expect(hasCapability(['STAFF'], 'product:write')).toBe(false);
    expect(hasCapability(['STAFF'], 'payout:read')).toBe(false);
    expect(hasCapability(['STAFF'], 'member:write')).toBe(false);
  });

  it('matches the PRD 5.3 matrix for FINANCE', () => {
    expect(hasCapability(['FINANCE'], 'payout:read')).toBe(true);
    expect(hasCapability(['FINANCE'], 'payout:write')).toBe(true);
    expect(hasCapability(['FINANCE'], 'analytics:read')).toBe(true);
    expect(hasCapability(['FINANCE'], 'order:read')).toBe(true);
    expect(hasCapability(['FINANCE'], 'order:write')).toBe(false);
    expect(hasCapability(['FINANCE'], 'product:write')).toBe(false);
  });

  it('matches the PRD 5.3 matrix for MANAGER', () => {
    expect(hasCapability(['MANAGER'], 'product:write')).toBe(true);
    expect(hasCapability(['MANAGER'], 'analytics:read')).toBe(true);
    expect(hasCapability(['MANAGER'], 'payout:read')).toBe(true);
    expect(hasCapability(['MANAGER'], 'payout:write')).toBe(false);
    expect(hasCapability(['MANAGER'], 'member:write')).toBe(false);
  });

  it('unions capabilities when a user holds two roles in one org', () => {
    expect(hasCapability(['STAFF', 'FINANCE'], 'payout:write')).toBe(true);
    expect(hasCapability(['STAFF', 'FINANCE'], 'order:write')).toBe(true);
    expect(hasCapability(['STAFF', 'FINANCE'], 'member:write')).toBe(false);
  });

  it('denies when the role list is empty', () => {
    expect(hasCapability([], 'product:read')).toBe(false);
  });

  it('denies an unknown role rather than throwing', () => {
    // A guard that throws on unexpected data fails open under some framework
    // configurations. Contributing nothing fails closed.
    expect(hasCapability(['NOPE' as OrgRole], 'product:read')).toBe(false);
  });
});

describe('ALL_CAPABILITIES', () => {
  it('matches the set of capabilities the matrix actually grants', () => {
    // Checks drift in both directions: a capability added to the union and
    // handed to a role but left out of the list, or removed from every role and
    // left in it. It cannot catch a capability that NO role holds - such a
    // capability is unreachable by definition, so there is nothing to catch.
    const fromMatrix = new Set(Object.values(ORG_ROLE_CAPABILITIES).flat());
    expect([...fromMatrix].sort()).toEqual([...ALL_CAPABILITIES].sort());
  });

  it('has no duplicates', () => {
    expect(new Set(ALL_CAPABILITIES).size).toBe(ALL_CAPABILITIES.length);
  });
});
