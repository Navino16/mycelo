CREATE TABLE `command_alias` (
	`plugin_name` text NOT NULL,
	`command` text NOT NULL,
	`alias` text NOT NULL,
	PRIMARY KEY(`plugin_name`, `command`),
	FOREIGN KEY (`plugin_name`) REFERENCES `plugin_install`(`name`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `command_alias_alias_unique` ON `command_alias` (`alias`);