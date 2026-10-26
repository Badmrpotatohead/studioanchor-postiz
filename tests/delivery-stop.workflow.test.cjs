// Run after generating the workflow bundle with the repo-local SWC baseUrl override.
const assert = require('node:assert/strict');
const { TestWorkflowEnvironment } = require('@temporalio/testing');
const { Worker } = require('@temporalio/worker');
const { activityInfo } = require('@temporalio/activity');
const { PrismaClient } = require('@prisma/client');
const {
  DeliveryStopRepository,
} = require('../libraries/nestjs-libraries/src/database/prisma/posts/delivery.stop.repository.ts');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
(async () => {
  assert.equal(
    process.env.DATABASE_URL,
    'postgresql://sivants@127.0.0.1:55439/postgres?schema=stop_proof'
  );
  const db = new PrismaClient(),
    repo = new DeliveryStopRepository({ model: db });
  const env = await TestWorkflowEnvironment.createTimeSkipping({
    server: {
      executable: {
        type: 'cached-download',
        downloadDir: path.resolve('.orbit/tmp/temporal-server'),
      },
    },
  });
  try {
    const org = 'workflow-' + randomUUID(),
      integration = 'workflow-channel-' + randomUUID();
    await db.organization.create({
      data: { id: org, name: 'Synthetic Temporal QA' },
    });
    await db.integration.create({
      data: {
        id: integration,
        internalId: integration,
        organizationId: org,
        name: 'Synthetic Bluesky',
        providerIdentifier: 'bluesky',
        type: 'social',
        token: 'synthetic',
      },
    });
    for (const scenario of ['stop-before-dispatch', 'dispatch-before-stop']) {
      const date = new Date(
        Date.now() + (scenario === 'dispatch-before-stop' ? -60000 : 86400000)
      ).toISOString();
      const post = await db.post.create({
        data: {
          organizationId: org,
          integrationId: integration,
          publishDate: new Date(date),
          content: 'Synthetic worker test',
          image: '[]',
          group: randomUUID(),
          state: 'QUEUE',
          dispatchControl: 'ARMED',
        },
      });
      const input = {
        requestId: 'c'.repeat(64),
        binding: 'd'.repeat(64),
        integrationId: integration,
        content: post.content,
        images: [],
        scheduledAt: date,
      };
      let readResolve, dispatchResolve, releaseDispatch;
      const read = new Promise((r) => (readResolve = r)),
        dispatched = new Promise((r) => (dispatchResolve = r)),
        release = new Promise((r) => (releaseDispatch = r));
      let mutations = 0;
      const worker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: 'stop-proof',
        workflowBundle: {
          codePath: path.resolve('.orbit/tmp/stop-proof-workflow-bundle.js'),
        },
        activities: {
          getPost: async () => {
            const row = await db.post.findUnique({ where: { id: post.id } });
            readResolve();
            return row.deletedAt ? false : row;
          },
          claimControlledDispatch: (o, id, at) =>
            repo.claim(o, id, at, activityInfo().workflowExecution.runId),
          getPostsList: () =>
            db.post.findMany({
              where: { id: post.id, deletedAt: null },
              include: { integration: true },
            }),
          postSocialPending: async () => {
            mutations++;
            dispatchResolve();
            await release;
            return [
              {
                id: post.id,
                postId: 'synthetic-release',
                releaseURL:
                  'https://bsky.app/profile/synthetic.test/post/worker',
                status: 'success',
              },
            ];
          },
          updatePost: async (id, releaseId, releaseURL) =>
            db.post.update({
              where: { id },
              data: { releaseId, releaseURL, state: 'PUBLISHED' },
            }),
          inAppNotification: async () => {},
          sendWebhooks: async () => {},
          internalPlugs: async () => [],
          globalPlugs: async () => [],
        },
      });
      await worker.runUntil(async () => {
        const handle = await env.client.workflow.start('postWorkflowV113', {
          workflowId: 'proof-' + randomUUID(),
          taskQueue: 'stop-proof',
          args: [
            { postId: post.id, organizationId: org, taskQueue: 'stop-proof' },
          ],
        });
        if (scenario === 'stop-before-dispatch') {
          await read;
          assert.equal((await repo.stop(org, post.id, input)).state, 'STOPPED');
          releaseDispatch();
          await handle.result();
          assert.equal(mutations, 0);
          assert.equal(await repo.claim(org, post.id, date, 'restart'), false);
        } else {
          const result = handle.result();
          await dispatched;
          assert.equal(
            (await repo.stop(org, post.id, input)).state,
            'UNCONFIRMED'
          );
          releaseDispatch();
          await result;
          assert.equal(mutations, 1);
        }
      });
      console.log('PASS actual Temporal worker:', scenario);
    }
  } finally {
    await env.teardown();
    await db.$disconnect();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
