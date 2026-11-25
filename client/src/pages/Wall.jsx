import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, connectSocket, mediaUrl, timeLabel } from '../api.js';
import MemoryCard, { Clip } from '../components/MemoryCard.jsx';
import './Wall.css';

const SPOTLIGHT_MS = 9000;
const SLIDE_MS = 5000;

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

function hash(id) {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) >>> 0;
  return h;
}

function PinCard({ m, showAi, w, x, y }) {
  const media = m.photoUrl || m.videoUrl;
  const by = `${m.authorName || 'A guest'} · ${timeLabel(m.createdAt)}`;
  return (
    <article className={`pin ${media ? 'polaroid' : 'note'}`} style={{ ...look(m.id), '--w': `${w}px`, '--x': `${x}px`, '--y': `${y}px` }}>
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

function Gallery({ memories, showAi, eventName, tagline }) {
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

  // Spread the cards over the whole board (like pins on a corkboard): the grid that gives the biggest cards wins,
  // and each card sits at a stable random offset inside its cell.
  const { spots, spotW } = useMemo(() => {
    const n = shown.length;
    if (!n || !W || !H) return { spots: [], spotW: Math.floor(plan.w) };
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const w = Math.min(maxW, (W / cols) * 0.94, ((H / rows) * 0.94) / CELL);
      if (!best || w > best.w) best = { cols, rows, w };
    }
    const w = Math.floor(best.w);
    const cw = W / best.cols, ch = H / best.rows;
    const order = [...shown].sort((a, b) => hash(a.id) - hash(b.id)); // shuffled so neighbours are not always in time order
    return {
      spotW: w,
      spots: order.map((m, i) => {
        const h = hash(m.id);
        const slackX = Math.max(0, cw - w), slackY = Math.max(0, ch - w * CELL);
        const col = i % best.cols, row = Math.floor(i / best.cols);
        return {
          m,
          x: Math.round(col * cw + slackX * (0.15 + 0.7 * ((h % 97) / 97))),
          y: Math.round(row * ch + slackY * (0.15 + 0.7 * (((h >> 7) % 89) / 89))),
        };
      }),
    };
  }, [shown, W, H, maxW, plan.w]);

  return (
    <div className="board">
      <div className="plaque">
        <h1>{eventName}</h1>
        {tagline && <span>{tagline}</span>}
      </div>
      {/* The measured area is always mounted, so it is ready as soon as the first memory arrives. */}
      <div className="pins" ref={area}>
        {spots.map(({ m, x, y }) => <PinCard key={m.id} m={m} showAi={showAi} w={spotW} x={x} y={y} />)}
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
/* One memory filling the whole screen; its words sit on the picture. */
function FullSlide({ m, onVideoEnd, showAi, eventName }) {
  const title = showAi ? m.title : null;
  const words = showAi ? m.caption || m.text : m.text;
  const by = `${m.authorName || 'A guest'} · ${timeLabel(m.createdAt)}`;
  if (m.videoUrl) {
    return (
      <div className="full">
        <Clip src={mediaUrl(m.videoUrl)} onEnded={onVideoEnd} className="full-media" />
        <div className="full-top"><h1>{eventName}</h1></div><i className="full-live" title="Live" /><div className="full-cap">{title && <h2>{title}</h2>}{m.text && <p>{m.text}</p>}<small>{by}</small></div>
      </div>
    );
  }
  if (m.photoUrl) {
    return (
      <div className="full">
        <img className="full-media" src={mediaUrl(m.photoUrl)} alt={title || 'Shared memory'} />
        <div className="full-top"><h1>{eventName}</h1></div><i className="full-live" title="Live" /><div className="full-cap">{title && <h2>{title}</h2>}{words && <p>{words}</p>}<small>{by}</small></div>
      </div>
    );
  }
  return (
    <div className="full full-text">
      <div className="full-top"><h1>{eventName}</h1></div><i className="full-live" title="Live" />
      <blockquote>“{m.text}”</blockquote>
      <small>{by}</small>
    </div>
  );
}

function StoryMode({ story, memories, showAi, eventName }) {
  const byId = useMemo(() => new Map(memories.map((m) => [m.id, m])), [memories]);
  const slides = useMemo(() => {
    // Only the memories themselves, in the order the AI arranged them (beginning to end).
    const out = [];
    story.sections.forEach((s) => s.memoryIds.forEach((id) => byId.has(id) && out.push({ type: 'memory', memory: byId.get(id) })));
    // The story rebuilds a little after each upload; until then, slot any newer memory in by time so nothing is skipped.
    const inStory = new Set(out.map((s) => s.memory.id));
    memories.filter((m) => !inStory.has(m.id)).forEach((m) => {
      const at = out.findIndex((s) => new Date(s.memory.createdAt) > new Date(m.createdAt));
      out.splice(at < 0 ? out.length : at, 0, { type: 'memory', memory: m });
    });
    return out;
  }, [story, byId, memories]);

  const [i, setI] = useState(0);
  const [tick, setTick] = useState(0); // remounts the slide, so a lone video replays
  useEffect(() => setI(0), [story.id]);
  const next = useCallback(() => { setI((n) => (n + 1) % Math.max(1, slides.length)); setTick((t) => t + 1); }, [slides.length]);
  const slide = slides[Math.min(i, slides.length - 1)];
  const isClip = Boolean(slide?.memory.videoUrl);
  // A video plays to its end (with a safety cap); photos and text use the normal timer.
  useEffect(() => {
    if (!slide) return;
    const t = setTimeout(next, isClip ? 60000 : SLIDE_MS);
    return () => clearTimeout(t);
  }, [i, tick, isClip, next, slide]);

  if (!slide) return null;
  return (
    <div className="story">
      <div className="story-stage" key={`${slide.memory.id}-${tick}`}>
        <FullSlide m={slide.memory} onVideoEnd={next} showAi={showAi} eventName={eventName} />
      </div>
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
  const title = settings.wallTitle || event?.name || 'Memory Wall';
  const tagline = settings.tagline ?? 'Share · Explore · Relive';
  const aiOn = settings.aiStories !== false;
  const storyAvailable = aiOn && story && story.sections?.length && memories.length > 0;
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
      socket.on('event:update', setEvent);
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
        {effectiveMode === 'story' ? <StoryMode story={story} memories={memories} showAi={aiOn} eventName={title} /> : <Gallery memories={memories} showAi={aiOn} eventName={title} tagline={tagline} />}
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
