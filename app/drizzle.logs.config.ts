import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/server/db/log-schema.ts',
  out: './src/server/db/migrations-logs',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DEVPUSH_LOG_DATABASE_PATH ?? '.data/logs.sqlite',
  },
})
