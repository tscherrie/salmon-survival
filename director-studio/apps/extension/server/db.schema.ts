import { integer, primaryKey, sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
export const directorProjects = sqliteTable('director_projects', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), revision: integer('revision').notNull(),
  updatedAt: text('updated_at').notNull(), stateJson: text('state_json').notNull(), commitToken: text('commit_token').notNull(),
}, table => [index('director_projects_owner_updated').on(table.ownerId, table.updatedAt)]);
export const directorVersions = sqliteTable('director_versions', {
  projectId: text('project_id').notNull().references(() => directorProjects.id), number: integer('number').notNull(),
  versionJson: text('version_json').notNull(), siteFilesJson: text('site_files_json').notNull(),
}, table => [primaryKey({ columns: [table.projectId, table.number] })]);
export const directorSettings = sqliteTable('director_settings', { ownerId: text('owner_id').primaryKey(), settingsJson: text('settings_json').notNull() });
