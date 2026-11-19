/**
 * Seals the users and trips saved before encryption (#89). A dry run unless `--apply` is passed.
 *
 * On the VM, after the encryption change deploys:
 *   docker exec cpen321-project-backend-1 node dist/scripts/encrypt-existing.js          # counts only
 *   docker exec cpen321-project-backend-1 node dist/scripts/encrypt-existing.js --apply  # seals, then counts again
 */
import { connectDatabase, disconnectDatabase } from '../config/db';
import { assertEnv, env } from '../config/env';
import { sealPlaintextDocuments } from '../services/encryption-migration.service';
import { loadDataKey } from '../services/field-crypto';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  assertEnv();
  await loadDataKey();
  await connectDatabase(env.mongodbUri);
  try {
    console.log(apply ? 'Sealing:' : 'Dry run:', JSON.stringify(await sealPlaintextDocuments(apply)));
    if (apply) console.log('Still plaintext:', JSON.stringify(await sealPlaintextDocuments(false)));
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err: unknown) => {
  // the name only, since a database error can quote user data
  console.error('Migration failed:', err instanceof Error ? err.name : 'unknown error');
  process.exitCode = 1;
});
