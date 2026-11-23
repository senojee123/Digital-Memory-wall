import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// With no DATABASE_URL we use PGlite: a real Postgres running in-process, stored in server/data.
// Handy for local runs; set DATABASE_URL to use a normal Postgres server instead.
const local = !process.env.DATABASE_URL;
let db;
async function getDb() {
  if (db) return db;
  if (local) {
    const { PGlite } = await import('@electric-sql/pglite');
    db = new PGlite(process.env.PGLITE_DIR || path.resolve(here, '..', 'data'));
    await db.waitReady;
    console.log('Using embedded local database (server/data)');
  } else {
    db = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });
  }
  return db;
}

export const query = async (text, params) => (await (await getDb()).query(text, params)).rows;
export const one = async (text, params) => (await query(text, params))[0] || null;

export async function migrate() {
  const d = await getDb();
  const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  await (local ? d.exec(schema) : d.query(schema));
  const count = await one('SELECT count(*)::int AS n FROM events');
  if (!count.n) {
    await query(
      `INSERT INTO events (slug, name, description) VALUES ('default', 'Our Memory Wall', 'Moments we share, stories we keep.')`
    );
  }
}

export const serializeMemory = (m) => ({
  id: m.id,
  eventId: m.event_id,
  authorName: m.author_name,
  category: m.category,
  text: m.text,
  photoUrl: m.photo_url,
  videoUrl: m.video_url,
  status: m.status,
  featured: m.featured,
  aiStatus: m.ai_status,
  moderationNote: m.ai_note,
  score: m.ai_score,
  takenAt: m.taken_at,
  title: m.ai_title,
  caption: m.ai_caption,
  story: m.ai_story,
  timeline: m.ai_timeline,
  theme: m.ai_theme,
  section: m.ai_section,
  tags: m.ai_tags || [],
  createdAt: m.created_at,
});

export const serializeEvent = (e) => ({
  id: e.id,
  slug: e.slug,
  name: e.name,
  description: e.description,
  settings: e.settings,
});
