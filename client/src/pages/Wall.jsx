import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, connectSocket, mediaUrl, timeLabel } from '../api.js';
import MemoryCard from '../components/MemoryCard.jsx';
import './Wall.css';

const SPOTLIGHT_MS = 9000;
const SLIDE_MS = 10000;

/* Apply the organiser's photo/video switches to what the screen shows. */
function applySettings(list, s) {
  return list
    .map((m) => ({ ...m, photoUrl: s.photos === false ? null : m.photoUrl, videoUrl: s.videos === false ? null : m.videoUrl }))
    .filter((m) => m.photoUrl || m.videoUrl || m.text);
}

/* ---------------- Gallery (pinboard of polaroids and notes) ---------------- */
const TAPES = ['#cfe0f3', '#dcd3f1', '#f6d3df', '#f3e6c9'];
const NOTES = ['#fbdde6', '#dbe8f7', '#e6dff5', '#f6ecd6'];

// Stable "random" look per memory, so cards never jump around when new ones arrive.
function look(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return {
    '--rot': `${((h % 61) - 30) / 10}deg`,
    '--dy': `${((h >> 3) % 22) - 4}px`,
    '--tape': TAPES[h % TAPES.length],
    '--tape-rot': `${((h >> 5) % 9) - 4}deg`,
    '--note': NOTES[(h >> 2) % NOTES.length],
  };
}

function PinCard({ m, showAi, w }) {
  const media = m.photoUrl || m.videoUrl;
  const by = `${m.authorName || 'A guest'} · ${timeLabel(m.createdAt)}`;
  return (
    <article className={`pin ${media ? 'polaroid' : 'note'}`} style={{ ...look(m.id), '--w': `${w}px` }}>
      {m.photoUrl && <img src={mediaUrl(m.photoUrl)} alt={m.title || 'Shared memory'} loading="lazy" />}
      {!m.photoUrl && m.videoUrl && (
        <div className="pin-video">
          <video src={mediaUrl(m.videoUrl)} muted loop playsInline autoPlay preload="metadata" />
          <i>▶</i>
        </div>
      )}
      {media ? (
        <div className="pin-cap">
          <h3>{(showAi && m.title) || m.text || 'A shared moment'}</h3>
          <small>{by}</small>
        </div>
      ) : (
        <div className="pin-quote">
          <p>“{m.text}”</p>
          <small>{by}</small>
        </div>
      )}
    </article>
  );
}

/* ---- adaptive layout: cards shrink as the wall fills; below a readable size the wall rotates instead ---- */
const GAP = 22;
const CELL = 1.2; // planned card height as a multiple of its width
const ROTATE_MS = 12000;
const chrono = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);

function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Biggest card width at which all n memories fit; otherwise the minimum width and how many fit. */
export function planLayout(n, W, H, minW, maxW) {
  let best = null;
  for (let cols = 1; cols <= 60; cols++) {
    const w = Math.min(maxW, (W - GAP * (cols - 1)) / cols);
    if (w < minW) break;
    const rows = Math.floor((H + GAP) / (w * CELL + GAP));
    if (rows >= 1 && cols * rows >= n && (!best || w > best.w)) best = { w, cap: n, all: true };
  }
  if (best || !n) return best || { w: maxW, cap: 0, all: true };
  const cols = Math.max(1, Math.floor((W + GAP) / (minW + GAP)));
  const w = Math.min(maxW, (W - GAP * (cols - 1)) / cols);
  const rows = Math.max(1, Math.floor((H + GAP) / (w * CELL + GAP)));
  return { w, cap: cols * rows, all: false };
}

/** When not everything fits: the newest and featured memories stay up, the rest rotate with high-scoring ones first. */
export function pickVisible(memories, cap, offset) {
  const newest = [...memories].sort((a, b) => chrono(b, a));
  const pinned = new Set(newest.slice(0, Math.max(1, Math.ceil(cap * 0.3))).map((m) => m.id));
  memories.filter((m) => m.featured).slice(0, Math.floor(cap * 0.25)).forEach((m) => pinned.add(m.id));
  const pool = memories.filter((m) => !pinned.has(m.id)).sort((a, b) => (b.score ?? 5) - (a.score ?? 5) || chrono(b, a));
  const slots = Math.min(cap - pinned.size, pool.length);
  const rotating = Array.from({ length: slots }, (_, i) => pool[(offset + i) % pool.length]);
  return [...memories.filter((m) => pinned.has(m.id)), ...rotating].sort(chrono);
}

function Gallery({ memories, showAi, eventName }) {
  const area = useRef();
  const { w: W, h: H } = useSize(area);
  const [offset, setOffset] = useState(0);

  const minW = Math.min(300, Math.max(150, W * 0.085));
  const maxW = Math.min(380, Math.max(240, W / 4));
  const plan = useMemo(
    () => (W && H ? planLayout(memories.length, W, H, minW, maxW) : { w: maxW, cap: memories.length, all: true }),
    [memories.length, W, H, minW, maxW]
  );

  const rotating = !plan.all && memories.length > plan.cap;
  useEffect(() => {
    if (!rotating) return;
    const step = Math.max(1, Math.floor(plan.cap / 3));
    const t = setInterval(() => setOffset((o) => o + step), ROTATE_MS);
    return () => clearInterval(t);
  }, [rotating, plan.cap]);

  const shown = useMemo(() => (rotating ? pickVisible(memories, plan.cap, offset) : memories), [memories, rotating, plan.cap, offset]);

  return (
    <div className="board">
      <div className="plaque">
        <h1>{eventName}</h1>
        <span>Share · Explore · Relive</span>
      </div>
      {/* The measured area is always mounted, so it is ready as soon as the first memory arrives. */}
      <div className="pins" ref={area}>
        {shown.map((m) => <PinCard key={m.id} m={m} showAi={showAi} w={Math.floor(plan.w)} />)}
      </div>
      {!memories.length && (
        <div className="wall-empty">
          <h2>Be the first to share a memory</h2>
          <p>Add a photo, a video or a few words.</p>
        </div>
      )}
    </div>
  );
}

