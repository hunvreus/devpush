CREATE INDEX `runtime_logs_server_runtime_order_idx` ON `runtime_logs` (`server_id`,`runtime_id`,`observed_at`,`created_at`,`id`);--> statement-breakpoint
DROP INDEX `runtime_logs_server_runtime_time_idx`;
