ALTER TABLE `notification_outbox` ADD `first_attempt_at` integer;
--> statement-breakpoint
-- Preserve conservative windows for old attempts; never reconstruct an ambiguously sent payload.
UPDATE notification_outbox SET first_attempt_at=created_at WHERE attempts>0;
--> statement-breakpoint
UPDATE notification_outbox SET failed_at=created_at,lease_owner=NULL,lease_until=0 WHERE attempts>0 AND delivered_at IS NULL AND discarded_at IS NULL AND failed_at IS NULL;
