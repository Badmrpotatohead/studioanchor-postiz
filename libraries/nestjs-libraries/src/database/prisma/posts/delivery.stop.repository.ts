import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaRepository } from '../prisma.service';
import { DeliveryStopDto } from '@gitroom/nestjs-libraries/dtos/posts/delivery.stop.dto';

@Injectable()
export class DeliveryStopRepository {
  constructor(private _post: PrismaRepository<'post'>) {}

  async receipt(orgId: string, id: string, requestId: string) {
    const post = await this._post.model.post.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!post?.deliveryStopReceipt)
      throw new NotFoundException('Stop receipt not found');
    const receipt = JSON.parse(post.deliveryStopReceipt);
    if (receipt.requestId !== requestId)
      throw new NotFoundException('Stop receipt not found');
    return receipt;
  }

  async stop(orgId: string, id: string, input: DeliveryStopDto) {
    const post = await this._post.model.post.findFirst({
      where: { id, organizationId: orgId },
      include: { childrenPost: true },
    });
    if (!post) throw new NotFoundException('Post not found');
    if (post.deliveryStopReceipt) {
      const saved = JSON.parse(post.deliveryStopReceipt);
      if (
        saved.requestId !== input.requestId ||
        saved.binding !== input.binding
      )
        throw new ConflictException('A different stop already owns this post');
      return saved;
    }
    if (!['ARMED', 'CLAIMED'].includes(post.dispatchControl))
      throw new ConflictException('This legacy post has no dispatch fence');
    const stopped = post.dispatchControl === 'ARMED';
    if (
      stopped &&
      (await this._post.model.post.count({
        where: { organizationId: orgId, group: post.group, deletedAt: null },
      })) !== 1
    )
      throw new ConflictException('The group contains other posts');
    const images = JSON.parse(post.image || '[]');
    const matchingImages =
      Array.isArray(images) &&
      images.length === input.images.length &&
      images.every(
        (image, index) =>
          image?.id === input.images[index].id &&
          image?.path === input.images[index].path &&
          image?.alt === input.images[index].alt
      );
    if (
      post.integrationId !== input.integrationId ||
      post.content !== input.content ||
      post.publishDate.toISOString() !== input.scheduledAt ||
      !matchingImages
    )
      throw new ConflictException('The original post evidence changed');
    // A claimed dispatch can only record a negative outcome, including after its
    // due time or a publishing activity completes. It never stops or deletes it.
    if (
      stopped &&
      (post.state !== 'QUEUE' ||
        post.deletedAt ||
        post.parentPostId ||
        post.intervalInDays ||
        post.childrenPost.length ||
        post.releaseId ||
        post.releaseURL ||
        post.publishDate.getTime() - Date.now() < 300000)
    )
      throw new ConflictException('The exact future single post changed');
    const receipt = {
      protocol: 'dispatch-fence-v1',
      requestId: input.requestId,
      binding: input.binding,
      postId: id,
      integrationId: post.integrationId,
      scheduledAt: input.scheduledAt,
      state: stopped ? 'STOPPED' : 'UNCONFIRMED',
      stoppedAt: stopped ? new Date().toISOString() : null,
    };
    // CAS on the same row used by claim(): either stop wins or dispatch wins.
    // A lost acknowledgement can always be recovered through the read-only receipt route.
    const result = await this._post.model.post.updateMany({
      where: {
        id,
        organizationId: orgId,
        updatedAt: post.updatedAt,
        dispatchControl: post.dispatchControl,
        deliveryStopReceipt: null,
        content: post.content,
        integrationId: post.integrationId,
        publishDate: post.publishDate,
        image: post.image,
        ...(stopped
          ? {
              state: 'QUEUE' as const,
              deletedAt: null,
              parentPostId: null,
              intervalInDays: null,
              releaseId: null,
              releaseURL: null,
              childrenPost: { none: {} },
            }
          : {}),
      },
      data: {
        deliveryStopReceipt: JSON.stringify(receipt),
        ...(stopped
          ? { dispatchControl: 'STOPPED', deletedAt: new Date() }
          : {}),
      },
    });
    if (!result.count)
      throw new ConflictException(
        'The post changed; repeat the same idempotent stop to read its outcome'
      );
    return receipt;
  }

  async claim(orgId: string, id: string, scheduledAt: string, runId: string) {
    const result = await this._post.model.post.updateMany({
      where: {
        id,
        organizationId: orgId,
        dispatchControl: 'ARMED',
        deletedAt: null,
        state: 'QUEUE',
        publishDate: new Date(scheduledAt),
        parentPostId: null,
        intervalInDays: null,
        childrenPost: { none: {} },
      },
      data: { dispatchControl: 'CLAIMED', dispatchClaim: runId },
    });
    if (result.count === 1) return true;
    // Temporal activity replay is idempotent for one execution, never a new run.
    return !!(await this._post.model.post.findFirst({
      where: {
        id,
        organizationId: orgId,
        dispatchControl: 'CLAIMED',
        dispatchClaim: runId,
      },
    }));
  }
}
