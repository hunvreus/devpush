import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'jsonc-parser'

export function npmOverrides(policy) {
  const result = {}
  for (const [selector, version] of Object.entries(policy)) {
    const parts = selector.split('>').map((part) => part.trim())
    if (parts.length === 1) result[selector] = version
    else if (parts.length === 2) {
      const [parent, child] = parts
      if (typeof result[parent] === 'string')
        result[parent] = { '.': result[parent] }
      result[parent] ??= {}
      result[parent][child] = version
    } else throw new Error(`Unsupported dependency override: ${selector}`)
  }
  return result
}

export function createProject(
  directory,
  target,
  metadata,
  template,
  policy = {},
) {
  if (!['docker', 'cloudflare'].includes(target))
    throw new Error('Choose docker or cloudflare.')
  directory = resolve(directory)
  if (existsSync(directory) && readdirSync(directory).length)
    throw new Error(
      `Directory is not empty: ${directory}. Choose a new directory; use npm run configure to resume an installation.`,
    )
  mkdirSync(directory, { recursive: true })
  const dependencies = {
    devpush: metadata.version,
    ...metadata.peerDependencies,
  }
  const scripts = {
    configure: 'devpush configure',
    build: 'vite build',
    migrate: 'devpush migrate',
    deploy: 'devpush deploy',
    ...(target === 'docker'
      ? { start: 'node --env-file=.env .output/server/index.mjs' }
      : {}),
  }
  const files = {
    'package.json':
      JSON.stringify(
        {
          name: 'devpush-installation',
          private: true,
          type: 'module',
          engines: metadata.engines,
          scripts,
          dependencies,
          overrides: npmOverrides(policy),
          ...(target === 'cloudflare'
            ? {
                devDependencies: {
                  wrangler: metadata.devDependencies.wrangler,
                },
              }
            : {}),
        },
        null,
        2,
      ) + '\n',
    'vite.config.mjs': `import { devpush } from 'devpush/vite';\nexport default devpush({ target: '${target === 'docker' ? 'node' : 'cloudflare'}'${target === 'cloudflare' ? ", wranglerConfig: './wrangler.jsonc'" : ''} });\n`,
    '.gitignore':
      'node_modules/\n.env\n.env.*\n.cloudflare-secrets.json\nwrangler.pending.jsonc\n.data/\n.devpush/\n.wrangler/\n.tanstack/\n.output/\ndist/\npublic/uploads/\n',
    'devpush.json': JSON.stringify({ target }, null, 2) + '\n',
  }
  if (target === 'cloudflare') {
    const config = parse(template)
    config.main = 'node_modules/devpush/src/server.ts'
    for (const item of config.d1_databases)
      item.migrations_dir = `node_modules/devpush/${item.migrations_dir}`
    files['wrangler.template.jsonc'] = JSON.stringify(config, null, 2) + '\n'
  } else {
    files['Dockerfile'] = `FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.mjs ./
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=build /app /app
RUN mkdir -p /app/storage /app/public/uploads /backups && chown -R node:node /app/storage /app/public/uploads /backups
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
`
    files['.dockerignore'] =
      'node_modules\n.env\n.env.*\n.git\n.data\n.output\ndist\npublic/uploads\n'
    files['compose.yml'] = `services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    ports:
      - "127.0.0.1:\${DEVPUSH_HTTP_PORT:-7429}:3000"
    volumes:
      - data:/app/storage
      - uploads:/app/public/uploads
    depends_on:
      migrate:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 15s
      timeout: 5s
      retries: 10
  migrate:
    build: .
    env_file: .env
    volumes:
      - data:/app/storage
    command: ["node", "node_modules/devpush/dist/package/cli.mjs", "migrate"]
    restart: "no"
  db-backup:
    build: .
    profiles: ["backups"]
    restart: unless-stopped
    env_file: .env
    depends_on:
      app:
        condition: service_healthy
    volumes:
      - data:/app/storage
      - backups:/backups
    command: ["sh", "-ec", "while true; do node node_modules/devpush/dist/package/backup-sqlite.mjs; sleep 86400; done"]
volumes:
  data:
  uploads:
  backups:
`
  }
  for (const [name, content] of Object.entries(files))
    writeFileSync(resolve(directory, name), content, { flag: 'wx' })
  return directory
}

export function readInstallation(directory) {
  const config = JSON.parse(
    readFileSync(resolve(directory, 'devpush.json'), 'utf8'),
  )
  if (!['docker', 'cloudflare'].includes(config.target))
    throw new Error('Invalid devpush installation target.')
  return config
}
