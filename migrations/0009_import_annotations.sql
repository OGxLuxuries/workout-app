CREATE TABLE workout_import_annotations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT NOT NULL,
  gym TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('private', 'connections')),
  PRIMARY KEY (user_id, workout_id)
);
