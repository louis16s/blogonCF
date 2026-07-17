CREATE TABLE `password_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL
);
