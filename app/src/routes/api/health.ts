import { createFileRoute } from '@tanstack/react-router'
import { sql } from 'drizzle-orm'

import { db } from '#devpush/server/db'

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        try {
          await db.run(sql`select 1`)
          return Response.json({ status: 'ok' })
        } catch {
          return Response.json({ status: 'unhealthy' }, { status: 503 })
        }
      },
    },
  },
})
