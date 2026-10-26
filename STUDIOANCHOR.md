# StudioAnchor modifications to Postiz

This repository is the complete corresponding source of the modified Postiz that StudioAnchor runs as the publishing engine behind StudioAnchor Marketing. It is published under the same license as upstream, the GNU Affero General Public License v3.0 (see [`LICENSE`](LICENSE)).

StudioAnchor is not affiliated with, endorsed by, or operated by Postiz or Gitroom. "Postiz" is the name of the upstream project, [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app), and is used here only to identify the original work.

## What was modified

| | |
| --- | --- |
| Upstream base | [`8b84b0dc2767b757c2355158573635600ae027c7`](https://github.com/gitroomhq/postiz-app/commit/8b84b0dc2767b757c2355158573635600ae027c7) (tag `v2.24.0`) |
| Modification | One commit on that base, applying `dispatch-fence-v1.patch`, sha256 `dcbfff3903ddd32d9c2cdd3f77a7ffe8a1b9d17785de1e54411e748d04dfe7cd` |
| Date modified | 2026-10-24 |
| Running build | Image `studioanchor/postiz:v2.24.0-sa-fence2`, built with [`Dockerfile.studioanchor`](Dockerfile.studioanchor) |

The changes:

- **Dispatch fence (`dispatch-fence-v1`).** An opt-in, single-post fence that guarantees a scheduled post is either claimed for sending or stopped, never both. It adds three nullable `Post` fields (`dispatchControl`, `dispatchClaim`, `deliveryStopReceipt`) and the `postWorkflowV113` workflow, which wraps the unchanged V112 publishing workflow. It also adds authenticated public API routes: `GET /public/v1/delivery-control`, `POST /public/v1/posts/:id/stop` and `GET /public/v1/posts/:id/stop/:requestId`. The capability is advertised only when `POSTIZ_DISPATCH_FENCE_ENABLED=true`. Existing workflows and activity signatures are unchanged.
- **MCP input limits.** MCP requests are bounded to 256 KiB of decoded JSON, 10,000 elements and depth 64, and unsupported media types are rejected.
- **Dependency security updates.** Overrides move packages to patched releases. There are also two locally verified mitigations for advisories without an upstream fix: `patches/braces@3.0.3.patch` and `patches/zod@3.25.76.patch` (a backport of zod commit a0ebf970).
- **Build and startup changes.** Startup no longer passes `--accept-data-loss` to Prisma, and the Docker context excludes runtime environment files.
- **Tests.** Database, workflow and security tests are added under `tests/`; see `tests/DELIVERY_STOP_QA.md`.

Files added or modified (all others are unchanged from upstream):

- `.dockerignore` (modified)
- `apps/backend/src/public-api/public.api.module.ts` (modified)
- `apps/backend/src/public-api/routes/v1/public.delivery.controller.ts` (added)
- `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts` (modified)
- `apps/backend/src/services/auth/providers/wallet.provider.ts` (modified)
- `apps/backend/tsconfig.json` (modified)
- `apps/orchestrator/src/activities/post.activity.ts` (modified)
- `apps/orchestrator/src/workflows/index.ts` (modified)
- `apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.1.3.ts` (added)
- `apps/orchestrator/tsconfig.json` (modified)
- `eslint.config.mjs` (modified)
- `libraries/helpers/src/decorators/plug.decorator.ts` (modified)
- `libraries/helpers/src/decorators/post.plug.ts` (modified)
- `libraries/helpers/src/utils/use.fire.events.ts` (modified)
- `libraries/nestjs-libraries/src/agent/agent.graph.insert.service.ts` (modified)
- `libraries/nestjs-libraries/src/agent/agent.graph.service.ts` (modified)
- `libraries/nestjs-libraries/src/chat/mcp.input-limits.ts` (added)
- `libraries/nestjs-libraries/src/chat/start.mcp.ts` (modified)
- `libraries/nestjs-libraries/src/database/prisma/autopost/autopost.service.ts` (modified)
- `libraries/nestjs-libraries/src/database/prisma/database.module.ts` (modified)
- `libraries/nestjs-libraries/src/database/prisma/media/media.repository.ts` (modified)
- `libraries/nestjs-libraries/src/database/prisma/posts/delivery.stop.repository.ts` (added)
- `libraries/nestjs-libraries/src/database/prisma/posts/delivery.stop.service.ts` (added)
- `libraries/nestjs-libraries/src/database/prisma/posts/posts.repository.ts` (modified)
- `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts` (modified)
- `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (modified)
- `libraries/nestjs-libraries/src/dtos/posts/delivery.stop.dto.ts` (added)
- `libraries/nestjs-libraries/src/emails/empty.provider.ts` (modified)
- `libraries/nestjs-libraries/src/short-linking/providers/empty.ts` (modified)
- `libraries/nestjs-libraries/src/upload/cloudflare.storage.ts` (modified)
- `libraries/nestjs-libraries/src/upload/custom.upload.validation.ts` (modified)
- `libraries/nestjs-libraries/src/upload/local.storage.ts` (modified)
- `libraries/nestjs-libraries/src/upload/r2.uploader.ts` (modified)
- `libraries/react-shared-libraries/src/helpers/use.is.visible.tsx` (modified)
- `package.json` (modified)
- `patches/braces@3.0.3.patch` (added)
- `patches/zod@3.25.76.patch` (added)
- `pnpm-lock.yaml` (modified)
- `tests/DELIVERY_STOP_QA.md` (added)
- `tests/delivery-stop.bundle.cjs` (added)
- `tests/delivery-stop.integration.test.ts` (added)
- `tests/delivery-stop.workflow.test.cjs` (added)
- `tests/provider.mcp-security.test.cjs` (added)
- `tests/provider.security.audit.cjs` (added)
- `tests/provider.security.mitigation.cjs` (added)
- `tests/provider.security.mitigations.json` (added)
- `tests/provider.security.test.cjs` (added)
- `tests/provider.security.zod-mitigation.json` (added)
- `tests/provider.upload.test.cjs` (added)
- `tsconfig.base.json` (modified)

This file (`STUDIOANCHOR.md`) and `Dockerfile.studioanchor` are also added.

## Building

From the repository root:

```bash
docker build -f Dockerfile.studioanchor \
  --build-arg NEXT_PUBLIC_VERSION=v2.24.0-sa-fence2 \
  --build-arg SOURCE_BASE=8b84b0dc2767b757c2355158573635600ae027c7 \
  --build-arg PATCH_SHA256=dcbfff3903ddd32d9c2cdd3f77a7ffe8a1b9d17785de1e54411e748d04dfe7cd \
  -t studioanchor/postiz:v2.24.0-sa-fence2 .
```

The image uses Node 22.22.0, PNPM 10.6.1 and `pnpm install --frozen-lockfile`. Runtime configuration and secrets are supplied by the deployment environment and are not part of the image.

## Running with the fence

Apply the additive schema change with Prisma (`pnpm run prisma-db-push`, which no longer accepts data loss). Deploy every API, orchestrator and worker process on this build with `POSTIZ_DISPATCH_FENCE_ENABLED=false`, then set it to `true`. Do not return to unmodified binaries while any post has a non-null `dispatchControl`.
