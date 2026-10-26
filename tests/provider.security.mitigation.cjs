const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const yaml = require('yaml');
const hash = (file) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function verifyBracesMitigation() {
  const proof = require('./provider.security.mitigations.json');
  const lock = yaml.parse(fs.readFileSync('pnpm-lock.yaml', 'utf8'));
  const entry = lock.patchedDependencies?.['braces@3.0.3'];
  assert.equal(entry?.path, proof.patch);
  assert.equal(hash(proof.patch), proof.patchSha256);
  assert.equal(entry.hash, proof.patchSha256);
  const snapshots = Object.keys(lock.snapshots).filter((key) =>
    key.startsWith('braces@')
  );
  assert.ok(snapshots.length > 0);
  assert.ok(
    snapshots.every(
      (key) => key === 'braces@3.0.3(patch_hash=' + entry.hash + ')'
    )
  );
  for (const consumer of ['micromatch', 'chokidar']) {
    const resolve = createRequire(require.resolve(consumer));
    const main = resolve.resolve('braces');
    const root = path.dirname(main);
    for (const [name, expected] of Object.entries(proof.files))
      assert.equal(
        hash(path.join(root, name)),
        expected,
        consumer + ': ' + name
      );
    const braces = resolve('braces');
    for (const input of [
      '{'.repeat(20000) + 'x' + '}'.repeat(20000),
      '('.repeat(20000) + 'x' + ')'.repeat(20000),
    ]) {
      for (const method of ['parse', 'compile', 'expand', 'stringify'])
        assert.throws(() => braces[method](input), { name: 'SyntaxError' });
    }
    let ast = { type: 'text', value: 'x' };
    for (let i = 0; i < 20000; i++) ast = { type: 'brace', nodes: [ast] };
    for (const method of ['compile', 'expand', 'stringify'])
      assert.throws(() => braces[method](ast), { name: 'SyntaxError' });
  }
  return proof;
}
// Oversized constrained collections for both the v3 API and the bundled v4 core.
function oversizedZodSchemas(z, z4) {
  const n = 100000;
  const array = Array.from({ length: n }, () => 1);
  const set = new Set(array.map((_, i) => i));
  const map = new Map(array.map((_, i) => [i, i]));
  return [
    [z.array(z.string()).max(4), array],
    [z.array(z.string()).length(4), array],
    [z.set(z.string()).max(4), set],
    [z4.array(z4.string()).max(4), array],
    [z4.array(z4.string()).length(4), array],
    [z4.set(z4.string()).max(4), set],
    [z4.map(z4.number(), z4.string()).check(z4.maxSize(4)), map],
  ];
}
function verifyZodMitigation() {
  const proof = require('./provider.security.zod-mitigation.json');
  const lock = yaml.parse(fs.readFileSync('pnpm-lock.yaml', 'utf8'));
  const entry = lock.patchedDependencies?.['zod@3.25.76'];
  assert.equal(entry?.path, proof.patch);
  assert.equal(hash(proof.patch), proof.patchSha256);
  assert.equal(entry.hash, proof.patchSha256);
  const snapshots = Object.keys(lock.snapshots).filter((key) =>
    key.startsWith('zod@3')
  );
  assert.ok(snapshots.length > 0);
  assert.ok(
    snapshots.every(
      (key) => key === 'zod@3.25.76(patch_hash=' + entry.hash + ')'
    )
  );
  // The root runtime, the Bluesky lexicon client and the AI SDK all load zod 3.
  for (const consumer of [
    path.resolve(__dirname, '../package.json'),
    require.resolve('@atproto/lexicon'),
    require.resolve('@ai-sdk/provider-utils'),
  ]) {
    const resolve = createRequire(consumer);
    const root = path.dirname(resolve.resolve('zod/package.json'));
    assert.equal(resolve('zod/package.json').version, '3.25.76', consumer);
    for (const [name, expected] of Object.entries(proof.files))
      assert.equal(
        hash(path.join(root, name)),
        expected,
        consumer + ': ' + name
      );
    for (const [schema, input] of oversizedZodSchemas(
      resolve('zod').z,
      resolve('zod/v4')
    )) {
      const result = schema.safeParse(input);
      assert.equal(result.success, false);
      assert.deepEqual(
        result.error.issues.map((issue) => issue.code),
        ['too_big']
      );
    }
  }
  return proof;
}
module.exports = {
  verifyBracesMitigation,
  verifyZodMitigation,
  oversizedZodSchemas,
};
