const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const yaml = require('yaml');
const {
  verifyBracesMitigation,
} = require('./provider.security.mitigation.cjs');

test('locked brace mitigation protects parser and all AST walkers at both dependency consumers', () => {
  verifyBracesMitigation();
  const braces = require('braces');
  assert.deepEqual(braces.expand('post-{a,b}-{1..3}'), [
    'post-a-1',
    'post-a-2',
    'post-a-3',
    'post-b-1',
    'post-b-2',
    'post-b-3',
  ]);
  assert.equal(braces.compile('post-{a,b}'), 'post-(a|b)');
  assert.equal(braces.stringify(braces.parse('post-{a,b}')), 'post-{a,b}');
  const cycle = { type: 'root', nodes: [] };
  cycle.nodes.push(cycle);
  for (const method of ['compile', 'expand', 'stringify'])
    assert.throws(() => braces[method](cycle), { name: 'SyntaxError' });
  assert.deepEqual(
    require('micromatch')(['a.ts', 'b.js', 'c.css'], '*.{ts,js}'),
    ['a.ts', 'b.js']
  );
});

test('Google OAuth clients share one supported class and no legacy P12/forge remains', () => {
  const lock = yaml.parse(fs.readFileSync('pnpm-lock.yaml', 'utf8'));
  assert.equal(
    Object.keys(lock.packages).some((name) =>
      /^(node-forge|google-p12-pem)@/.test(name)
    ),
    false
  );
  const { google } = require('googleapis');
  const { OAuth2Client } = require('google-auth-library');
  const auth = new google.auth.OAuth2(
    'synthetic-client',
    'synthetic-secret',
    'https://synthetic.invalid/callback'
  );
  assert.ok(auth instanceof OAuth2Client);
  const url = new URL(
    auth.generateAuthUrl({
      scope: ['https://www.googleapis.com/auth/youtube'],
      state: 'synthetic-state',
      access_type: 'offline',
    })
  );
  assert.equal(url.searchParams.get('state'), 'synthetic-state');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://synthetic.invalid/callback'
  );
  assert.ok(google.youtube({ version: 'v3', auth }).videos);
  assert.ok(google.oauth2({ version: 'v2', auth }).userinfo);
});

test('patched image processing and sniffing preserve buffer and web-stream contracts', async () => {
  const sharp = require('sharp');
  const { fileTypeFromBuffer, fileTypeStream } = await import('file-type');
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  assert.equal((await fileTypeFromBuffer(bytes)).mime, 'image/png');
  assert.equal(
    await fileTypeFromBuffer(Buffer.from('<html>not an image</html>')),
    undefined
  );
  const stream = await fileTypeStream(
    new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    })
  );
  assert.equal(stream.fileType.mime, 'image/png');
  assert.deepEqual(
    Buffer.from(await new Response(stream).arrayBuffer()),
    bytes
  );
});

test('upgraded email transport retains attachments without any network sending', async () => {
  const transport = require('nodemailer').createTransport({
    jsonTransport: true,
  });
  const result = await transport.sendMail({
    from: 'fixture@example.invalid',
    to: 'fixture@example.invalid',
    subject: 'Synthetic local test',
    text: 'Fixture',
    attachments: [{ filename: 'fixture.txt', content: 'local only' }],
  });
  const message = JSON.parse(result.message);
  assert.equal(message.subject, 'Synthetic local test');
  assert.equal(message.attachments[0].filename, 'fixture.txt');
});

test('GraphQL utility major upgrade preserves schema construction and local execution', async () => {
  const { makeExecutableSchema } = require('@graphql-tools/schema');
  const { graphql } = require('graphql');
  const schema = makeExecutableSchema({
    typeDefs: 'type Query { receipt: String! }',
    resolvers: { Query: { receipt: () => 'synthetic' } },
  });
  const result = await graphql({ schema, source: '{ receipt }' });
  assert.equal(result.errors, undefined);
  assert.equal(result.data.receipt, 'synthetic');
});

