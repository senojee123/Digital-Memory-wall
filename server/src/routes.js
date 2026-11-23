import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { query, one, serializeMemory, serializeEvent } from './db.js';
import { issueToken, passwordMatches, requireAdmin } from './auth.js';
import { saveFile, removeFile } from './storage.js';
import { analyzeMemory, generateEventStory, SECTIONS } from './ai.js';
import { renderFilm } from './film.js';
import fs from 'node:fs/promises';

const MAX_TEXT = 600;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 80 * 1024 * 1024, files: 2, fields: 10 },
});

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function createRouter(io) {
  const r = Router();

  /* ---------- realtime helpers ---------- */
  // Rebuilds the event story from all approved memories, oldest → newest, and pushes it to the wall.
  async function rebuildStory(eventId) {
    const e = await one('SELECT * FROM events WHERE id=$1', [eventId]);
    if (!e) return null;
    const memories = await query(`SELECT * FROM memories WHERE event_id=$1 AND status='approved' ORDER BY created_at ASC`, [eventId]);
    if (!memories.length) return null;
    const story = await generateEventStory({ eventName: e.name, eventCreatedAt: e.created_at, memories });
    const saved = await one('INSERT INTO stories (event_id, title, subtitle, sections) VALUES ($1,$2,$3,$4) RETURNING *', [eventId, story.title, story.subtitle, JSON.stringify(story.sections)]);
    await query('DELETE FROM stories WHERE event_id=$1 AND id<>$2', [eventId, saved.id]);
    const dto = { id: saved.id, title: saved.title, subtitle: saved.subtitle, sections: saved.sections, createdAt: saved.created_at };
    io.to(`event:${eventId}`).emit('story:update', dto);
    return dto;
  }

  // Debounced: a burst of new memories triggers one rebuild, not many.
  const storyTimers = new Map();
  const STORY_DELAY_MS = Number(process.env.STORY_DELAY_MS || 20_000);
  function scheduleStory(eventId) {
    clearTimeout(storyTimers.get(eventId));
    storyTimers.set(
      eventId,
      setTimeout(async () => {
        storyTimers.delete(eventId);
        const e = await one('SELECT settings FROM events WHERE id=$1', [eventId]).catch(() => null);
        if (e && e.settings.aiStories !== false) rebuildStory(eventId).catch((err) => console.error('Auto story failed', err));
      }, STORY_DELAY_MS)
    );
  }

  const broadcast = (m) => {
    scheduleStory(m.event_id);
    const dto = serializeMemory(m);
    io.to('admin').emit('admin:memory', dto);
    io.to(`event:${m.event_id}`).emit(m.status === 'approved' ? 'memory:upsert' : 'memory:remove', m.status === 'approved' ? dto : { id: m.id });
  };

  const findEvent = async (ref) =>
    /^\d+$/.test(String(ref))
      ? one('SELECT * FROM events WHERE id = $1', [ref])
      : one('SELECT * FROM events WHERE slug = $1', [ref]);

  // Analyses a memory and, when `moderate` is set, lets the AI decide: approve → on the wall,
  // reject → hidden, unsure → left pending for a human.
  async function runAi(memoryId, { photo, frame, moderate = false } = {}) {
    const m = await one('SELECT m.*, e.name AS event_name, e.settings AS event_settings FROM memories m JOIN events e ON e.id = m.event_id WHERE m.id = $1', [memoryId]);
    if (!m) return;
    const ai = await analyzeMemory({ text: m.text, photo, frame, hasVideo: Boolean(m.video_url), eventName: m.event_name, category: m.category });
    const decide = moderate && m.event_settings.aiModeration !== false;
    const status = decide ? { approve: 'approved', reject: 'rejected', review: 'pending' }[ai.verdict] : m.status;
    const updated = await one(
      `UPDATE memories SET status=$9, ai_note=$10, ai_status='done', ai_title=$2, ai_caption=$3, ai_story=$4, ai_timeline=$5, ai_theme=$6, ai_section=$7, ai_tags=$8, ai_score=$11
       WHERE id=$1 RETURNING *`,
      [memoryId, ai.title, ai.caption, ai.story, ai.timeline, ai.theme, ai.section, ai.tags, status, decide ? ai.note : m.ai_note, ai.score ?? 5]
    );
    if (updated) broadcast(updated);
  }

  /* ---------- auth ---------- */
  r.post('/auth/login', rateLimit({ windowMs: 60_000, limit: 10 }), (req, res) => {
    if (!passwordMatches(req.body?.password)) return res.status(401).json({ error: 'Incorrect password' });
    res.json({ token: issueToken() });
  });

  /* ---------- public ---------- */
  r.get('/events', wrap(async (_req, res) => {
    res.json((await query('SELECT * FROM events ORDER BY id')).map(serializeEvent));
  }));

  r.get('/events/:ref', wrap(async (req, res) => {
    const e = await findEvent(req.params.ref);
    if (!e) return res.status(404).json({ error: 'Event not found' });
    res.json(serializeEvent(e));
  }));

  r.get('/events/:ref/memories', wrap(async (req, res) => {
    const e = await findEvent(req.params.ref);
    if (!e) return res.status(404).json({ error: 'Event not found' });
    const rows = await query(`SELECT * FROM memories WHERE event_id=$1 AND status='approved' ORDER BY created_at ASC`, [e.id]);
    res.json(rows.map(serializeMemory));
  }));

  r.get('/events/:ref/story', wrap(async (req, res) => {
    const e = await findEvent(req.params.ref);
    if (!e) return res.status(404).json({ error: 'Event not found' });
    const s = await one('SELECT * FROM stories WHERE event_id=$1 ORDER BY created_at DESC LIMIT 1', [e.id]);
    res.json(s ? { id: s.id, title: s.title, subtitle: s.subtitle, sections: s.sections, createdAt: s.created_at } : null);
  }));

  r.post(
    '/memories',
    rateLimit({ windowMs: 60_000, limit: 12, message: { error: 'Too many submissions, please wait a moment.' } }),
    upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'video', maxCount: 1 }, { name: 'frame', maxCount: 1 }]),
    wrap(async (req, res) => {
      const event = await findEvent(req.body.event || 'default');
      if (!event) return res.status(404).json({ error: 'Event not found' });

      const photo = req.files?.photo?.[0];
      const video = req.files?.video?.[0];
      const text = str(req.body.text, MAX_TEXT);
      const frame = req.files?.frame?.[0]; // still taken from the video in the browser, used only for the safety check
      const { photos, videos } = event.settings;

      if (!photo && !video && !text) return res.status(400).json({ error: 'Add a photo, a video or a message to share.' });
      if (photo && !photos) return res.status(400).json({ error: 'Photos are turned off for this event.' });
      if (video && !videos) return res.status(400).json({ error: 'Videos are turned off for this event.' });
      if (photo && !photo.mimetype.startsWith('image/')) return res.status(400).json({ error: 'The photo must be an image file.' });
      if (video && !video.mimetype.startsWith('video/')) return res.status(400).json({ error: 'The video must be a video file.' });

      const [photoUrl, videoUrl] = await Promise.all([
        photo ? saveFile(photo, `${event.slug}/photos`) : null,
        video ? saveFile(video, `${event.slug}/videos`) : null,
      ]);

      // When the photo/video was captured (sent by the browser). Used only to put the story in the right order.
      const takenDate = new Date(req.body.takenAt);
      const takenAt = Number.isFinite(takenDate.getTime()) && takenDate.getTime() <= Date.now() + 5 * 60_000 ? takenDate.toISOString() : null;

      // Always start hidden; the AI check below decides what happens next.
      const row = await one(
        `INSERT INTO memories (event_id, author_name, category, text, photo_url, video_url, status, ai_status, taken_at)
         VALUES ($1,$2,$3,$4,$5,$6,'pending','processing',$7) RETURNING *`,
        [event.id, str(req.body.name, 60), str(req.body.category, 40), text, photoUrl, videoUrl, takenAt]
      );
      res.status(201).json({ id: row.id });

      broadcast(row);
      runAi(row.id, { photo, frame: frame?.mimetype?.startsWith('image/') ? frame : null, moderate: true }).catch((err) => console.error('AI pipeline error', err));
    })
  );

  /* ---------- admin ---------- */
  const admin = Router();
  admin.use(requireAdmin);

  admin.post('/events', wrap(async (req, res) => {
    const name = str(req.body.name, 80);
    if (!name) return res.status(400).json({ error: 'Event name is required' });
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
    let slug = base;
    for (let i = 2; await one('SELECT 1 FROM events WHERE slug=$1', [slug]); i++) slug = `${base}-${i}`;
    const e = await one('INSERT INTO events (slug, name, description) VALUES ($1,$2,$3) RETURNING *', [slug, name, str(req.body.description, 200) || '']);
    res.status(201).json(serializeEvent(e));
  }));

  admin.put('/events/:id/settings', wrap(async (req, res) => {
    const e = await findEvent(req.params.id);
    if (!e) return res.status(404).json({ error: 'Event not found' });
    const next = { ...e.settings };
    for (const k of ['photos', 'videos', 'aiStories', 'aiModeration']) if (typeof req.body[k] === 'boolean') next[k] = req.body[k];
    if (['gallery', 'story'].includes(req.body.displayMode)) next.displayMode = req.body.displayMode;
    const updated = await one('UPDATE events SET settings=$2 WHERE id=$1 RETURNING *', [e.id, next]);
    io.to(`event:${e.id}`).emit('settings:update', updated.settings);
    res.json(serializeEvent(updated));
  }));

  admin.get('/events/:id/memories', wrap(async (req, res) => {
    const rows = await query('SELECT * FROM memories WHERE event_id=$1 ORDER BY created_at DESC', [req.params.id]);
    res.json(rows.map(serializeMemory));
  }));

  admin.patch('/memories/:id', wrap(async (req, res) => {
    const { status, featured } = req.body;
    if (status && !['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const m = await one(
      `UPDATE memories SET status = COALESCE($2, status), featured = COALESCE($3, featured) WHERE id=$1 RETURNING *`,
      [req.params.id, status ?? null, typeof featured === 'boolean' ? featured : null]
    );
    if (!m) return res.status(404).json({ error: 'Memory not found' });
    broadcast(m);
    res.json(serializeMemory(m));
  }));

  admin.delete('/memories/:id', wrap(async (req, res) => {
    const m = await one('DELETE FROM memories WHERE id=$1 RETURNING *', [req.params.id]);
    if (!m) return res.status(404).json({ error: 'Memory not found' });
    await Promise.all([removeFile(m.photo_url), removeFile(m.video_url)]);
    io.to('admin').emit('admin:remove', { id: m.id });
    io.to(`event:${m.event_id}`).emit('memory:remove', { id: m.id });
    res.json({ ok: true });
  }));

  admin.post('/memories/:id/regenerate', wrap(async (req, res) => {
    const m = await one(`UPDATE memories SET ai_status='processing' WHERE id=$1 RETURNING *`, [req.params.id]);
    if (!m) return res.status(404).json({ error: 'Memory not found' });
    broadcast(m);
    res.status(202).json({ ok: true });
    // Text-only regeneration: the original image buffer is not retained after upload.
    runAi(m.id).catch((err) => console.error('AI regenerate error', err));
  }));

  admin.post('/events/:id/story', wrap(async (req, res) => {
    const e = await findEvent(req.params.id);
    if (!e) return res.status(404).json({ error: 'Event not found' });
    clearTimeout(storyTimers.get(e.id));
    const dto = await rebuildStory(e.id);
    if (!dto) return res.status(400).json({ error: 'No approved memories yet.' });
    res.status(201).json(dto);
  }));

  /* ---------- event film ---------- */
  const MAX_FILM_MEMORIES = Number(process.env.FILM_MAX_MEMORIES || 30);
  const filmJobs = new Map(); // eventId -> { state, done, total, error }

  const filmDto = (f) => (f ? { id: f.id, url: f.url, seconds: f.seconds, memories: f.memories, createdAt: f.created_at } : null);
  const filmStatus = async (eventId) => ({
    job: filmJobs.get(eventId) || null,
    latest: filmDto(await one('SELECT * FROM films WHERE event_id=$1 ORDER BY created_at DESC LIMIT 1', [eventId])),
  });

  async function makeFilm(e) {
    const job = filmJobs.get(e.id);
    const emit = () => io.to('admin').emit('film:update', { eventId: e.id, job: { ...job } });
    try {
      // Always film the freshest story.
      const story = await rebuildStory(e.id);
      if (!story) throw new Error('No approved memories yet.');
      const rows = await query(`SELECT * FROM memories WHERE event_id=$1 AND status='approved'`, [e.id]);
      const byId = new Map(rows.map((m) => [m.id, serializeMemory(m)]));

      // Long events: keep featured + highest-importance memories, but stay in story (chronological) order.
      let keep = new Set(byId.keys());
      if (keep.size > MAX_FILM_MEMORIES) {
        keep = new Set([...byId.values()].sort((a, b) => Number(b.featured) - Number(a.featured) || (b.score ?? 5) - (a.score ?? 5)).slice(0, MAX_FILM_MEMORIES).map((m) => m.id));
      }
      const chapters = story.sections
        .map((s) => ({ heading: s.heading, description: s.description, memories: s.memoryIds.filter((id) => keep.has(id)).map((id) => byId.get(id)) }))
        .filter((c) => c.memories.length);

      const film = await renderFilm({
        title: story.title, subtitle: story.subtitle, eventName: e.name, chapters,
        onProgress: (done, total) => { job.done = done; job.total = total; emit(); },
      });
      try {
        const url = await saveFile({ buffer: await fs.readFile(film.file), mimetype: 'video/mp4', originalname: 'film.mp4' }, `${e.slug}/films`);
        const count = chapters.reduce((n, c) => n + c.memories.length, 0);
        await query('INSERT INTO films (event_id, url, seconds, memories) VALUES ($1,$2,$3,$4)', [e.id, url, Math.round(film.seconds), count]);
        job.state = 'done';
      } finally {
        await film.cleanup();
      }
    } catch (err) {
      console.error('Film render failed', err);
      job.state = 'error';
      job.error = err.message.slice(0, 200);
    }
    emit();
  }

  admin.get('/events/:id/film', wrap(async (req, res) => res.json(await filmStatus(Number(req.params.id)))));

  admin.post('/events/:id/film', wrap(async (req, res) => {
    const e = await findEvent(req.params.id);
    if (!e) return res.status(404).json({ error: 'Event not found' });
    if (filmJobs.get(e.id)?.state === 'rendering') return res.status(409).json({ error: 'A film is already being made.' });
    filmJobs.set(e.id, { state: 'rendering', done: 0, total: 0 });
    makeFilm(e);
    res.status(202).json({ job: filmJobs.get(e.id) });
  }));

  r.get('/events/:ref/film', wrap(async (req, res) => {
    const e = await findEvent(req.params.ref);
    if (!e) return res.status(404).json({ error: 'Event not found' });
    res.json(filmDto(await one('SELECT * FROM films WHERE event_id=$1 ORDER BY created_at DESC LIMIT 1', [e.id])));
  }));

  r.use('/admin', admin);
  r.get('/meta/sections', (_req, res) => res.json(SECTIONS));

  return r;
}
