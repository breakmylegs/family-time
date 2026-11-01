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
COPY apps/kiosk/package.json apps/kiosk/
COPY packages/adguard-client/package.json packages/adguard-client/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/help-content/package.json packages/help-content/
COPY packages/ledger/package.json packages/ledger/
COPY packages/notify/package.json packages/notify/
COPY packages/schemas/package.json packages/schemas/
COPY packages/ai/package.json packages/ai/
COPY packages/tokens/package.json packages/tokens/
COPY contracts/package.json contracts/

FROM manifests AS deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

# The ledger contract (ADR 0014), built and tested with Foundry here so the laptop never needs it.
# A failing forge test fails the build. Only the compiled contract goes on, never Foundry. The
# release tarball is checked against its published SHA-256; forge-std is pinned by commit.
FROM deps AS contracts
ARG FOUNDRY_VERSION=v1.8.7
ARG FOUNDRY_SHA256_AMD64=ba470eb718e779e4b0e3f1520b5284231b1bf98e9a39de07fb8f77ed70525bcf
ARG FOUNDRY_SHA256_ARM64=6f0e5697801cbdd059553360b2cb54ff52870789a0249a16da2a07c157a18534
ARG FORGE_STD_COMMIT=f3dae6e6ee381f25eb6a246f7da9b85c91a68219
RUN apt-get update  && apt-get install -y --no-install-recommends ca-certificates curl git  && rm -rf /var/lib/apt/lists/*
RUN set -eu;     arch=$(dpkg --print-architecture);     case "$arch" in       amd64) sum=$FOUNDRY_SHA256_AMD64 ;;       arm64) sum=$FOUNDRY_SHA256_ARM64 ;;       *) echo "No Foundry release for $arch" >&2; exit 1 ;;     esac;     curl -fsSL -o /tmp/foundry.tar.gz "https://github.com/foundry-rs/foundry/releases/download/${FOUNDRY_VERSION}/foundry_${FOUNDRY_VERSION}_linux_${arch}.tar.gz";     echo "$sum  /tmp/foundry.tar.gz" | sha256sum -c -;     tar -xzf /tmp/foundry.tar.gz -C /usr/local/bin forge;     rm /tmp/foundry.tar.gz;     forge --version
WORKDIR /app/contracts
RUN set -eu;     mkdir -p lib/forge-std && cd lib/forge-std;     git init -q;     git fetch -q --depth 1 https://github.com/foundry-rs/forge-std "$FORGE_STD_COMMIT";     git checkout -q FETCH_HEAD
COPY contracts/foundry.toml ./
COPY contracts/src src
COPY contracts/test test
RUN forge build --sizes && forge test -vv

FROM deps AS build
COPY . .
COPY --from=contracts /app/contracts/out/FamilyLedger.sol/FamilyLedger.json contracts/out/FamilyLedger.sol/FamilyLedger.json
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
COPY --from=build /app/packages/ledger/dist packages/ledger/dist
COPY --from=build /app/packages/ai/dist packages/ai/dist
COPY --from=build /app/packages/db/migrations packages/db/migrations
COPY --from=build /app/contracts/out/FamilyLedger.sol/FamilyLedger.json contracts/out/FamilyLedger.sol/FamilyLedger.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY --from=build /app/apps/parent/dist apps/parent/dist
COPY --from=build /app/apps/kiosk/dist apps/kiosk/dist
# Release notes for the System page.
COPY --from=build /app/CHANGELOG.md CHANGELOG.md
COPY --chmod=0755 deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "apps/api/dist/index.js"]
