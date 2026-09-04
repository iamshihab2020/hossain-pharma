/**
 * PRD 5.3, expressed as data.
 *
 * Guards check capability strings, never role names. That is the whole point:
 * adding a sub-role or moving one permission is a change to this table, not a
 * change to every call site. A guard that reads `role === 'OWNER'` has
 * reintroduced exactly the coupling this table exists to remove.
 */
export type OrgRole = 'OWNER' | 'MANAGER' | 'STAFF' | 'FINANCE';

export type Capability =
  | 'product:read'
  | 'product:write'
  | 'order:read'
  | 'order:write'
  | 'analytics:read'
  | 'payout:read'
  | 'payout:write'
  | 'member:read'
  | 'member:write'
  | 'settings:read'
  | 'settings:write';

/**
 * Read straight off the PRD 5.3 table. A tick is read+write, an eye is read
 * only, a dash is neither.
 *
 *          Products Orders Analytics Finance Members Settings
 * OWNER       rw      rw       rw       rw      rw       rw
 * MANAGER     rw      rw       rw       r       -        r
 * STAFF       r       rw       -        -       -        -
 * FINANCE     -       r        rw       rw      -        -
 */
export const ORG_ROLE_CAPABILITIES: Readonly<Record<OrgRole, readonly Capability[]>> = {
  OWNER: [
    'product:read',
    'product:write',
    'order:read',
    'order:write',
    'analytics:read',
    'payout:read',
    'payout:write',
    'member:read',
    'member:write',
    'settings:read',
    'settings:write',
  ],
  MANAGER: [
    'product:read',
    'product:write',
    'order:read',
    'order:write',
    'analytics:read',
    'payout:read',
    'settings:read',
  ],
  STAFF: ['product:read', 'order:read', 'order:write'],
  FINANCE: ['order:read', 'analytics:read', 'payout:read', 'payout:write'],
};

/**
 * Every capability, in one list.
 *
 * Enforcement never needs this - a guard asks about one capability at a time -
 * but anything that has to SHOW an effective set does: a settings screen, the
 * suspended-seller rule, an audit export. Derived by hand rather than from
 * ORG_ROLE_CAPABILITIES so that the list and the matrix can be checked against
 * each other; deriving it would make that check tautological.
 */
export const ALL_CAPABILITIES: readonly Capability[] = [
  'product:read',
  'product:write',
  'order:read',
  'order:write',
  'analytics:read',
  'payout:read',
  'payout:write',
  'member:read',
  'member:write',
  'settings:read',
  'settings:write',
];

/**
 * Union across roles. One human can hold several roles in one org, and the
 * answer is the union, never the maximum or the first match.
 *
 * An unrecognised role contributes nothing rather than throwing: this runs
 * inside a guard, and a guard that throws on unexpected data fails open in some
 * framework configurations. Contributing nothing fails closed.
 */
export function hasCapability(roles: readonly OrgRole[], needed: Capability): boolean {
  return roles.some((role) => ORG_ROLE_CAPABILITIES[role]?.includes(needed) ?? false);
}
