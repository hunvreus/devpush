import { closeDb } from '#devpush/server/db'
import { runQueuedUserCleanupJobs } from '#devpush/server/users/service'

async function main() {
  const results = await runQueuedUserCleanupJobs()
  const succeededCount = results.filter(
    (result) => result.status === 'succeeded',
  ).length
  const retryCount = results.filter(
    (result) => result.status === 'queued',
  ).length
  const failedCount = results.filter(
    (result) => result.status === 'failed',
  ).length

  console.log(
    `Cleaned ${succeededCount} deleted user account${succeededCount === 1 ? '' : 's'}. ${retryCount} queued for retry. ${failedCount} failed.`,
  )
}

main()
  .catch((error) => {
    console.error('Failed to cleanup deleted users:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDb()
  })
