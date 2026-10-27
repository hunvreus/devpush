/** Apply the packaged main and log migrations to the configured Node databases. */
export declare function migrateNode(
  environment?: Record<string, string | undefined>,
  options?: { migrationsDirectory?: string },
): Promise<void>
