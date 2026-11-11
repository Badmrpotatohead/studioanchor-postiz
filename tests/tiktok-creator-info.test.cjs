const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  projectTikTokCreatorInfo,
  TIKTOK_CREATOR_INFO_PROTOCOL,
} = require('../libraries/nestjs-libraries/src/integrations/tiktok.creator.info.ts');

const response = {
  data: {
    creator_avatar_url: 'https://p16-sign.tiktokcdn-us.com/avatar.jpeg',
    creator_nickname: 'Studio QA',
    creator_username: 'must-not-leak',
    privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
    comment_disabled: false,
    duet_disabled: true,
    stitch_disabled: false,
    max_video_post_duration_sec: 180,
    extra_provider_field: 'must-not-leak',
  },
  error: { code: 'ok', message: '', log_id: 'must-not-leak' },
};

test('creator info projection returns only the audit-required fields', () => {
  assert.deepEqual(projectTikTokCreatorInfo(response), {
    nickname: 'Studio QA',
    avatar_url: 'https://p16-sign.tiktokcdn-us.com/avatar.jpeg',
    privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
    comment_disabled: false,
    duet_disabled: true,
    stitch_disabled: false,
    max_video_post_duration_sec: 180,
  });
  assert.doesNotMatch(JSON.stringify(projectTikTokCreatorInfo(response)), /username|log_id|extra_provider/);
});

test('invalid, failed, duplicate, or empty creator responses fail closed', () => {
  for (const value of [
    null,
    {},
    { ...response, error: { code: 'scope_not_authorized' } },
    { ...response, data: { ...response.data, privacy_level_options: [] } },
    { ...response, data: { ...response.data, privacy_level_options: ['SELF_ONLY', 'SELF_ONLY'] } },
    { ...response, data: { ...response.data, max_video_post_duration_sec: 0 } },
  ]) assert.throws(() => projectTikTokCreatorInfo(value));
});

test('public route is organization-scoped and advertises the protocol', () => {
  const source = fs.readFileSync('apps/backend/src/public-api/routes/v1/public.integrations.controller.ts', 'utf8');
  assert.match(source, /@Get\('\/integrations\/:id\/tiktok-creator-info'\)/);
  assert.match(source, /getIntegrationById\(\s*org\.id,\s*id\s*\)/);
  assert.match(source, /integration\.providerIdentifier !== 'tiktok'/);
  assert.match(source, /return await provider\.creatorInfo\(accessToken\)/);
  assert.match(source, /TIKTOK_CREATOR_INFO_PROTOCOL/);
  assert.equal(TIKTOK_CREATOR_INFO_PROTOCOL, 'tiktok-creator-info-v1');
});
