import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

type Journal = { entries: { idx: number; tag: string }[] };

/**
 * Drizzle applies exactly what `_journal.json` lists and SILENTLY IGNORES any
 * other .sql file in the folder.
 *
 * A hand-dropped migration therefore sits in the repository looking applied
 * while never having run - no error, no warning, and a policy that exists in
 * git and not in the database. This is the check that turns that into a red
 * test instead of a production incident, and it is why CLAUDE.md says to create
 * migrations with `drizzle-kit generate --custom`, which writes the file, the
 * journal entry and the snapshot together.
 */
describe('migration journal', () => {
  it('lists every .sql file on disk, and nothing else', async () => {
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
    ) as Journal;

    const onDisk = (await readdir(migrationsFolder))
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.replace(/\.sql$/, ''))
      .sort();
    const listed = journal.entries.map((e) => e.tag).sort();

    expect(listed).toEqual(onDisk);
  });

  it('has a snapshot for every entry', async () => {
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
    ) as Journal;
    const snapshots = new Set(
      (await readdir(join(migrationsFolder, 'meta'))).filter((f) => f.endsWith('_snapshot.json')),
    );
    const missing = journal.entries
      .map((e) => `${String(e.idx).padStart(4, '0')}_snapshot.json`)
      .filter((f) => !snapshots.has(f));
    expect(missing).toEqual([]);
  });

  it('numbers entries contiguously from zero', async () => {
    // A gap means a migration file was deleted by hand. The hash of everything
    // after it is unchanged, so nothing complains - the database simply never
    // gets whatever that file did.
    const journal = JSON.parse(
      await readFile(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
    ) as Journal;
    expect(journal.entries.map((e) => e.idx)).toEqual(journal.entries.map((_, i) => i));
  });
});
