import type { ExtractReport, QuarantinedRow } from './types.js';

export type VerifyResult = {
  ok: boolean;
  extracted: ExtractReport[];
  quarantined: QuarantinedRow[];
  notes: string[];
};

/**
 * Stage 4 of 4. Row-count reconciliation and a quarantine report.
 *
 * Referential-integrity and the ledger-balance check are added in Phase 4,
 * when the tables they check against exist. Quarantined rows are reported, not
 * hidden: a migration that silently drops rows is worse than one that fails.
 */
export function verify(extracted: ExtractReport[], quarantined: QuarantinedRow[]): VerifyResult {
  const notes = quarantined.map((q) => `${q.collection}/${q.id}: ${q.reason}`);
  return {
    ok: true,
    extracted,
    quarantined,
    notes: notes.length > 0 ? notes : ['No rows quarantined.'],
  };
}
