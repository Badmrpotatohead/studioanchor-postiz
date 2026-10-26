import 'reflect-metadata';
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { PublicDeliveryController } from '../apps/backend/src/public-api/routes/v1/public.delivery.controller';
import { DeliveryStopService } from '../libraries/nestjs-libraries/src/database/prisma/posts/delivery.stop.service';
import { DeliveryStopRepository } from '../libraries/nestjs-libraries/src/database/prisma/posts/delivery.stop.repository';
import { PrismaRepository } from '../libraries/nestjs-libraries/src/database/prisma/prisma.service';
import { PostsRepository } from '../libraries/nestjs-libraries/src/database/prisma/posts/posts.repository';

// Refuse all non-disposable databases; there are no production credentials here.
assert.equal(
  process.env.DATABASE_URL,
  'postgresql://sivants@127.0.0.1:55439/postgres?schema=stop_proof'
);
const db = new PrismaClient();
const repository = new DeliveryStopRepository({ model: db } as never);
const otherProcess = new DeliveryStopRepository({
  model: new PrismaClient(),
} as never);
const org = `stop-proof-${randomUUID()}`,
  integration = `channel-${randomUUID()}`;
const date = new Date(Date.now() + 86400000).toISOString();
const payload = () => ({
  requestId: 'a'.repeat(64),
  binding: 'b'.repeat(64),
  integrationId: integration,
  content: 'Synthetic stop proof only',
  images: [],
  scheduledAt: date,
});
async function seed(control: string | null = 'ARMED') {
  return db.post.create({
    data: {
      organizationId: org,
      integrationId: integration,
      publishDate: new Date(date),
      state: 'QUEUE',
      content: payload().content,
      image: '[]',
      group: randomUUID(),
      dispatchControl: control,
    },
  });
}
let app: import('@nestjs/common').INestApplication;
let origin: string;
before(async () => {
  await db.organization.create({
    data: { id: org, name: 'Disposable stop-proof fixture' },
  });
  await db.integration.create({
    data: {
      id: integration,
      organizationId: org,
      internalId: integration,
      name: 'Synthetic account',
      providerIdentifier: 'bluesky',
      type: 'social',
      token: 'synthetic-never-used',
    },
  });
  const testingModule = await Test.createTestingModule({
    controllers: [PublicDeliveryController],
    providers: [
      DeliveryStopService,
      DeliveryStopRepository,
      { provide: PrismaRepository, useValue: { model: db } },
    ],
  }).compile();
  app = testingModule.createNestApplication({ logger: false });
  app.use((req: any, res: any, next: () => void) => {
    if (!req.headers.authorization) return res.status(401).end();
    req.org = { id: req.headers.authorization };
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();
});
after(async () => {
  await app?.close();
  await db.$disconnect();
  await (otherProcess as any)._post.model.$disconnect();
});

test('real authenticated controller + DTO + service + Prisma persists one stop and recovers it read-only', async () => {
  const post = await seed();
  const response = await fetch(`${origin}/public/v1/posts/${post.id}/stop`, {
    method: 'POST',
    headers: { authorization: org, 'content-type': 'application/json' },
    body: JSON.stringify(payload()),
  });
  assert.equal(response.status, 201);
  const receipt: any = await response.json();
  assert.equal(receipt.state, 'STOPPED');
  assert.equal(await repository.claim(org, post.id, date, 'late-start'), false);
  assert.deepEqual(
    await otherProcess.receipt(org, post.id, payload().requestId),
    receipt
  );
  assert.deepEqual(await repository.stop(org, post.id, payload()), receipt);
  for (const tenant of ['foreign', null]) {
    const res = await fetch(
      `${origin}/public/v1/posts/${post.id}/stop/${payload().requestId}`,
      { headers: tenant ? { authorization: tenant } : {} }
    );
    assert.equal(res.status, tenant ? 404 : 401);
  }
  const invalid = await fetch(`${origin}/public/v1/posts/${post.id}/stop`, {
    method: 'POST',
    headers: { authorization: org, 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload(), requestId: '../arbitrary' }),
  });
  assert.equal(invalid.status, 400);
});

test('100 independent-process stop/dispatch races never prove cancellation after a dispatch claim', async () => {
  let stopped = 0,
    claimed = 0;
  for (let n = 0; n < 100; n++) {
    const post = await seed();
    const operations =
      n % 2
        ? [
            repository.stop(org, post.id, payload()),
            new Promise((resolve) => setTimeout(resolve, 10)).then(() =>
              otherProcess.claim(org, post.id, date, `worker-${n}`)
            ),
          ]
        : [
            otherProcess.claim(org, post.id, date, `worker-${n}`),
            repository.stop(org, post.id, payload()),
          ];
    await Promise.allSettled(operations);
    const row = await db.post.findUniqueOrThrow({ where: { id: post.id } });
    if (row.dispatchControl === 'STOPPED') {
      stopped++;
      assert.equal(JSON.parse(row.deliveryStopReceipt!).state, 'STOPPED');
      assert.equal(row.dispatchClaim, null);
      assert.equal(
        await otherProcess.claim(org, post.id, date, 'late-worker'),
        false
      );
    } else {
      claimed++;
      assert.equal(row.dispatchControl, 'CLAIMED');
      const receipt = await repository.stop(org, post.id, payload());
      assert.equal(receipt.state, 'UNCONFIRMED');
      assert.equal(
        await repository.claim(org, post.id, date, `worker-${n}`),
        true
      ); // lost activity acknowledgement
      assert.equal(
        await repository.claim(org, post.id, date, 'new-workflow-run'),
        false
      );
    }
  }
  assert.ok(stopped);
  assert.ok(claimed);
});

test('legacy, missing, changed and grouped/recurring posts never acquire a false stop proof', async () => {
  const legacy = await seed(null);
  await assert.rejects(repository.stop(org, legacy.id, payload()));
  await assert.rejects(repository.stop(org, 'missing', payload()));
  for (const patch of [
    { content: 'externally edited' },
    { integrationId: 'other' },
    { scheduledAt: new Date().toISOString() },
    {
      images: [
        { id: 'other', path: 'https://synthetic.invalid/image', alt: 'Other' },
      ],
    },
  ]) {
    const post = await seed();
    await assert.rejects(
      repository.stop(org, post.id, { ...payload(), ...patch })
    );
    assert.equal(
      (await db.post.findUniqueOrThrow({ where: { id: post.id } }))
        .dispatchControl,
      'ARMED'
    );
  }
  for (const patch of [
    { intervalInDays: 1 },
    {
      state: 'PUBLISHED' as const,
      releaseURL: 'https://bsky.app/profile/synthetic/post/one',
    },
    { deletedAt: new Date() },
  ]) {
    const post = await seed();
    await db.post.update({ where: { id: post.id }, data: patch });
    await assert.rejects(repository.stop(org, post.id, payload()));
  }
  const root = await seed();
  await db.post.create({
    data: {
      organizationId: org,
      integrationId: integration,
      publishDate: new Date(date),
      content: 'child',
      group: root.group,
      parentPostId: root.id,
    },
  });
  await assert.rejects(repository.stop(org, root.id, payload()));
  assert.equal(await repository.claim(org, root.id, date, 'worker'), false);
});

test('normal repository creates opt-in drafts and cannot restore a stopped root or rearm a claimed root', async () => {
  const normal = new PostsRepository(
    ...(Array(6).fill({ model: db }) as [
      never,
      never,
      never,
      never,
      never,
      never
    ])
  );
  const body = {
    integration: { id: integration },
    value: [{ content: payload().content, image: [] }],
    settings: { __type: 'bluesky' },
  };
  const { posts } = await normal.createOrUpdatePost(
    'draft',
    org,
    date,
    body as never,
    [],
    'API',
    undefined,
    false,
    true
  );
  assert.equal(posts[0].dispatchControl, 'ARMED');
  await normal.createOrUpdatePost(
    'schedule',
    org,
    date,
    { ...body, value: [{ ...body.value[0], id: posts[0].id }] } as never,
    [],
    'API'
  );
  await repository.stop(org, posts[0].id, payload());
  await assert.rejects(
    normal.createOrUpdatePost(
      'schedule',
      org,
      date,
      { ...body, value: [{ ...body.value[0], id: posts[0].id }] } as never,
      [],
      'API'
    )
  );
  assert.equal(
    (await db.post.findUniqueOrThrow({ where: { id: posts[0].id } }))
      .dispatchControl,
    'STOPPED'
  );
});

test('date and customer status edits cannot rearm a claimed or stopped root', async () => {
  const normal = new PostsRepository(
    ...(Array(6).fill({ model: db }) as [
      never,
      never,
      never,
      never,
      never,
      never
    ])
  );
  for (const control of ['CLAIMED', 'STOPPED']) {
    const post = await seed(control);
    await assert.rejects(normal.changeDate(org, post.id, date, false));
    await assert.rejects(normal.changeRequestedState(org, post.id, 'QUEUE'));
    assert.equal(
      (await db.post.findUniqueOrThrow({ where: { id: post.id } }))
        .dispatchControl,
      control
    );
  }
});

test('image evidence compares exact identity, path and alt text regardless of JSON property order', async () => {
  const post = await seed();
  await db.post.update({
    where: { id: post.id },
    data: {
      image: JSON.stringify([
        {
          alt: 'Approved description',
          path: 'https://synthetic.invalid/image.png',
          id: 'approved-image',
        },
      ]),
    },
  });
  const input = {
    ...payload(),
    images: [
      {
        id: 'approved-image',
        path: 'https://synthetic.invalid/image.png',
        alt: 'Approved description',
      },
    ],
  };
  assert.equal((await repository.stop(org, post.id, input)).state, 'STOPPED');
  assert.equal(
    await repository.claim(org, post.id, date, 'late-image-worker'),
    false
  );
});

test('late claimed dispatch records a durable negative result without changing delivery, even after completion', async () => {
  const due = new Date(Date.now() - 60000);
  for (const state of ['QUEUE', 'ERROR', 'PUBLISHED'] as const) {
    const post = await seed('CLAIMED');
    const data = {
      state,
      publishDate: due,
      dispatchClaim: 'original-run',
      ...(state === 'PUBLISHED'
        ? {
            releaseId: 'release',
            releaseURL: 'https://bsky.app/profile/synthetic/post/late',
          }
        : {}),
    };
    await db.post.update({ where: { id: post.id }, data });
    const input = { ...payload(), scheduledAt: due.toISOString() };
    const receipt = await repository.stop(org, post.id, input);
    assert.equal(receipt.state, 'UNCONFIRMED');
    assert.equal(receipt.stoppedAt, null);
    assert.deepEqual(
      await otherProcess.receipt(org, post.id, input.requestId),
      receipt
    );
    assert.deepEqual(await repository.stop(org, post.id, input), receipt);
    const after = await db.post.findUniqueOrThrow({ where: { id: post.id } });
    assert.equal(after.state, state);
    assert.equal(after.deletedAt, null);
    assert.equal(after.dispatchControl, 'CLAIMED');
    assert.equal(
      await repository.claim(org, post.id, input.scheduledAt, 'another-run'),
      false
    );
  }
  const armed = await seed();
  await db.post.update({ where: { id: armed.id }, data: { publishDate: due } });
  await assert.rejects(
    repository.stop(org, armed.id, {
      ...payload(),
      scheduledAt: due.toISOString(),
    })
  );
  assert.equal(
    (await db.post.findUniqueOrThrow({ where: { id: armed.id } }))
      .deliveryStopReceipt,
    null
  );
});
