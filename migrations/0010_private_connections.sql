CREATE TABLE training_connections (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id,target_id),
  CHECK (user_id<>target_id)
);
CREATE INDEX training_connections_targets ON training_connections(target_id,user_id);
