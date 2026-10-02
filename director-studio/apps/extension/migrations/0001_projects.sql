-- D1 transactions and compare-and-swap protect all project state, including the
-- budget ledger, generation receipts and immutable document versions.
CREATE TABLE IF NOT EXISTS director_projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  updated_at TEXT NOT NULL,
  state_json TEXT NOT NULL CHECK(json_valid(state_json)),
  commit_token TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS director_projects_owner_updated ON director_projects(owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS director_settings (
  owner_id TEXT PRIMARY KEY,
  settings_json TEXT NOT NULL CHECK(json_valid(settings_json))
);

CREATE TABLE IF NOT EXISTS director_versions (
  project_id TEXT NOT NULL REFERENCES director_projects(id),
  number INTEGER NOT NULL,
  version_json TEXT NOT NULL CHECK(json_valid(version_json)),
  site_files_json TEXT NOT NULL CHECK(json_valid(site_files_json)),
  PRIMARY KEY(project_id,number)
);
