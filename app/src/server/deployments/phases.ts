export const deploymentPhases = [
  'queued',
  'agent_connected',
  'config_synced',
  'repo_fetched',
  'compose_resolved',
  'images_built_or_pulled',
  'release_command_started',
  'release_command_succeeded',
  'revision_started',
  'readiness_check_started',
  'traffic_switched',
  'old_revision_retired',
  'completed',
] as const

export type DeploymentPhase = (typeof deploymentPhases)[number]
