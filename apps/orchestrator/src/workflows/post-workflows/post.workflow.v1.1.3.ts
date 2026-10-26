import { proxyActivities, sleep } from '@temporalio/workflow';
import type { PostActivity } from '@gitroom/orchestrator/activities/post.activity';
import { postWorkflowV112 } from './post.workflow.v1.1.2';

const { getPost, claimControlledDispatch } = proxyActivities<PostActivity>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 3 },
});

/** Opt-in, nonrepeating single posts only. Keep every shipped workflow unchanged. */
export async function postWorkflowV113(input: {
  taskQueue: string;
  postId: string;
  organizationId: string;
}) {
  const post = await getPost(input.organizationId, input.postId);
  if (!post || post.state !== 'QUEUE' || post.intervalInDays) return;
  await sleep(Math.max(0, new Date(post.publishDate).getTime() - Date.now()));
  if (
    !(await claimControlledDispatch(
      input.organizationId,
      input.postId,
      new Date(post.publishDate).toISOString()
    ))
  )
    return;
  // Reuse the frozen provider, pending-status, notification and error handling.
  // CLAIMED is permanent: a late stop can never certify this execution as unsent.
  return postWorkflowV112({ ...input, postNow: true });
}
