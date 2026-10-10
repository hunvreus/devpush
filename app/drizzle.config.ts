import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './src/server/db/migrations-sqlite',
  dialect: 'sqlite',
  dbCredentials: {
    url:
      process.env.DEVPUSH_DATABASE_PATH ?? '.data/devpush.sqlite',
  },
})
