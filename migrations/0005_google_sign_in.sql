ALTER TABLE users RENAME COLUMN phone TO login_key;
ALTER TABLE invitations ADD COLUMN google_email TEXT;
CREATE TABLE google_sign_ins (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  verifier TEXT NOT NULL,
  nonce TEXT NOT NULL,
  invite_hash TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX google_sign_in_expiry ON google_sign_ins(expires_at);
