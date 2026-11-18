CREATE TABLE workout_details (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  audience TEXT NOT NULL CHECK(audience IN ('private','connections','group')),
  group_id TEXT,
  content TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, workout_id)
);
CREATE TABLE workout_mutations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mutation_id TEXT NOT NULL,
  attempt TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY(user_id, mutation_id)
);
CREATE TABLE routines (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,id)
);
CREATE TABLE exercise_catalog (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY(user_id,id)
);
CREATE TABLE training_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL
);
CREATE TABLE measurements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  value REAL NOT NULL CHECK(value > 0),
  PRIMARY KEY(user_id,day,kind)
);
CREATE TABLE training_groups (
  id TEXT PRIMARY KEY,
  owner_id TEXT REFERENCES users(id),
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York'
);
INSERT INTO training_groups(id,name) VALUES('original','Original training group');
CREATE TABLE training_group_members (
  group_id TEXT NOT NULL REFERENCES training_groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(group_id,user_id)
);
CREATE TABLE training_group_invites (
  token_hash TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES training_groups(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_by TEXT REFERENCES users(id)
);
CREATE TABLE metric_permissions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK(scope IN ('person','group')),
  target_id TEXT NOT NULL,
  named INTEGER NOT NULL DEFAULT 0 CHECK(named IN (0,1)),
  PRIMARY KEY(user_id,scope,target_id)
);
CREATE TABLE workout_reactions (
  owner_id TEXT NOT NULL,
  workout_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY(owner_id,workout_id,user_id),
  FOREIGN KEY(owner_id,workout_id) REFERENCES workout_details(user_id,workout_id) ON DELETE CASCADE
);
CREATE TABLE workout_comments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  workout_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(owner_id,workout_id) REFERENCES workout_details(user_id,workout_id) ON DELETE CASCADE
);
CREATE INDEX workout_history_order ON workouts(user_id,start_time DESC,source_id DESC);
CREATE INDEX measurement_dates ON measurements(user_id,day DESC);
CREATE INDEX private_group_members ON training_group_members(user_id,group_id);
CREATE INDEX workout_comments_history ON workout_comments(owner_id,workout_id,created_at,id);
