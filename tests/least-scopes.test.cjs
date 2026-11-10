require('reflect-metadata');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

process.env.STORAGE_PROVIDER = 'local';
process.env.UPLOAD_DIRECTORY = process.env.UPLOAD_DIRECTORY || require('node:os').tmpdir();
Object.assign(process.env, {
  FACEBOOK_APP_ID: 'facebook-client',
  LINKEDIN_CLIENT_ID: 'linkedin-client',
  LINKEDIN_CLIENT_SECRET: 'linkedin-secret',
  TIKTOK_CLIENT_ID: 'tiktok-client',
  TIKTOK_CLIENT_SECRET: 'tiktok-secret',
  FRONTEND_URL: 'https://publish.example.test',
});

const { FacebookProvider } = require('../libraries/nestjs-libraries/src/integrations/social/facebook.provider.ts');
const { InstagramProvider } = require('../libraries/nestjs-libraries/src/integrations/social/instagram.provider.ts');
const { ThreadsProvider } = require('../libraries/nestjs-libraries/src/integrations/social/threads.provider.ts');
const { TiktokProvider } = require('../libraries/nestjs-libraries/src/integrations/social/tiktok.provider.ts');
const { YoutubeProvider } = require('../libraries/nestjs-libraries/src/integrations/social/youtube.provider.ts');
const { LinkedinProvider } = require('../libraries/nestjs-libraries/src/integrations/social/linkedin.provider.ts');
const { LinkedinPageProvider } = require('../libraries/nestjs-libraries/src/integrations/social/linkedin.page.provider.ts');
const { PinterestProvider } = require('../libraries/nestjs-libraries/src/integrations/social/pinterest.provider.ts');

const providers = {
  facebook: new FacebookProvider(),
  instagram: new InstagramProvider(),
  threads: new ThreadsProvider(),
  tiktok: new TiktokProvider(),
  youtube: new YoutubeProvider(),
  linkedin: new LinkedinProvider(),
  linkedinPage: new LinkedinPageProvider(),
  pinterest: new PinterestProvider(),
};

test('each provider requests exactly StudioAnchor least-privilege scopes', () => {
  assert.deepEqual(providers.facebook.scopes, ['pages_show_list', 'business_management', 'pages_manage_posts', 'pages_read_engagement', 'read_insights']);
  assert.deepEqual(providers.instagram.scopes, ['instagram_basic', 'pages_show_list', 'pages_read_engagement', 'business_management', 'instagram_content_publish', 'instagram_manage_insights']);
  assert.deepEqual(providers.threads.scopes, ['threads_basic', 'threads_content_publish']);
  assert.deepEqual(providers.tiktok.scopes, ['user.info.basic', 'video.publish']);
  assert.deepEqual(providers.youtube.scopes, ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.upload']);
  assert.deepEqual(providers.linkedin.scopes, ['openid', 'profile', 'w_member_social']);
  assert.deepEqual(providers.linkedinPage.scopes, ['openid', 'profile', 'w_member_social', 'rw_organization_admin', 'w_organization_social', 'r_organization_social']);
  assert.deepEqual(providers.pinterest.scopes, ['boards:read', 'boards:write', 'pins:read', 'pins:write', 'user_accounts:read']);
});

test('TikTok identity requests only user.info.basic fields and creator info uses video.publish endpoint', async () => {
  const nativeFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes('/oauth/token/')) return new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', scope: 'user.info.basic,video.publish' }));
    if (String(url).includes('/user/info/')) return new Response(JSON.stringify({ data: { user: { open_id: 'abc-def', avatar_url: 'avatar', display_name: 'Studio QA' } } }));
    return new Response(JSON.stringify({ data: { creator_nickname: 'Studio QA', creator_avatar_url: 'avatar', privacy_level_options: ['SELF_ONLY'], comment_disabled: false, duet_disabled: false, stitch_disabled: false, max_video_post_duration_sec: 60 }, error: { code: 'ok' } }));
  };
  try {
    const identity = await providers.tiktok.authenticate({ code: 'code', codeVerifier: 'verifier' });
    assert.equal(identity.name, 'Studio QA');
    assert.match(requests[1], /fields=open_id,avatar_url,display_name$/);
    assert.doesNotMatch(requests[1], /username|union_id|bio|stats/);
    await providers.tiktok.creatorInfo('access');
    assert.match(requests[2], /\/post\/publish\/creator_info\/query\/$/);
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test('LinkedIn identity uses only OpenID userinfo for personal and page connections', async () => {
  const nativeFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    if (String(url).includes('/accessToken')) return new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'openid,profile,w_member_social,rw_organization_admin,w_organization_social,r_organization_social' }));
    return new Response(JSON.stringify({ sub: 'member-1', name: 'Studio Owner', picture: 'avatar' }));
  };
  try {
    const personal = await providers.linkedin.authenticate({ code: 'code', codeVerifier: 'verifier' });
    const page = await providers.linkedinPage.authenticate({ code: 'code', codeVerifier: 'verifier' });
    assert.equal(personal.id, 'member-1');
    assert.equal(page.id, 'linkedin-page_member-1');
    assert.equal(requests.filter((url) => url.endsWith('/v2/userinfo')).length, 2);
    assert.equal(requests.filter((url) => url.endsWith('/v2/me')).length, 0);
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test('dropped comment, reply and Threads insight paths make no provider request', async () => {
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async () => assert.fail('a dropped-scope endpoint was called');
  try {
    assert.deepEqual(await providers.facebook.comment('id', 'post', undefined, 'token', [], {}), []);
    assert.deepEqual(await providers.instagram.comment('id', 'post', undefined, 'token', [], {}), []);
    assert.deepEqual(await providers.threads.comment('id', 'post', undefined, 'token', [], {}), []);
    assert.deepEqual(await providers.threads.analytics('id', 'token', 7), []);
    assert.deepEqual(await providers.threads.postAnalytics('id', 'token', 'post', 7), []);
    assert.equal(await providers.threads.autoPlugPost({}, 'post', { likesAmount: '1', post: 'promo' }), false);
  } finally {
    globalThis.fetch = nativeFetch;
  }
});

test('YouTube identity and channel lookup stay on retained scopes', () => {
  const source = fs.readFileSync('libraries/nestjs-libraries/src/integrations/social/youtube.provider.ts', 'utf8');
  assert.match(source, /oauth2\(client\)[\s\S]*userinfo\.get\(\)/);
  assert.match(source, /channels\.list\(\{\s*part: \['snippet'\],\s*mine: true/);
  assert.doesNotMatch(source, /part: \['snippet', 'contentDetails', 'statistics'\]/);
});

test('TikTok inbox-upload drafts fail before an endpoint requiring video.upload is selected', () => {
  const source = fs.readFileSync('libraries/nestjs-libraries/src/integrations/social/tiktok.provider.ts', 'utf8');
  assert.match(source, /TikTok inbox upload is unavailable; choose Direct Post/);
  assert.doesNotMatch(source, /\/inbox\/video\/init\//);
});
