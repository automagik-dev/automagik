-- Apply only to the owner's separate preview/production D1 databases.
CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK(channel IN ('email','whatsapp')),
  email TEXT UNIQUE,
  whatsapp_number TEXT,
  whatsapp_sender TEXT,
  message_id TEXT UNIQUE,
  confirmation_reply TEXT,
  goal TEXT NOT NULL CHECK(length(goal) BETWEEN 1 AND 1000),
  platform TEXT NOT NULL CHECK(platform IN ('android','linux','both')),
  apps TEXT NOT NULL CHECK(length(apps) <= 200),
  expected_result TEXT NOT NULL CHECK(length(expected_result) BETWEEN 1 AND 500),
  language TEXT NOT NULL CHECK(language IN ('en','pt-BR')),
  consent_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  received_at INTEGER,
  confirmation_hash TEXT NOT NULL UNIQUE,
  address_key TEXT,
  group_key TEXT NOT NULL,
  mail_day TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS waitlist_quota (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS waitlist_cooldown (
  key TEXT PRIMARY KEY, sent_at INTEGER NOT NULL
);
-- These checks and reservations share the INSERT's SQLite transaction. A rejected INSERT
-- changes no counter. Across isolates, D1 serializes the write: no read/check/send race.
CREATE TRIGGER IF NOT EXISTS waitlist_guard BEFORE INSERT ON waitlist BEGIN
  SELECT CASE WHEN NEW.channel='email' AND EXISTS(
    SELECT 1 FROM waitlist_cooldown WHERE key=NEW.address_key AND sent_at>NEW.created_at-86400
  ) THEN RAISE(ABORT,'WAITLIST_COOLDOWN') END;
  SELECT CASE WHEN COALESCE((SELECT count FROM waitlist_quota WHERE key='minute:'||NEW.group_key||':'||(NEW.created_at/60)),0)>=5
    OR COALESCE((SELECT count FROM waitlist_quota WHERE key='day:'||NEW.group_key),0)>=10
    OR (NEW.channel='email' AND COALESCE((SELECT count FROM waitlist_quota WHERE key='mail:'||NEW.mail_day),0)>=60)
    THEN RAISE(ABORT,'WAITLIST_RATE') END;
END;
CREATE TRIGGER IF NOT EXISTS waitlist_reserve AFTER INSERT ON waitlist BEGIN
  INSERT INTO waitlist_quota VALUES('minute:'||NEW.group_key||':'||(NEW.created_at/60),1,NEW.created_at+120)
    ON CONFLICT(key) DO UPDATE SET count=count+1;
  INSERT INTO waitlist_quota VALUES('day:'||NEW.group_key,1,NEW.created_at+86400)
    ON CONFLICT(key) DO UPDATE SET count=count+1;
  INSERT INTO waitlist_quota SELECT 'mail:'||NEW.mail_day,1,NEW.created_at+86400 WHERE NEW.channel='email'
    ON CONFLICT(key) DO UPDATE SET count=count+1;
  INSERT INTO waitlist_cooldown SELECT NEW.address_key,NEW.created_at WHERE NEW.channel='email'
    ON CONFLICT(key) DO UPDATE SET sent_at=excluded.sent_at;
END;
