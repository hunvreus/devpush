FROM golang:1.25-alpine AS agent-builder

ARG DEVPUSH_AGENT_VERSION=0.1.0

WORKDIR /repo

COPY go.work ./
COPY agent/go.mod ./agent/go.mod
COPY agent ./agent

RUN GOOS=linux GOARCH=amd64 go build -ldflags "-X github.com/devpush/devpush/agent/internal/agent.Version=${DEVPUSH_AGENT_VERSION}" -o /out/devpush-agent-linux-amd64 ./agent/cmd/devpush-agent
RUN GOOS=linux GOARCH=arm64 go build -ldflags "-X github.com/devpush/devpush/agent/internal/agent.Version=${DEVPUSH_AGENT_VERSION}" -o /out/devpush-agent-linux-arm64 ./agent/cmd/devpush-agent

FROM node:22-alpine AS app-builder

WORKDIR /repo

ARG VITE_DEVPUSH_BACKUPS_ENABLED=false
ENV VITE_DEVPUSH_BACKUPS_ENABLED=$VITE_DEVPUSH_BACKUPS_ENABLED

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/package.json ./app/package.json

RUN pnpm install --frozen-lockfile

COPY app ./app

RUN pnpm --dir app build

FROM node:22-alpine

WORKDIR /repo

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DEVPUSH_AGENT_BINARY_DIR=/repo/bin

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY app/package.json ./app/package.json
RUN pnpm install --frozen-lockfile --prod=false

COPY --from=app-builder /repo/app/.output ./app/.output
COPY --from=app-builder /repo/app/drizzle.config.ts ./app/drizzle.config.ts
COPY --from=app-builder /repo/app/scripts/migrate.ts ./app/scripts/migrate.ts
COPY --from=app-builder /repo/app/scripts/baseline-pushed-schema.ts ./app/scripts/baseline-pushed-schema.ts
COPY --from=app-builder /repo/app/src/server/db ./app/src/server/db
COPY --from=agent-builder /out/devpush-agent-linux-amd64 ./bin/devpush-agent-linux-amd64
COPY --from=agent-builder /out/devpush-agent-linux-arm64 ./bin/devpush-agent-linux-arm64

EXPOSE 3000

CMD ["sh", "-lc", "pnpm --dir app db:migrate && cd app && node .output/server/index.mjs"]
