require('reflect-metadata');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.STORAGE_PROVIDER = 'local';
process.env.UPLOAD_DIRECTORY = process.env.UPLOAD_DIRECTORY || require('node:os').tmpdir();
Object.assign(process.env, {
  LINKEDIN_CLIENT_ID: 'li-client',
  LINKEDIN_CLIENT_SECRET: 'li-secret',
  TIKTOK_CLIENT_ID: 'tt-client',
  TIKTOK_CLIENT_SECRET: 'tt-secret',
  REDDIT_CLIENT_ID: 'rd-client',
  REDDIT_CLIENT_SECRET: 'rd-secret',
  DISCORD_CLIENT_ID: 'dc-client',
  DISCORD_CLIENT_SECRET: 'dc-secret',
  TWITCH_CLIENT_ID: 'tw-client',
});

const purge = require('../libraries/nestjs-libraries/src/integrations/disconnect.purge.ts');
const { IntegrationRepository } = require('../libraries/nestjs-libraries/src/database/prisma/integrations/integration.repository.ts');
const { IntegrationService } = require('../libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts');
const { RefreshIntegrationService } = require('../libraries/nestjs-libraries/src/integrations/refresh.integration.service.ts');
const { socialIntegrationList } = require('../libraries/nestjs-libraries/src/integrations/integration.manager.ts');
const script = require('../scripts/studioanchor/purge-deleted-integrations.ts');

const live = () => ({
  id: 'channel-1',
  organizationId: 'org-1',
  internalId: 'provider-account-1',
  rootInternalId: 'provider-account-1',
  providerIdentifier: 'youtube',
  name: 'Studio Channel',
  picture: 'https://cdn.example/avatar.png',
  profile: 'studio-handle',
  token: 'access-token-secret',
  refreshToken: 'refresh-token-secret',
  tokenExpiration: new Date('2027-01-01T00:00:00Z'),
  customInstanceDetails: 'encrypted-app-password',
  additionalSettings: '[{"title":"Verified","value":true}]',
  deletedAt: null,
});

// A Prisma delegate fake that stores rows and refuses any post access.
function prismaFake(rows) {
  const calls = [];
  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'OR') return value.some((item) => matches(row, item));
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('not' in value) {
          if (value.not && typeof value.not === 'object' && 'in' in value.not) return !value.not.in.includes(row[key]);
          return value.not === null ? row[key] !== null && row[key] !== undefined : row[key] !== null && row[key] !== value.not;
        }
        if ('in' in value) return value.in.includes(row[key]);
      }
      return row[key] === value;
    });
  const integration = {
    async findFirst(args) {
      calls.push(['findFirst', args]);
      return rows.find((row) => matches(row, args.where)) || null;
    },
    async findMany(args) {
      calls.push(['findMany', args]);
      return rows.filter((row) => matches(row, args.where)).map((row) => ({ id: row.id }));
    },
    async update(args) {
      calls.push(['update', args]);
      const row = rows.find((item) => matches(item, args.where));
      if (!row) throw new Error('not found');
      Object.assign(row, args.data);
      return { ...row };
    },
    async updateMany(args) {
      calls.push(['updateMany', args]);
      const found = rows.filter((row) => matches(row, args.where));
      for (const row of found) Object.assign(row, args.data);
      return { count: found.length };
    },
    async upsert(args) {
      calls.push(['upsert', args]);
      return { id: 'channel-1' };
    },
  };
  const refuse = new Proxy({}, { get() { throw new Error('posts must not be touched'); } });
  return { calls, integration: { model: { integration } }, posts: { model: { post: refuse } } };
}

test('deleting a channel clears tokens and identifying fields in the same update as deletedAt', async () => {
  const rows = [live()];
  const db = prismaFake(rows);
  const repository = new IntegrationRepository(db.integration, db.posts, null, null, null, null);
  await repository.deleteChannel('org-1', 'channel-1');
  const updates = db.calls.filter(([name]) => name === 'update');
  assert.equal(updates.length, 1, 'one statement, so the purge and deletedAt are atomic');
  const { where, data } = updates[0][1];
  assert.deepEqual(where, { id: 'channel-1', organizationId: 'org-1' });
  assert.ok(data.deletedAt instanceof Date);
  const row = rows[0];
  assert.equal(row.token, '');
  assert.equal(row.refreshToken, null);
  assert.equal(row.tokenExpiration, null);
  assert.equal(row.customInstanceDetails, null);
  assert.equal(row.name, purge.PURGED_INTEGRATION_NAME);
  assert.equal(row.picture, null);
  assert.equal(row.profile, null);
  assert.equal(row.additionalSettings, '[]');
  assert.equal(row.internalId, 'provider-account-1', 'kept for uniqueness and reconnect');
  assert.equal(row.rootInternalId, 'provider-account-1');
  assert.equal(row.providerIdentifier, 'youtube');
  assert.ok(purge.isPurgedIntegration(row));
  assert.doesNotMatch(JSON.stringify(row), /secret|Studio Channel|studio-handle|avatar|app-password|Verified/);
  for (const key of ['dispatchControl', 'dispatchClaim', 'deliveryStopReceipt']) {
    assert.ok(!(key in data), `${key} is a Post column and is never written`);
  }
});

