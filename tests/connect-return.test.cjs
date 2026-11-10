const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONNECT_RETURN_PROTOCOL,
  connectReturnOrigins,
  connectReturnTargets,
  saveConnectReturn,
  takeConnectReturn,
  validateConnectReturn,
} = require('../libraries/nestjs-libraries/src/integrations/connect.return.ts');

const ORIGIN = 'https://marketing.studioanchor.app';
const TARGET = `${ORIGIN}/api/v1/publishing-connections/accounts/return?intent=abc123`;

const memoryStore = () => {
  const data = new Map();
  const writes = [];
  return {
    data,
    writes,
    async get(key) {
      return data.get(key);
    },
    async set(key, value, mode, seconds) {
      writes.push({ key, mode, seconds });
      data.set(key, value);
      return 'OK';
    },
    async del(key) {
      data.delete(key);
      return 1;
    },
  };
};

test('return origins come only from exact HTTPS entries in the environment', () => {
  assert.deepEqual(connectReturnOrigins(undefined), []);
  assert.deepEqual(connectReturnOrigins(''), []);
  assert.deepEqual(
    connectReturnOrigins(
      ` ${ORIGIN} ,http://marketing.studioanchor.app,https://a.example/path,https://*.example,not a url,https://b.example`
    ),
    [ORIGIN, 'https://b.example']
  );
});

test('a return target must be an exact allowlisted origin, never an arbitrary URL', () => {
  const origins = [ORIGIN];
  assert.equal(validateConnectReturn(TARGET, origins), TARGET);
  for (const value of [
    undefined,
    null,
    42,
    '',
    'https://evil.example/return',
    'https://marketing.studioanchor.app.evil.example/return',
    'https://evil.example@marketing.studioanchor.app/return',
    'https://user:pass@marketing.studioanchor.app/return',
    'http://marketing.studioanchor.app/return',
    'https://marketing.studioanchor.app:8443/return',
    `${TARGET}#fragment`,
    'https://MARKETING.studioanchor.app/return',
    'https://marketing.studioanchor.app/a/../return',
    'https:\\\\evil.example',
    '//evil.example/return',
    'javascript:alert(1)',
    `${ORIGIN}/${'a'.repeat(2048)}`,
  ]) {
    assert.equal(validateConnectReturn(value, origins), null, String(value));
  }
  assert.equal(validateConnectReturn(TARGET, []), null);
});

test('the intent is stored next to the OAuth state, used once, and bound to its provider', async () => {
  const store = memoryStore();
  await saveConnectReturn(store, 'state-1', { target: TARGET, provider: 'facebook' });
  assert.deepEqual(store.writes, [{ key: 'connect-return:state-1', mode: 'EX', seconds: 3600 }]);
  assert.equal(await takeConnectReturn(store, 'state-1', 'linkedin', [ORIGIN]), null);
  assert.equal(store.data.size, 0, 'a provider mismatch still consumes the intent');

  await saveConnectReturn(store, 'state-2', { target: TARGET, provider: 'facebook' });
  assert.deepEqual(await takeConnectReturn(store, 'state-2', 'facebook', [ORIGIN]), {
    target: TARGET,
    provider: 'facebook',
  });
  assert.equal(await takeConnectReturn(store, 'state-2', 'facebook', [ORIGIN]), null);

  await saveConnectReturn(store, 'state-3', { target: TARGET, provider: 'facebook' });
  assert.equal(
    await takeConnectReturn(store, 'state-3', 'facebook', []),
    null,
    'removing the origin from the environment disables pending intents'
  );
  assert.equal(await takeConnectReturn(store, undefined, 'facebook', [ORIGIN]), null);
  assert.equal(await takeConnectReturn(store, 'x'.repeat(513), 'facebook', [ORIGIN]), null);
  store.data.set('connect-return:state-4', '{not json');
  assert.equal(await takeConnectReturn(store, 'state-4', 'facebook', [ORIGIN]), null);
  store.data.set(
    'connect-return:state-5',
    JSON.stringify({ target: 'https://evil.example/', provider: 'facebook' })
  );
  assert.equal(await takeConnectReturn(store, 'state-5', 'facebook', [ORIGIN]), null);
});

test('outcome URLs keep the allowlisted target and add only the outcome', () => {
  const targets = connectReturnTargets({ target: TARGET, provider: 'facebook' });
  assert.equal(targets.connected, `${TARGET}&connect=connected`);
  assert.equal(targets.failed, `${TARGET}&connect=failed`);
  const overwritten = connectReturnTargets({
    target: `${ORIGIN}/return?connect=connected`,
    provider: 'facebook',
  });
  assert.equal(overwritten.failed, `${ORIGIN}/return?connect=failed`);
  assert.equal(CONNECT_RETURN_PROTOCOL, 'connect-return-v1');
});

test('the public API and connect controller use the checks and stay upstream without the variable', () => {
  const fs = require('node:fs');
  const publicApi = fs.readFileSync(
    'apps/backend/src/public-api/routes/v1/public.integrations.controller.ts',
    'utf8'
  );
  assert.match(publicApi, /const returnOrigins = connectReturnOrigins\(\);/);
  assert.match(publicApi, /returnTo && returnOrigins\.length\s+\? validateConnectReturn\(returnTo, returnOrigins\)/);
  assert.match(publicApi, /throw new HttpException\(\{ msg: 'Return target not allowed' \}, 400\)/);
  assert.match(publicApi, /return \{ url, returnIntent: CONNECT_RETURN_PROTOCOL \};/);
  assert.match(publicApi, /protocols: connectReturnOrigins\(\)\.length \? \[CONNECT_RETURN_PROTOCOL\] : \[\]/);
  const connect = fs.readFileSync(
    'apps/backend/src/api/routes/no.auth.integrations.controller.ts',
    'utf8'
  );
  assert.match(connect, /if \(!connectReturn\) \{\s+return this\.connectSocialMediaChannel\(integration, body\);/);
  const page = fs.readFileSync(
    'apps/frontend/src/app/(app)/integrations/social/[provider]/page.tsx',
    'utf8'
  );
  assert.match(page, /!!process\.env\.POSTIZ_CONNECT_RETURN_ORIGINS/);
  const shell = fs.readFileSync(
    'apps/frontend/src/components/launches/connect.return.shell.tsx',
    'utf8'
  );
  assert.doesNotMatch(shell.replace(/POSTIZ_CONNECT_RETURN_ORIGINS/g, ''), /postiz/i);
});
