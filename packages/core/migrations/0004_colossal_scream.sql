CREATE TABLE `ui_credential` (
	`principal_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_login_at` integer,
	FOREIGN KEY (`principal_id`) REFERENCES `principal`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ui_credential_username_unique` ON `ui_credential` (`username`);--> statement-breakpoint
CREATE TABLE `ui_session` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`principal_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`principal_id`) REFERENCES `principal`(`id`) ON UPDATE no action ON DELETE cascade
);
