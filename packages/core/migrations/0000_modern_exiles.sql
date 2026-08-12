CREATE TABLE `channel_identity` (
	`channel` text NOT NULL,
	`external_id` text NOT NULL,
	`principal_id` text NOT NULL,
	`display_name` text,
	`first_seen_at` integer NOT NULL,
	PRIMARY KEY(`channel`, `external_id`),
	FOREIGN KEY (`principal_id`) REFERENCES `principal`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `principal` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `principal_role` (
	`principal_id` text NOT NULL,
	`role_id` text NOT NULL,
	PRIMARY KEY(`principal_id`, `role_id`),
	FOREIGN KEY (`principal_id`) REFERENCES `principal`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `role` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`builtin` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `role_name_unique` ON `role` (`name`);--> statement-breakpoint
CREATE TABLE `role_command` (
	`role_id` text NOT NULL,
	`pattern` text NOT NULL,
	PRIMARY KEY(`role_id`, `pattern`),
	FOREIGN KEY (`role_id`) REFERENCES `role`(`id`) ON UPDATE no action ON DELETE cascade
);