test('audit mitigation fails closed for a missing lock entry or modified patch', () => {
  const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const lock = yaml.parse(fs.readFileSync('pnpm-lock.yaml', 'utf8'));
  const verifier = path.resolve('tests/provider.security.mitigation.cjs');
  for (const [dependency, proofFile, verify] of [
    [
      'braces@3.0.3',
      './provider.security.mitigations.json',
      'verifyBracesMitigation',
    ],
    [
      'zod@3.25.76',
      './provider.security.zod-mitigation.json',
      'verifyZodMitigation',
    ],
  ]) {
    const root = fs.mkdtempSync(path.resolve('.orbit/tmp/audit-tamper-'));
    const proof = require(proofFile);
    fs.mkdirSync(path.join(root, 'patches'));
    fs.writeFileSync(
      path.join(root, proof.patch),
      fs.readFileSync(proof.patch)
    );
    for (const mode of ['missing-lock-entry', 'modified-patch']) {
      const fixture = structuredClone(lock);
      if (mode === 'missing-lock-entry')
        delete fixture.patchedDependencies[dependency];
      else fs.appendFileSync(path.join(root, proof.patch), '\nmodified');
      fs.writeFileSync(
        path.join(root, 'pnpm-lock.yaml'),
        yaml.stringify(fixture)
      );
      assert.throws(
        () =>
          execFileSync(
            process.execPath,
            [
              '-e',
              'require(' + JSON.stringify(verifier) + ').' + verify + '()',
            ],
            { cwd: root, stdio: 'pipe' }
          ),
        dependency + ': ' + mode
      );
    }
  }
});

test('patched zod rejects oversized constrained collections before parsing elements', async () => {
  const { z } = require('zod');
  const z4 = require('zod/v4');
  const { oversizedZodSchemas } = require('./provider.security.mitigation.cjs');
  for (const [schema, input] of oversizedZodSchemas(z, z4)) {
    for (const result of [
      schema.safeParse(input),
      await schema.safeParseAsync(input),
    ]) {
      assert.equal(result.success, false);
      assert.deepEqual(
        result.error.issues.map((issue) => issue.code),
        ['too_big']
      );
    }
  }
  // In-bound validation still reports every failing element and accepts valid input.
  for (const [schema, label] of [
    [z.array(z.string()).max(4), 'v3'],
    [z4.array(z4.string()).max(4), 'v4'],
  ]) {
    assert.deepEqual(
      schema.safeParse([1, 'a', 2]).error.issues.map((issue) => issue.path),
      [[0], [2]]
    );
    assert.equal(schema.safeParse(['a', 'b']).success, true, label);
  }
});

test('patched Vite keeps the React plugin public API available to extension builds', async () => {
  const semver = require('semver');
  const { createRequire } = require('node:module');
  const fromPlugin = createRequire(require.resolve('@vitejs/plugin-react'));
  const plugin = JSON.parse(
    fs.readFileSync(
      require('node:path').resolve(
        require('node:path').dirname(require.resolve('@vitejs/plugin-react')),
        '../package.json'
      ),
      'utf8'
    )
  );
  const vite = fromPlugin('vite/package.json');
  assert.ok(semver.satisfies(vite.version, plugin.peerDependencies.vite));
  const { default: react } = await import('@vitejs/plugin-react');
  assert.ok(react());
});

test('patched Tiptap versions preserve exact peer contracts and editor initialization', () => {
  const path = require('node:path');
  const { createRequire } = require('node:module');
  const semver = require('semver');
  const lock = yaml.parse(fs.readFileSync('pnpm-lock.yaml', 'utf8'));
  assert.ok(
    Object.keys(lock.packages)
      .filter((name) => name.startsWith('@tiptap/'))
      .every((name) => name.endsWith('@3.32.0'))
  );
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    getComputedStyle: dom.window.getComputedStyle,
  };
  const previous = {};
  for (const [name, value] of Object.entries(values)) {
    previous[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  let editor;
  try {
    const { Editor } = require('@tiptap/core');
    const { StarterKit } = require('@tiptap/starter-kit');
    const fromReact = createRequire(require.resolve('@tiptap/react'));
    const reactPkg = JSON.parse(
      fs.readFileSync(
        path.resolve(
          path.dirname(fromReact.resolve('@tiptap/react')),
          '../package.json'
        )
      )
    );
    assert.ok(
      semver.satisfies('3.32.0', reactPkg.peerDependencies['@tiptap/core'])
    );
    editor = new Editor({
      element: dom.window.document.createElement('div'),
      extensions: [StarterKit],
      content: '<p>Synthetic approved draft</p>',
    });
    assert.equal(editor.getText(), 'Synthetic approved draft');
  } finally {
    editor?.destroy();
    dom.window.close();
    for (const name of Object.keys(values)) {
      if (previous[name])
        Object.defineProperty(globalThis, name, previous[name]);
      else delete globalThis[name];
    }
  }
});
