CREATE TABLE training_challenges (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES training_groups(id) ON DELETE CASCADE,
  creator_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  timezone TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  variants TEXT NOT NULL
);
CREATE TABLE training_challenge_players (
  challenge_id TEXT NOT NULL REFERENCES training_challenges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT CHECK(source IN ('native','mixed')),
  PRIMARY KEY(challenge_id,user_id)
);
CREATE TABLE training_closed_weeks (
  challenge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  PRIMARY KEY(challenge_id,user_id,starts_on),
  FOREIGN KEY(challenge_id,user_id) REFERENCES training_challenge_players(challenge_id,user_id) ON DELETE CASCADE
);
CREATE TABLE training_inbox (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX training_inbox_owner ON training_inbox(user_id,created_at DESC);
CREATE TABLE training_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT 'en',
  google_email TEXT
);
CREATE TABLE training_media (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id TEXT,
  measurement_day TEXT,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CHECK((workout_id IS NOT NULL) <> (measurement_day IS NOT NULL))
);
CREATE INDEX training_media_attachments ON training_media(user_id,workout_id,measurement_day);
CREATE TABLE training_provider_states (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE training_providers (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  token_bundle TEXT NOT NULL
);
CREATE TABLE training_exports (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id TEXT NOT NULL,
  state TEXT NOT NULL,
  provider_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,workout_id)
);
