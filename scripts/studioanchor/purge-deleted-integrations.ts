// disconnect-purge-v1 one-off: clear the stored tokens and identifying fields
// of channels deleted before the patch was deployed.
//
// 1. Back up the database (pg_dump), then run a dry run:
//      pnpm run purge:deleted-integrations
//    It lists how many deleted channels still hold data and prints a plan digest.
// 2. Review the count, then execute with explicit approval:
//      pnpm run purge:deleted-integrations -- --execute \
//        --backup=/path/to/backup.sql.gz --approve=<plan digest> --approved-by="<operator>"
//    The backup must be a non-empty file written in the last 24 hours, and the
//    digest must match the current plan, so a changed set is refused.
//
// Idempotent: purged rows no longer match the plan, so a rerun finds nothing.
// Only Integration rows that are still deleted are updated; posts, the
// dispatch-fence columns and stop receipts are never read or written.
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import {
  DISCONNECT_PURGE_PROTOCOL,
  purgedIntegrationData,
  unpurgedDeletedIntegrationWhere,
} from '../../libraries/nestjs-libraries/src/integrations/disconnect.purge';

const BACKUP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface PurgeOptions {
  execute: boolean;
  backup?: string;
  approve?: string;
  approvedBy?: string;
}

interface PurgeDatabase {
  integration: {
    findMany(args: unknown): Promise<Array<{ id: string }>>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
}

export function parseArgs(argv: string[]): PurgeOptions {
  const options: PurgeOptions = { execute: false };
  for (const arg of argv) {
    const [name, ...rest] = arg.split('=');
    const value = rest.join('=');
    if (name === '--execute' && !value) options.execute = true;
    else if (name === '--dry-run' && !value) options.execute = false;
    else if (name === '--backup' && value) options.backup = value;
    else if (name === '--approve' && value) options.approve = value;
    else if (name === '--approved-by' && value) options.approvedBy = value;
    else throw new Error(`Unknown or incomplete argument: ${name}`);
  }
  return options;
}

export function planDigest(ids: string[]): string {
  return createHash('sha256')
    .update(`${DISCONNECT_PURGE_PROTOCOL}\0${[...ids].sort().join('\0')}`)
    .digest('hex');
}

export function assertApproval(
  options: PurgeOptions,
  digest: string,
  now = Date.now(),
  stat: (path: string) => { isFile(): boolean; size: number; mtimeMs: number } = statSync
) {
  if (!options.backup) {
    throw new Error('Refusing to purge: --backup=<file> is required.');
  }
  let backup: { isFile(): boolean; size: number; mtimeMs: number };
  try {
    backup = stat(options.backup);
  } catch {
    throw new Error('Refusing to purge: the backup file does not exist.');
  }
  if (!backup.isFile() || backup.size <= 0) {
    throw new Error('Refusing to purge: the backup file is empty.');
  }
  if (now - backup.mtimeMs > BACKUP_MAX_AGE_MS || backup.mtimeMs > now) {
    throw new Error(
      'Refusing to purge: the backup must be written in the last 24 hours.'
    );
  }
  if (!options.approvedBy?.trim()) {
    throw new Error('Refusing to purge: --approved-by="<operator>" is required.');
  }
  if (options.approve !== digest) {
    throw new Error(
      'Refusing to purge: --approve must equal the plan digest from a dry run of the same set.'
    );
  }
}

export async function purgeDeletedIntegrations(
  db: PurgeDatabase,
  options: PurgeOptions,
  log: (line: string) => void = console.log,
  now = Date.now(),
  stat?: Parameters<typeof assertApproval>[3]
) {
  const rows = await db.integration.findMany({
    where: unpurgedDeletedIntegrationWhere(),
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  const ids = rows.map((row) => row.id);
  const digest = planDigest(ids);
  log(`${DISCONNECT_PURGE_PROTOCOL} plan: ${ids.length} deleted channel(s) still hold stored data.`);
  log(`Plan digest: ${digest}`);
  if (!options.execute) {
    log('Dry run only. Nothing was changed.');
    return { planned: ids.length, purged: 0, digest };
  }
  assertApproval(options, digest, now, stat);
  if (!ids.length) {
    log('Nothing to purge.');
    return { planned: 0, purged: 0, digest };
  }
  const result = await db.integration.updateMany({
    where: { id: { in: ids }, deletedAt: { not: null } },
    data: purgedIntegrationData(),
  });
  log(
    `Purged ${result.count} of ${ids.length} planned channel(s). Approved by ${options.approvedBy!.trim()}; backup ${options.backup}.`
  );
  return { planned: ids.length, purged: result.count, digest };
}

if (require.main === module) {
  const db = new PrismaClient();
  purgeDeletedIntegrations(db, parseArgs(process.argv.slice(2)))
    .catch((err: Error) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
