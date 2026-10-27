/** Preserve hourly progress when an unrelated minute task fails. */
export class ScheduledTaskError extends AggregateError {
  constructor(
    errors: unknown[],
    readonly maintenanceCompleted: boolean,
  ) {
    super(errors, 'Scheduled tasks failed.')
  }
}
