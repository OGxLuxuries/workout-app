-- My groups: a short description and an optional profile picture per group.
-- The picture itself lives in R2 under group-avatar/<group id>. The version
-- changes on every upload so browsers fetch the new image.
ALTER TABLE training_groups ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE training_groups ADD COLUMN avatar_version INTEGER NOT NULL DEFAULT 0;
