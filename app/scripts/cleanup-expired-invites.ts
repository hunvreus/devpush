import { closeDb } from '#devpush/server/db'
import { cleanupExpiredTeamInvites } from '#devpush/server/teams/service'

async function main() {
  const result = await cleanupExpiredTeamInvites()

  console.log(
    `Expired ${result.expiredCount} team invite${result.expiredCount === 1 ? '' : 's'}.`,
  )
}

main()
  .catch((error) => {
    console.error('Failed to cleanup expired team invites:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDb()
  })
