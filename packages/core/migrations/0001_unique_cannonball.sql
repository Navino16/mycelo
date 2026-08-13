CREATE TABLE `plugin_install` (
	`name` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`installed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plugin_setting` (
	`plugin_name` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`is_secret` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`plugin_name`, `key`),
	FOREIGN KEY (`plugin_name`) REFERENCES `plugin_install`(`name`) ON UPDATE no action ON DELETE cascade
);
