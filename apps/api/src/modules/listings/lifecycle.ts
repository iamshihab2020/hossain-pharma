import { ConflictException } from '@nestjs/common';

export type ListingStatus = 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

/**
 * PRD 9.2: DRAFT -> PENDING_REVIEW -> ACTIVE <-> PAUSED -> ARCHIVED.
 *
 * Same shape as the organisation state machine in modules/orgs/lifecycle.ts,
 * and for the same reason: the table is the only place the rule lives, so
 * adding a state is a row here rather than a hunt for `if` statements.
 *
 * DRAFT -> ACTIVE is present because most listings never need review - see
 * `needsReview` below. PENDING_REVIEW -> DRAFT is "rejected, fix and resubmit".
 * ARCHIVED is terminal: a seller who wants the offer back creates a new one, so
 * that the price history of an archived offer stays readable.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<ListingStatus, readonly ListingStatus[]>> = {
  DRAFT: ['PENDING_REVIEW', 'ACTIVE', 'ARCHIVED'],
  PENDING_REVIEW: ['ACTIVE', 'DRAFT', 'ARCHIVED'],
  ACTIVE: ['PAUSED', 'ARCHIVED'],
  PAUSED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

export function assertTransition(from: ListingStatus, to: ListingStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new ConflictException(`Cannot move a listing from ${from} to ${to}`);
  }
}

/**
 * Plan decision P-C.
 *
 * If every listing needed review, PENDING_REVIEW would be a queue the platform
 * cannot staff. If none did, the state would be dead and the RESTRICTED flag
 * would do nothing until the Phase 4 age gate.
 *
 * So a listing in a RESTRICTED category goes DRAFT -> PENDING_REVIEW and waits
 * for an admin; everything else self-publishes. That is also the honest reading
 * of PRD 9.2, where it is *products* that are admin-moderated and listings that
 * merely have the state available.
 */
export function publishTarget(categoryIsRestricted: boolean): ListingStatus {
  return categoryIsRestricted ? 'PENDING_REVIEW' : 'ACTIVE';
}
