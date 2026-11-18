CREATE TABLE training_push (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE INDEX push_owner ON training_push(user_id,changed_at DESC);
CREATE TABLE workout_duplicate_reviews (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  native_id TEXT NOT NULL,
  hevy_id TEXT NOT NULL,
  kept_id TEXT NOT NULL,
  PRIMARY KEY(user_id,native_id,hevy_id),
  CHECK(kept_id=native_id OR kept_id=hevy_id)
);
CREATE TABLE workout_variant_links (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_template TEXT NOT NULL,
  equipment TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  canonical_id TEXT NOT NULL,
  PRIMARY KEY(user_id,provider_template,equipment,movement_type)
);
