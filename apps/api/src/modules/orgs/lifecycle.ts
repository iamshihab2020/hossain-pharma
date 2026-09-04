import { ConflictException } from '@nestjs/common';

export type OrgStatus = 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';

/**
 * PRD 6.6. DRAFT -> PENDING_REVIEW -> ACTIVE <-> SUSPENDED -> CLOSED.
 *
 * The table is the ONLY place the rule lives. A transition absent from it is a
 * 409, so adding a state means adding a row here rather than hunting for the
 * `if` statements that would otherwise have accumulated across the seller
 * service, the admin service and whatever Phase 4 adds.
 *
 * PENDING_REVIEW -> DRAFT is "rejected, fix it and resubmit", not a rollback.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<OrgStatus, readonly OrgStatus[]>> = {
  DRAFT: ['PENDING_REVIEW'],
  PENDING_REVIEW: ['ACTIVE', 'DRAFT'],
  ACTIVE: ['SUSPENDED', 'CLOSED'],
  SUSPENDED: ['ACTIVE', 'CLOSED'],
  CLOSED: [],
};

export function canTransition(from: OrgStatus, to: OrgStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Throws rather than returning false, because every caller would otherwise
 * write the same three lines and one of them would eventually write two.
 */
export function assertTransition(from: OrgStatus, to: OrgStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictException(`Cannot move an organisation from ${from} to ${to}`);
  }
}
