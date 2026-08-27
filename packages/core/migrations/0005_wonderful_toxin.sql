CREATE TABLE `source` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`driver` text NOT NULL,
	`location` text NOT NULL,
	`token` text,
	`official` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE `plugin_install` ADD `source_id` integer REFERENCES source(id);--> statement-breakpoint
ALTER TABLE `plugin_install` ADD `strain` text;