CREATE TABLE player_slots (
  name TEXT PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE,
  user_id TEXT UNIQUE REFERENCES users(id)
);
INSERT INTO player_slots(name,position) VALUES ('Oliver',1),('Tashi',2),('Jason',3),('Blake',4);
UPDATE player_slots SET user_id=(
  SELECT id FROM users WHERE lower(trim(replace(lower(name),' (local test)','')))=lower(player_slots.name)
  ORDER BY created_at, id LIMIT 1
);
ALTER TABLE invitations ADD COLUMN player_name TEXT REFERENCES player_slots(name);

INSERT INTO sharing(a,b)
SELECT u.id,v.id FROM users u JOIN users v ON u.id<v.id
WHERE NOT EXISTS (SELECT 1 FROM sharing s WHERE (s.a=u.id AND s.b=v.id) OR (s.a=v.id AND s.b=u.id));

ALTER TABLE competitions RENAME TO legacy_competitions;
CREATE TABLE competitions (
  id TEXT PRIMARY KEY,
  start_day TEXT NOT NULL,
  choices TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE competition_members (
  competition_id TEXT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  approved INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(competition_id,user_id)
);
CREATE INDEX competitions_by_player ON competition_members(user_id);
INSERT INTO competitions SELECT id,start_day,choices,created_at FROM legacy_competitions;
INSERT INTO competition_members SELECT id,a,a_approved FROM legacy_competitions;
INSERT INTO competition_members SELECT id,b,b_approved FROM legacy_competitions;
DROP TABLE legacy_competitions;
