import { extract } from './extract.js';
import { verify } from './verify.js';

/**
 * Phase 0 ships extract, transform and verify.
 *
 * The LOAD stage lands with the schema it targets: it cannot insert orders,
 * shipments and ledger entries into tables that Phase 4 has not created yet.
 * Running this today produces an extract and quarantine report, which is the
 * useful half at this point anyway.
 */
async function main(): Promise<void> {
  const mongoUrl = process.env.LEGACY_MONGO_URL;
  const dbName = process.env.LEGACY_MONGO_DB;

  if (!mongoUrl || !dbName) {
    console.error(
      'Set LEGACY_MONGO_URL and LEGACY_MONGO_DB to run the ETL. See .env.example.',
    );
    process.exitCode = 1;
    return;
  }

  const { reports } = await extract(mongoUrl, dbName);
  const result = verify(reports, []);

  console.log('Extract report:');
  for (const r of result.extracted) {
    console.log(`  ${r.collection}: ${r.documentCount} documents`);
  }
  console.log('Notes:');
  for (const note of result.notes) {
    console.log(`  ${note}`);
  }
  console.log('\nLoad stage is not implemented yet. It lands with Phase 4.');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
