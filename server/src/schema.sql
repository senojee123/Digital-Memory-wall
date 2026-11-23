CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  settings    JSONB NOT NULL DEFAULT '{"photos":true,"videos":true,"aiStories":true,"aiModeration":true}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  author_name TEXT,
  category    TEXT,
  text        TEXT,
  photo_url   TEXT,
  video_url   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  featured    BOOLEAN NOT NULL DEFAULT false,
  ai_status   TEXT NOT NULL DEFAULT 'idle',
  ai_title    TEXT,
  ai_caption  TEXT,
  ai_story    TEXT,
  ai_timeline TEXT,
  ai_theme    TEXT,
  ai_section  TEXT,
  ai_tags     TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE memories ADD COLUMN IF NOT EXISTS ai_note TEXT;
CREATE INDEX IF NOT EXISTS memories_event_status_idx ON memories (event_id, status, created_at);

CREATE TABLE IF NOT EXISTS stories (
  id         SERIAL PRIMARY KEY,
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  subtitle   TEXT,
  sections   JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stories_event_idx ON stories (event_id, created_at DESC);

ALTER TABLE memories ADD COLUMN IF NOT EXISTS ai_score INTEGER;
CREATE TABLE IF NOT EXISTS films (
  id         SERIAL PRIMARY KEY,
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  seconds    INTEGER,
  memories   INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE memories ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;
