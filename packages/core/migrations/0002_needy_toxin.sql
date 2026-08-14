CREATE TABLE `broadcast_target` (
	`channel` text NOT NULL,
	`conversation_id` text NOT NULL,
	PRIMARY KEY(`channel`, `conversation_id`)
);
--> statement-breakpoint
CREATE TABLE `command_context_rule` (
	`pattern` text PRIMARY KEY NOT NULL,
	`where_kind` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conversation` (
	`channel` text NOT NULL,
	`conversation_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text,
	`first_seen_at` integer NOT NULL,
	`last_message_at` integer NOT NULL,
	PRIMARY KEY(`channel`, `conversation_id`)
);
--> statement-breakpoint
CREATE TABLE `inhibitor_channel` (
	`plugin_name` text NOT NULL,
	`channel` text NOT NULL,
	PRIMARY KEY(`plugin_name`, `channel`),
	FOREIGN KEY (`plugin_name`) REFERENCES `plugin_install`(`name`) ON UPDATE no action ON DELETE cascade
);
