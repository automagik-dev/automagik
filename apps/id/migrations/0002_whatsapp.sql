CREATE TABLE whatsapp_challenge (
  codeHash TEXT PRIMARY KEY,
  cookieHash TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,
  oauthQuery TEXT,
  clientName TEXT NOT NULL,
  phoneNumber TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'verified', 'used'))
);
CREATE INDEX whatsapp_challenge_expiry ON whatsapp_challenge(expiresAt);
CREATE TABLE whatsapp_event (
  eventId TEXT PRIMARY KEY,
  externalId TEXT NOT NULL UNIQUE,
  requestToken TEXT NOT NULL UNIQUE,
  receivedAt INTEGER NOT NULL
);
CREATE TABLE whatsapp_rate (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  resetAt INTEGER NOT NULL
);
