CREATE TABLE `director_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` text NOT NULL,
	`state_json` text NOT NULL,
	`commit_token` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `director_projects_owner_updated` ON `director_projects` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `director_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`settings_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `director_versions` (
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`version_json` text NOT NULL,
	`site_files_json` text NOT NULL,
	PRIMARY KEY(`project_id`, `number`),
	FOREIGN KEY (`project_id`) REFERENCES `director_projects`(`id`) ON UPDATE no action ON DELETE no action
);
