import { MongoClient } from 'mongodb';
import { MONGO_COLLECTIONS, type ExtractReport, type MongoCollection } from './types.js';

export type ExtractResult = {
  data: Record<MongoCollection, unknown[]>;
  reports: ExtractReport[];
};

/**
 * Stage 1 of 4.
 *
 * Reads each legacy collection into typed intermediate JSON so the transform
 * stage is a pure function over data and can be tested without a Mongo
 * instance. That separation is why transform.ts has 19 tests and this file has
 * none: everything here is I/O.
 */
export async function extract(mongoUrl: string, dbName: string): Promise<ExtractResult> {
  const client = new MongoClient(mongoUrl);
  try {
    await client.connect();
    const db = client.db(dbName);

    const data = {} as Record<MongoCollection, unknown[]>;
    const reports: ExtractReport[] = [];

    for (const collection of MONGO_COLLECTIONS) {
      const docs = await db.collection(collection).find({}).toArray();
      data[collection] = docs;
      reports.push({ collection, documentCount: docs.length });
    }

    return { data, reports };
  } finally {
    await client.close();
  }
}
