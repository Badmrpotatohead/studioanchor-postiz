const test = require('node:test');
const assert = require('node:assert/strict');
const {
  uploadStreamToStorage,
} = require('../libraries/nestjs-libraries/src/upload/custom.upload.validation.ts');
const webStream = (bytes) =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

test('real upload validation retains exact bytes, MIME and stream cap after file-type/sharp upgrades', async () => {
  const bytes = await require('sharp')({
    create: { width: 2, height: 2, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  let received;
  const storage = {
    uploadStream: async (body, mime, ext) => {
      const chunks = [];
      for await (const chunk of body) chunks.push(chunk);
      received = { bytes: Buffer.concat(chunks), mime, ext };
      return { path: 'synthetic/local.png' };
    },
  };
  assert.equal(
    (await uploadStreamToStorage(storage, webStream(bytes))).path,
    'synthetic/local.png'
  );
  assert.deepEqual(received, { bytes, mime: 'image/png', ext: 'png' });
  await assert.rejects(
    uploadStreamToStorage(
      storage,
      webStream(Buffer.from('<html>invalid</html>'))
    ),
    /Unsupported file type/
  );
  await assert.rejects(
    uploadStreamToStorage(storage, webStream(bytes), 10 * 1024 * 1024 + 1),
    /File is too large/
  );
  await assert.rejects(
    uploadStreamToStorage(
      storage,
      webStream(Buffer.concat([bytes, Buffer.alloc(10 * 1024 * 1024)]))
    ),
    /File is too large/
  );
});

test('real DNS-pinning dispatcher still rejects private resolution before sending any request', async () => {
  const http = require('node:http'),
    dns = require('node:dns');
  const { once } = require('node:events');
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests++;
    response.end('synthetic');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const original = dns.lookup;
  const previous = process.env.DISABLE_SSRF_PROTECTION;
  delete process.env.DISABLE_SSRF_PROTECTION;
  dns.lookup = (_host, options, callback) =>
    callback(
      null,
      options.all ? [{ address: '127.0.0.1', family: 4 }] : '127.0.0.1',
      4
    );
  const {
    getSsrfSafeDispatcher,
  } = require('../libraries/nestjs-libraries/src/dtos/webhooks/ssrf.safe.dispatcher.ts');
  const dispatcher = getSsrfSafeDispatcher();
  try {
    await assert.rejects(
      fetch('http://ssrf-fixture.invalid:' + server.address().port, {
        dispatcher,
        signal: AbortSignal.timeout(3000),
      }),
      (error) => error.cause?.message === 'Blocked IP'
    );
    assert.equal(requests, 0);
  } finally {
    dns.lookup = original;
    if (previous === undefined) delete process.env.DISABLE_SSRF_PROTECTION;
    else process.env.DISABLE_SSRF_PROTECTION = previous;
    await dispatcher.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
