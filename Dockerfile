# syntax=docker/dockerfile:1.7
# One image for the api, the worker and the migrate job. Built natively on the host that runs it
# (amd64 Proxmox VM or arm64 Pi 5); nothing here is architecture specific.

ARG NODE_IMAGE=node:24.15.0-trixie-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=1
RUN corepack enable
WORKDIR /app

# Only the manifests, so a source change does not reinstall dependencies.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/parent/package.json apps/parent/
COPY packages/adguard-client/package.json packages/adguard-client/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/help-content/package.json packages/help-content/
COPY packages/notify/package.json packages/notify/
COPY packages/schemas/package.json packages/schemas/
COPY packages/tokens/package.json packages/tokens/

FROM manifests AS deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm exec turbo run build

# The gate: the same script as on the laptop. update.sh runs this image with no network, before
# anything live changes. Built only with --target test, so production never carries it.
FROM build AS test
# git for the update.sh scenario tests, which make throwaway repositories.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
CMD ["node", "scripts/gate.mjs", "--in-image"]

# Runtime dependencies of the server side only. The parent app ships as built files.
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store     pnpm install --frozen-lockfile --prod --filter @family-time/api... --filter @family-time/worker...

# Runtime. The last stage, so a plain build produces it and never the test stage.
FROM base AS runtime
ARG GIT_COMMIT=dev
ARG BUILD_TIME=dev
ARG FT_DRILL_UNREADY=0
ENV NODE_ENV=production \
    GIT_COMMIT=$GIT_COMMIT \
    BUILD_TIME=$BUILD_TIME \
    FT_DRILL_UNREADY=$FT_DRILL_UNREADY
COPY --from=prod-deps /app /app
COPY --from=build /app/packages/schemas/dist packages/schemas/dist
COPY --from=build /app/packages/domain/dist packages/domain/dist
COPY --from=build /app/packages/adguard-client/dist packages/adguard-client/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/notify/dist packages/notify/dist
COPY --from=build /app/packages/db/migrations packages/db/migrations
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY --from=build /app/apps/parent/dist apps/parent/dist
COPY --chmod=0755 deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "apps/api/dist/index.js"]
