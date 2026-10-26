const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { gzipSync } = require('node:zlib');
const {
  createMcpInputLimits,
} = require('../libraries/nestjs-libraries/src/chat/mcp.input-limits.ts');

const paths = [
  '/mcp',
  '/mcp/synthetic',
  '/mcp-oauth',
  '/mcp-oauth-chatgpt',
  '/mcp-oauth-claude',
  '/mcp-oauth-dynamic',
  '/sse/synthetic',
  '/message/synthetic',
];
async function fixture(t) {
  const app = express();
  let validated = 0;
  app.use(paths, ...createMcpInputLimits());
  app.use((_req, res) => {
    validated++;
    res.json({ ok: true });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return {
    validated: () => validated,
    send: async (path, body, options = {}) => {
      const headers = {
        'content-type': 'application/json',
        ...options.headers,
      };
      if (options.noContentType) delete headers['content-type'];
      const response = await fetch(
        'http://127.0.0.1:' + server.address().port + path,
        {
          method: options.method || 'POST',
          headers,
          ...(body !== undefined
            ? { body: options.raw ? body : JSON.stringify(body) }
            : {}),
          signal: AbortSignal.timeout(5000),
        }
      );
      return { status: response.status, body: await response.json() };
    },
  };
}

test('all MCP transport paths accept normal JSON and preserve body-free requests', async (t) => {
  const f = await fixture(t);
  for (const path of paths) {
    assert.equal(
      (
        await f.send(path, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'synthetic',
            arguments: { caption: 'Approved fixture', items: [1, 2, 3] },
          },
        })
      ).status,
      200
    );
    assert.equal(
      (await f.send(path, undefined, { method: 'GET' })).status,
      200
    );
  }
  assert.equal(f.validated(), paths.length * 2);
});

test('all MCP paths reject oversized bodies before validation', async (t) => {
  const f = await fixture(t);
  for (const path of paths)
    assert.deepEqual(await f.send(path, { caption: 'x'.repeat(256 * 1024) }), {
      status: 413,
      body: { error: 'invalid_request' },
    });
  assert.equal(f.validated(), 0);
});

test('MCP caps decoded compressed bytes, not only the wire payload', async (t) => {
  const f = await fixture(t);
  const bytes = gzipSync(
    Buffer.from(JSON.stringify({ caption: 'x'.repeat(256 * 1024) }))
  );
  assert.ok(bytes.length < 1000);
  assert.equal(
    (
      await f.send('/mcp', bytes, {
        raw: true,
        headers: { 'content-encoding': 'gzip' },
      })
    ).status,
    413
  );
  assert.equal(f.validated(), 0);
});

test('all MCP paths reject unsupported or missing media types before raw-stream fallback', async (t) => {
  const f = await fixture(t);
  const bytes = Buffer.alloc(256 * 1024 + 1, 'x');
  for (const path of paths) {
    for (const type of ['text/plain', 'application/octet-stream']) {
      assert.equal(
        (
          await f.send(path, bytes, {
            raw: true,
            headers: { 'content-type': type },
          })
        ).status,
        415
      );
    }
    assert.equal(
      (await f.send(path, bytes, { raw: true, noContentType: true })).status,
      415
    );
  }
  assert.equal(f.validated(), 0);
});

test('MCP rejects small-byte arrays or objects exceeding the element budget', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.send('/mcp', { params: { arguments: Array(10_001).fill(0) } }))
      .status,
    413
  );
  assert.equal(
    (
      await f.send('/mcp', {
        params: {
          arguments: Object.fromEntries(
            Array.from({ length: 10_001 }, (_, i) => ['k' + i, 0])
          ),
        },
      })
    ).status,
    413
  );
  assert.equal(f.validated(), 0);
});

test('MCP rejects excessive nesting and malformed JSON without echoing input', async (t) => {
  const f = await fixture(t);
  let value = {};
  for (let i = 0; i < 66; i++) value = { nested: value };
  assert.deepEqual(await f.send('/message/synthetic', value), {
    status: 413,
    body: { error: 'invalid_request' },
  });
  assert.deepEqual(await f.send('/mcp', '{private-fixture:', { raw: true }), {
    status: 400,
    body: { error: 'invalid_request' },
  });
  assert.equal(f.validated(), 0);
});
