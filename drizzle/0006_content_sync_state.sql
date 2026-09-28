CREATE TABLE `content_sync_state` (
	`source_key` text PRIMARY KEY NOT NULL,
	`cursor` text DEFAULT '' NOT NULL,
	`last_full_sync_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