/* ---------------- AI Story mode ---------------- */
function StoryMode({ story, memories }) {
  const byId = useMemo(() => new Map(memories.map((m) => [m.id, m])), [memories]);
  const slides = useMemo(() => {
    const out = [{ type: 'cover' }];
    story.sections.forEach((s, si) => {
      const items = s.memoryIds.map((id) => byId.get(id)).filter(Boolean);
      if (!items.length) return;
      out.push({ type: 'section', section: s, si });
      items.forEach((m) => out.push({ type: 'memory', memory: m, section: s, si }));
    });
    return out;
  }, [story, byId]);

  const [i, setI] = useState(0);
  useEffect(() => setI(0), [story.id]);
  useEffect(() => {
    const t = setTimeout(() => setI((n) => (n + 1) % slides.length), SLIDE_MS);
    return () => clearTimeout(t);
  }, [i, slides.length]);

  const slide = slides[Math.min(i, slides.length - 1)];
  const sections = story.sections.filter((s) => s.memoryIds.some((id) => byId.has(id)));

  return (
    <div className="story">
      <div className="story-stage" key={i}>
        {slide.type === 'cover' && (
          <div className="story-cover">
            <span className="chip">Our story</span>
            <h1>{story.title}</h1>
            <p>{story.subtitle}</p>
          </div>
        )}
        {slide.type === 'section' && (
          <div className="story-cover">
            <span className="chip blue">Chapter {slide.si + 1}</span>
            <h1>{slide.section.heading}</h1>
            <p>{slide.section.description}</p>
          </div>
        )}
        {slide.type === 'memory' && (
          <div className="story-memory">
            <MemoryCard memory={slide.memory} large />
            <aside>
              <span className="chip">{slide.section.heading}</span>
              <p>{slide.memory.story || slide.memory.caption}</p>
            </aside>
          </div>
        )}
      </div>
      <nav className="story-progress" aria-label="Story chapters">
        {sections.map((s) => (
          <span key={s.key} className={slide.section?.key === s.key ? 'on' : ''}>{s.heading}</span>
        ))}
      </nav>
    </div>
  );
}

/* ---------------- Page ---------------- */
export default function Wall() {
  const [params] = useSearchParams();
  const slug = params.get('event') || 'default';
  const [event, setEvent] = useState(null);
  const [raw, setRaw] = useState([]);
  const [story, setStory] = useState(null);
  const [spot, setSpot] = useState(null);
  const knownIds = useRef(new Set());
  const loaded = useRef(false);

  const settings = event?.settings || {};
  const memories = useMemo(() => applySettings(raw, settings), [raw, settings]);
  const aiOn = settings.aiStories !== false;
  const storyAvailable = aiOn && story && story.sections?.length;
  // The organiser picks the view in the admin dashboard; the display just follows (and falls back to the gallery
  // if the story is not ready yet).
  const effectiveMode = settings.displayMode === 'story' && storyAvailable ? 'story' : 'gallery';

  const upsert = useCallback((m) => {
    const isNew = !knownIds.current.has(m.id);
    knownIds.current.add(m.id);
    setRaw((list) => {
      const i = list.findIndex((x) => x.id === m.id);
      if (i < 0) return [...list, m].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const copy = list.slice(); copy[i] = m; return copy;
    });
    if (isNew && loaded.current) setSpot(m);
  }, []);

  useEffect(() => {
    let socket;
    (async () => {
      const [ev, mem, st] = await Promise.all([api.event(slug), api.memories(slug), api.story(slug)]);
      setEvent(ev); setRaw(mem); setStory(st);
      mem.forEach((m) => knownIds.current.add(m.id));
      loaded.current = true;
      socket = connectSocket({ slug });
      socket.on('memory:upsert', upsert);
      socket.on('memory:remove', ({ id }) => { knownIds.current.delete(id); setRaw((l) => l.filter((m) => m.id !== id)); });
      socket.on('settings:update', (s) => setEvent((e) => e && { ...e, settings: s }));
      socket.on('story:update', setStory);
      // Resync after a dropped connection so nothing is missed.
      socket.io.on('reconnect', () => api.memories(slug).then((l) => { setRaw(l); l.forEach((m) => knownIds.current.add(m.id)); }));
    })().catch(console.error);
    return () => socket?.disconnect();
  }, [slug, upsert]);

  useEffect(() => {
    if (!spot) return;
    const t = setTimeout(() => setSpot(null), SPOTLIGHT_MS);
    return () => clearTimeout(t);
  }, [spot]);

  // Browsers only allow fullscreen from a gesture on the display itself, so it cannot be driven from the admin.
  const toggleFullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.());
  useEffect(() => {
    const onKey = (e) => e.key.toLowerCase() === 'f' && toggleFullscreen();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="wall" onDoubleClick={toggleFullscreen}>
      <main className="wall-main">
        {effectiveMode === 'story' ? <StoryMode story={story} memories={memories} /> : <Gallery memories={memories} showAi={aiOn} eventName={event?.name || 'Memory Wall'} />}
      </main>

      {spot && (
        <div className="spotlight" onClick={() => setSpot(null)}>
          <div className="spot-inner" onClick={(e) => e.stopPropagation()}>
            <span className="chip">New memory</span>
            <MemoryCard memory={spot} showAi={aiOn} large />
          </div>
        </div>
      )}
    </div>
  );
}