test('a reconnect of a purged channel restores its name before the upsert', async () => {
  const rows = [{ ...live(), ...purge.purgedIntegrationData(), deletedAt: new Date() }];
  const db = prismaFake(rows);
  const repository = new IntegrationRepository(db.integration, db.posts, null, null, null, null);
  await repository.createOrUpdateIntegration(undefined, false, 'org-1', 'Studio Channel', undefined, 'social', 'provider-account-1', 'youtube', 'new-token', 'new-refresh');
  const [first, second] = db.calls;
  assert.equal(first[0], 'updateMany');
  assert.deepEqual(first[1], { where: { organizationId: 'org-1', internalId: 'provider-account-1', deletedAt: { not: null } }, data: { name: 'Studio Channel' } });
  assert.equal(second[0], 'upsert');
  assert.equal(rows[0].name, 'Studio Channel');
});

function serviceHarness({ rows, revoke, shared = false }) {
  const order = [];
  const repository = {
    async getIntegrationById(org, id) {
      order.push('read');
      const row = rows.find((item) => item.id === id && item.organizationId === org);
      return row ? { ...row } : null;
    },
    async deleteChannel(org, id) {
      order.push('purge');
      const row = rows.find((item) => item.id === id);
      Object.assign(row, purge.purgedIntegrationData(), { deletedAt: new Date() });
      return { ...row };
    },
    async isTokenShared(id, token, refreshToken) {
      order.push(['shared', id, token, refreshToken]);
      return shared;
    },
  };
  const provider = { identifier: 'youtube', ...(revoke ? { revokeToken: async (...args) => { order.push(['revoke', ...args, { ...rows[0] }]); return revoke(...args); } } : {}) };
  const manager = { getSocialIntegration: (identifier) => (identifier === 'youtube' ? provider : undefined) };
  return { order, service: new IntegrationService(repository, null, manager, null, null, null) };
}

test('revocation runs after the purge with the tokens read before it, and never blocks deletion', async () => {
  const rows = [live()];
  const { order, service } = serviceHarness({ rows, revoke: async () => true });
  const deleted = await service.deleteChannel('org-1', 'channel-1');
  assert.equal(deleted.token, '');
  assert.deepEqual(order.slice(0, 3), ['read', 'purge', ['shared', 'channel-1', 'access-token-secret', 'refresh-token-secret']]);
  const [, access, refresh, rowAtRevoke] = order[3];
  assert.equal(access, 'access-token-secret');
  assert.equal(refresh, 'refresh-token-secret');
  assert.equal(rowAtRevoke.token, '', 'stored tokens are already gone when the provider is called');

  for (const revoke of [async () => false, async () => { throw new Error('provider down'); }]) {
    const failing = serviceHarness({ rows: [live()], revoke });
    const result = await failing.service.deleteChannel('org-1', 'channel-1');
    assert.equal(result.refreshToken, null);
  }
});

test('revocation is skipped for shared grants, already-deleted channels and providers without an API', async () => {
  const shared = serviceHarness({ rows: [live()], revoke: async () => assert.fail('shared grant revoked'), shared: true });
  await shared.service.deleteChannel('org-1', 'channel-1');
  assert.equal(shared.order.filter((item) => item[0] === 'revoke').length, 0);

  const already = serviceHarness({ rows: [{ ...live(), deletedAt: new Date() }], revoke: async () => assert.fail('revoked twice') });
  await already.service.deleteChannel('org-1', 'channel-1');
  assert.deepEqual(already.order, ['read', 'purge']);

  const none = serviceHarness({ rows: [live()] });
  assert.equal(await none.service.revokeDeletedChannelToken(live()), false);
  await none.service.deleteChannel('org-1', 'channel-1');
  assert.equal(none.order.filter((item) => item[0] === 'revoke').length, 0);
});

