import 'reflect-metadata';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { IntegrationRepository } from '../libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository';
import {
  PURGED_INTEGRATION_NAME,
  isPurgedIntegration,
} from '../libraries/nestjs-libraries/src/integrations/disconnect.purge';
import { purgeDeletedIntegrations } from '../scripts/studioanchor/purge-deleted-integrations';

// Refuse every non-disposable database; there are no production credentials here.
assert.match(
  process.env.DATABASE_URL || '',
  /^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\/postgres\?schema=purge_proof$/
);
const db = new PrismaClient();
const model = { model: db } as never;
const repository = new IntegrationRepository(model, model, model, model, model, model);
const org = `purge-proof-${randomUUID()}`;

after(() => db.$disconnect());

async function seed(internalId: string, deletedAt: Date | null = null) {
  return db.integration.create({
    data: {
      organizationId: org,
      internalId,
      rootInternalId: internalId,
      name: 'Synthetic Studio',
      picture: 'https://cdn.example/avatar.png',
      providerIdentifier: 'youtube',
      type: 'social',
      token: `access-${randomUUID()}`,
      refreshToken: `refresh-${randomUUID()}`,
      tokenExpiration: new Date(Date.now() + 86400000),
      profile: 'synthetic-handle',
      customInstanceDetails: 'encrypted-instance-details',
      additionalSettings: '[{"title":"Verified","value":true}]',
      deletedAt,
    },
  });
}

test.before(async () => {
  await db.organization.create({ data: { id: org, name: 'Purge proof' } });
});

test('a deleted channel keeps no token, refresh token or identifying field, and its post is untouched', async () => {
  const channel = await seed(`acct-${randomUUID()}`);
  const post = await db.post.create({
    data: {
      organizationId: org,
      integrationId: channel.id,
      publishDate: new Date(Date.now() + 86400000),
      content: 'Synthetic post stays',
      group: randomUUID(),
      state: 'DRAFT',
      dispatchControl: 'STOPPED',
    },
  });
  await repository.deleteChannel(org, channel.id);
  const stored = await db.integration.findUniqueOrThrow({ where: { id: channel.id } });
  assert.ok(stored.deletedAt);
  assert.equal(stored.token, '');
  assert.equal(stored.refreshToken, null);
  assert.equal(stored.tokenExpiration, null);
  assert.equal(stored.name, PURGED_INTEGRATION_NAME);
  assert.equal(stored.picture, null);
  assert.equal(stored.profile, null);
  assert.equal(stored.customInstanceDetails, null);
  assert.equal(stored.internalId, channel.internalId);
  assert.ok(isPurgedIntegration(stored));
  const after = await db.post.findUniqueOrThrow({ where: { id: post.id } });
  assert.deepEqual(after, post);
});

test('reconnecting the same account revives the row with fresh tokens and its name', async () => {
  const internalId = `acct-${randomUUID()}`;
  const channel = await seed(internalId);
  await repository.deleteChannel(org, channel.id);
  const revived = await repository.createOrUpdateIntegration(undefined, false, org, 'Synthetic Studio', undefined, 'social', internalId, 'youtube', 'new-access', 'new-refresh', 3600, 'synthetic-handle');
  assert.equal(revived.id, channel.id);
  assert.equal(revived.deletedAt, null);
  assert.equal(revived.token, 'new-access');
  assert.equal(revived.name, 'Synthetic Studio');
});

test('the one-off purge clears pre-patch deletions once and leaves live channels', async () => {
  const old = await seed(`acct-${randomUUID()}`, new Date('2026-10-01T00:00:00Z'));
  const live = await seed(`acct-${randomUUID()}`);
  const dry = await purgeDeletedIntegrations(db, { execute: false }, () => undefined);
  assert.ok(dry.planned >= 1);
  const now = Date.now();
  const stat = () => ({ isFile: () => true, size: 1, mtimeMs: now - 1000 });
  const done = await purgeDeletedIntegrations(db, { execute: true, backup: '/synthetic.sql.gz', approve: dry.digest, approvedBy: 'Synthetic operator' }, () => undefined, now, stat);
  assert.equal(done.purged, dry.planned);
  assert.ok(isPurgedIntegration(await db.integration.findUniqueOrThrow({ where: { id: old.id } })));
  assert.equal((await db.integration.findUniqueOrThrow({ where: { id: live.id } })).token, live.token);
  assert.equal((await purgeDeletedIntegrations(db, { execute: false }, () => undefined)).planned, 0);
});
