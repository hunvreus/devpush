FROM golang:1.27.3-alpine@sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c AS agent-builder

WORKDIR /repo

COPY go.work ./
COPY agent/go.mod ./agent/go.mod
COPY agent ./agent
COPY app/package.json ./app/package.json

RUN VERSION="$(sed -n 's/.*\"version\": \"\([^\"]*\)\".*/\1/p' app/package.json)" && test -n "$VERSION" && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -buildvcs=false -ldflags "-s -w -buildid= -X github.com/devpush/devpush/agent/internal/agent.Version=${VERSION}" -o /out/devpush-agent-linux-amd64 ./agent/cmd/devpush-agent
RUN VERSION="$(sed -n 's/.*\"version\": \"\([^\"]*\)\".*/\1/p' app/package.json)" && test -n "$VERSION" && CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -trimpath -buildvcs=false -ldflags "-s -w -buildid= -X github.com/devpush/devpush/agent/internal/agent.Version=${VERSION}" -o /out/devpush-agent-linux-arm64 ./agent/cmd/devpush-agent

FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS app-builder

WORKDIR /repo

ARG VITE_DEVPUSH_BACKUPS_ENABLED=false
ENV VITE_DEVPUSH_BACKUPS_ENABLED=$VITE_DEVPUSH_BACKUPS_ENABLED

RUN apk add --no-cache python3 make g++
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/package.json ./app/package.json

RUN pnpm install --frozen-lockfile

COPY app ./app

RUN pnpm --dir app build
RUN cd app && pnpm exec esbuild scripts/migrate.ts \
    --bundle \
    --external:better-sqlite3 \
    --platform=node \
    --format=esm \
    --target=node22 \
    --sourcemap=linked \
    --sources-content=false \
    --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
    --outfile=.maintenance/migrate.mjs

FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914

# Runtime needs Node, not package-manager CLIs and their dependency trees.
RUN apk add --no-cache curl \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
       /opt/yarn* /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
       /usr/local/bin/yarn /usr/local/bin/yarnpkg

WORKDIR /repo/app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DEVPUSH_AGENT_BINARY_DIR=/repo/bin

COPY --from=app-builder /repo/app/.output ./.output
COPY --from=app-builder /repo/app/.maintenance ./.maintenance
COPY --from=app-builder /repo/app/src/server/db/migrations-sqlite ./src/server/db/migrations-sqlite
COPY --from=app-builder /repo/app/src/server/db/migrations-logs ./src/server/db/migrations-logs
COPY app/scripts/backup-sqlite.mjs ./.maintenance/backup-sqlite.mjs
RUN ln -s .output/server/node_modules node_modules
COPY --from=agent-builder /out/devpush-agent-linux-amd64 /repo/bin/devpush-agent-linux-amd64
COPY --from=agent-builder /out/devpush-agent-linux-arm64 /repo/bin/devpush-agent-linux-arm64

RUN mkdir -p /app/storage /backups /repo/app/public/uploads \
    && chown node:node /app/storage /backups /repo/app/public/uploads

USER node

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