test('token sharing is checked against other live channels only', async () => {
  const rows = [live(), { ...live(), id: 'channel-2', deletedAt: null }];
  const db = prismaFake(rows);
  const repository = new IntegrationRepository(db.integration, db.posts, null, null, null, null);
  assert.equal(await repository.isTokenShared('channel-1', 'access-token-secret', null), true);
  rows[1].deletedAt = new Date();
  assert.equal(await repository.isTokenShared('channel-1', 'access-token-secret', 'refresh-token-secret'), false);
  assert.equal(await repository.isTokenShared('channel-1', '', null), false);
});

const EXPECTED_REVOCATION = {
  youtube: { url: 'https://oauth2.googleapis.com/revoke', token: 'refresh-y' },
  gmb: { url: 'https://oauth2.googleapis.com/revoke', token: 'refresh-y' },
  linkedin: { url: 'https://www.linkedin.com/oauth/v2/revoke', token: 'access-x', fields: { client_id: 'li-client', client_secret: 'li-secret' } },
  'linkedin-page': { url: 'https://www.linkedin.com/oauth/v2/revoke', token: 'access-x', fields: { client_id: 'li-client', client_secret: 'li-secret' } },
  tiktok: { url: 'https://open.tiktokapis.com/v2/oauth/revoke/', token: 'access-x', fields: { client_key: 'tt-client', client_secret: 'tt-secret' } },
  reddit: { url: 'https://www.reddit.com/api/v1/revoke_token', token: 'refresh-y', basic: 'rd-client:rd-secret' },
  discord: { url: 'https://discord.com/api/oauth2/token/revoke', token: 'refresh-y', basic: 'dc-client:dc-secret' },
  twitch: { url: 'https://id.twitch.tv/oauth2/revoke', token: 'access-x', fields: { client_id: 'tw-client' } },
  slack: { url: 'https://slack.com/api/auth.revoke', bearer: 'access-x' },
};

