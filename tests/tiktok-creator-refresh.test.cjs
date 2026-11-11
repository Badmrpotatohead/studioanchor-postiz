const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(
  'apps/backend/src/public-api/routes/v1/public.integrations.controller.ts',
  'utf8'
);
const start = source.indexOf('async getTikTokCreatorInfo(');
const route = source.slice(start, source.indexOf('@Get(', start));

test('creator info renews an expired TikTok token before asking TikTok', () => {
  assert.ok(start > 0, 'route present');
  assert.match(route, /dayjs\(integration\.tokenExpiration\)\.isBefore\(dayjs\(\)\.add\(1, 'minute'\)\)/);
  assert.match(route, /!integration\.tokenExpiration/);
  assert.match(route, /this\._refreshIntegrationService\s*\.refresh\(integration\)/);
  assert.match(route, /accessToken = refreshed\.accessToken/);
  assert.ok(
    route.indexOf('.refresh(integration)') < route.indexOf('provider.creatorInfo(accessToken)'),
    'refresh happens before the TikTok call'
  );
  assert.doesNotMatch(route, /creatorInfo\(integration\.token\)/);
});

test('a channel that cannot be renewed answers 409 reconnect, never 500', () => {
  assert.match(route, /integration\.refreshNeeded \|\| integration\.inBetweenSteps/);
  const reconnect = route.match(/TikTok account must be reconnected' \}, 409/g) || [];
  assert.equal(reconnect.length, 2);
  assert.match(route, /\.catch\(\(\) => false as const\)/);
});

test('a TikTok failure is reported as 502 without provider details', () => {
  assert.match(route, /catch \{\s*throw new HttpException\(\{ msg: 'TikTok creator information unavailable' \}, 502\)/);
});

test('the organization scoping and channel checks are unchanged', () => {
  assert.match(route, /getIntegrationById\(\s*org\.id,\s*id\s*\)/);
  assert.match(route, /integration\.providerIdentifier !== 'tiktok'/);
  assert.match(route, /integration\.deletedAt/);
  assert.match(route, /integration\.disabled/);
});