test('revoke dispatch: exactly these providers revoke, at their documented endpoints', async () => {
  const revoking = socialIntegrationList.filter((provider) => typeof provider.revokeToken === 'function').map((provider) => provider.identifier).sort();
  assert.deepEqual(revoking, Object.keys(EXPECTED_REVOCATION).sort());
  const nativeFetch = globalThis.fetch;
  try {
    for (const provider of socialIntegrationList.filter((item) => item.revokeToken)) {
      const expected = EXPECTED_REVOCATION[provider.identifier];
      const requests = [];
      globalThis.fetch = async (url, init) => { requests.push({ url: String(url), init }); return new Response('{}', { status: 200 }); };
      assert.equal(await provider.revokeToken('access-x', 'refresh-y'), true, provider.identifier);
      assert.equal(requests.length, 1);
      const [{ url, init }] = requests;
      assert.equal(url, expected.url, provider.identifier);
      assert.equal(init.method, 'POST');
      assert.equal(init.redirect, 'error');
      assert.ok(init.signal instanceof AbortSignal);
      if (expected.bearer) {
        assert.equal(init.headers.Authorization, `Bearer ${expected.bearer}`);
        continue;
      }
      const body = new URLSearchParams(init.body);
      assert.equal(body.get('token'), expected.token, provider.identifier);
      for (const [key, value] of Object.entries(expected.fields || {})) assert.equal(body.get(key), value);
      if (expected.basic) assert.equal(init.headers.Authorization, `Basic ${Buffer.from(expected.basic).toString('base64')}`);
    }
    // Without a refresh token the access token is revoked instead.
    const google = socialIntegrationList.find((item) => item.identifier === 'youtube');
    let body;
    globalThis.fetch = async (url, init) => { body = new URLSearchParams(init.body); return new Response('', { status: 200 }); };
    await google.revokeToken('access-only', null);
    assert.equal(body.get('token'), 'access-only');
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test('revokeRequest is bounded and never throws', async () => {
  const nativeFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('nope', { status: 400 });
    assert.equal(await purge.revokeRequest('https://provider.example/revoke', { method: 'POST' }), false);
    globalThis.fetch = async () => { throw new TypeError('network down'); };
    assert.equal(await purge.revokeRequest('https://provider.example/revoke', { method: 'POST' }), false);
    globalThis.fetch = async (_url, init) => { assert.equal(init.redirect, 'error'); return new Response(null, { status: 200 }); };
    assert.equal(await purge.revokeRequest('https://provider.example/revoke', { method: 'POST' }), true);
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test('a refresh that finishes after deletion never writes tokens back', async () => {
  const writes = [];
  const provider = { refreshToken: async () => ({ accessToken: 'fresh', refreshToken: 'fresh-refresh', expiresIn: 100 }) };
  const integrationService = {
    getIntegrationById: async () => ({ ...live(), ...purge.purgedIntegrationData(), deletedAt: new Date() }),
    createOrUpdateIntegration: async (...args) => writes.push(args),
    refreshNeeded: async () => undefined,
    informAboutRefreshError: async () => undefined,
    disconnectChannel: async () => undefined,
  };
  const refresh = new RefreshIntegrationService({ getSocialIntegration: () => provider }, integrationService, null);
  assert.equal(await refresh.refresh(live()), false);
  assert.equal(writes.length, 0);
  integrationService.getIntegrationById = async () => live();
  assert.ok(await refresh.refresh(live()));
  assert.equal(writes.length, 1);
});

test('one-off purge: dry run by default, approval after a fresh backup, idempotent, posts untouched', async () => {
  const deletedOld = { ...live(), id: 'old-1', deletedAt: new Date('2026-10-01T00:00:00Z') };
  const deletedPurged = { ...live(), id: 'old-2', ...purge.purgedIntegrationData(), deletedAt: new Date('2026-10-02T00:00:00Z') };
  const active = { ...live(), id: 'live-1' };
  const rows = [deletedOld, deletedPurged, active];
  const db = prismaFake(rows);
  const delegate = db.integration.model;
  const logs = [];
  const now = Date.parse('2026-11-10T12:00:00Z');
  const freshBackup = () => ({ isFile: () => true, size: 1024, mtimeMs: now - 3600_000 });

  const dry = await script.purgeDeletedIntegrations(delegate, script.parseArgs([]), (line) => logs.push(line), now, freshBackup);
  assert.equal(dry.planned, 1);
  assert.equal(dry.purged, 0);
  assert.equal(dry.digest, script.planDigest(['old-1']));
  assert.equal(deletedOld.token, 'access-token-secret', 'dry run changes nothing');
  assert.doesNotMatch(logs.join('\n'), /secret|Studio Channel/);

  const attempt = (argv, stat = freshBackup) => script.purgeDeletedIntegrations(delegate, script.parseArgs(argv), () => undefined, now, stat);
  await assert.rejects(attempt(['--execute']), /--backup/);
  await assert.rejects(attempt(['--execute', '--backup=/b.sql.gz', `--approve=${dry.digest}`, '--approved-by=Operator'], () => { throw new Error('ENOENT'); }), /does not exist/);
  await assert.rejects(attempt(['--execute', '--backup=/b.sql.gz', `--approve=${dry.digest}`, '--approved-by=Operator'], () => ({ isFile: () => true, size: 0, mtimeMs: now })), /empty/);
  await assert.rejects(attempt(['--execute', '--backup=/b.sql.gz', `--approve=${dry.digest}`, '--approved-by=Operator'], () => ({ isFile: () => true, size: 9, mtimeMs: now - 2 * 86400_000 })), /24 hours/);
  await assert.rejects(attempt(['--execute', '--backup=/b.sql.gz', `--approve=${dry.digest}`]), /approved-by/);
  await assert.rejects(attempt(['--execute', '--backup=/b.sql.gz', '--approve=0000', '--approved-by=Operator']), /plan digest/);
  assert.throws(() => script.parseArgs(['--execute=yes']), /Unknown/);
  assert.equal(deletedOld.token, 'access-token-secret', 'refused runs change nothing');

  const done = await attempt(['--execute', '--backup=/b.sql.gz', `--approve=${dry.digest}`, '--approved-by=Operator']);
  assert.deepEqual({ planned: done.planned, purged: done.purged }, { planned: 1, purged: 1 });
  assert.ok(purge.isPurgedIntegration(deletedOld));
  assert.equal(deletedOld.deletedAt.toISOString(), '2026-10-01T00:00:00.000Z', 'deletion time is kept');
  assert.equal(active.token, 'access-token-secret', 'live channels are untouched');
  const update = db.calls.find(([name]) => name === 'updateMany')[1];
  assert.deepEqual(update.where, { id: { in: ['old-1'] }, deletedAt: { not: null } });

  const again = await script.purgeDeletedIntegrations(delegate, script.parseArgs([]), () => undefined, now);
  assert.equal(again.planned, 0, 'a rerun finds nothing');
  const rerun = await attempt(['--execute', '--backup=/b.sql.gz', `--approve=${again.digest}`, '--approved-by=Operator']);
  assert.equal(rerun.purged, 0);
});

test('the public API advertises disconnect-purge-v1 so clients can require it', () => {
  const publicApi = require('node:fs').readFileSync('apps/backend/src/public-api/routes/v1/public.integrations.controller.ts', 'utf8');
  assert.match(publicApi, /@Get\('\/channel-controls'\)/);
  assert.match(publicApi, /protocols: \[\s+DISCONNECT_PURGE_PROTOCOL,/);
  assert.equal(purge.DISCONNECT_PURGE_PROTOCOL, 'disconnect-purge-v1');
});
