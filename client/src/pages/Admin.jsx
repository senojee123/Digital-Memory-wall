import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, connectSocket, getToken, mediaUrl, setToken } from '../api.js';
import './Admin.css';

const FILTERS = [
  ['pending', 'Needs review'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['featured', 'Featured'],
  ['all', 'All'],
];

function Login({ onDone }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  async function go(e) {
    e.preventDefault();
    try { const { token } = await api.login(pw); setToken(token); onDone(); } catch (x) { setErr(x.message); }
  }
  return (
    <main className="login">
      <form className="login-card" onSubmit={go}>
        <h1>Organiser dashboard</h1>
        <p>Sign in to review and curate your memory wall.</p>
        <input className="input" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
        {err && <span className="err">{err}</span>}
        <button className="btn primary">Sign in</button>
      </form>
    </main>
  );
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="toggle">
      <span><strong>{label}</strong><small>{hint}</small></span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i />
    </label>
  );
}

function Row({ m, onAction }) {
  const statusChip = { pending: 'warn', approved: 'ok', rejected: 'danger' }[m.status];
  return (
    <article className="row">
      <div className="thumb">
        {m.photoUrl ? <img src={mediaUrl(m.photoUrl)} alt="" /> : m.videoUrl ? <video src={mediaUrl(m.videoUrl)} muted preload="metadata" /> : <span>Aa</span>}
      </div>
      <div className="row-body">
        <div className="row-top">
          <strong>{m.title || (m.aiStatus === 'processing' ? 'Writing title…' : 'Untitled memory')}</strong>
          <span className={`chip ${statusChip}`}>{m.status}</span>
          {m.featured && <span className="chip">★ featured</span>}
          {m.aiStatus === 'processing' && <span className="spinner" aria-label="AI working" />}
        </div>
        {m.text && <p className="own">“{m.text}”</p>}
        {m.caption && m.caption !== m.text && <p className="cap">{m.caption}</p>}
        {m.moderationNote && <p className="cap">AI check: {m.moderationNote}</p>}
        <small>
          {m.authorName || 'Anonymous'} · {new Date(m.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          {m.category && ` · ${m.category}`}
          {m.photoUrl && ' · photo'}{m.videoUrl && ' · video'}
          {m.theme && ` · ${m.theme}`}
        </small>
      </div>
      <div className="actions">
        {m.status !== 'approved' && <button className="btn sm ok" onClick={() => onAction('approve', m)}>Approve</button>}
        {m.status !== 'rejected' && <button className="btn sm" onClick={() => onAction('reject', m)}>Reject</button>}
        <button className="btn sm" onClick={() => onAction('feature', m)}>{m.featured ? 'Unfeature' : '★ Feature'}</button>
        <button className="btn sm" onClick={() => onAction('regen', m)} title="Rewrite AI text">↻ AI</button>
        <button className="btn sm danger" onClick={() => onAction('delete', m)}>Delete</button>
      </div>
    </article>
  );
}

function Names({ event, onSave }) {
  const s = event.settings || {};
  const [form, setForm] = useState({ name: event.name, wallTitle: s.wallTitle || '', tagline: s.tagline ?? 'Share · Explore · Relive' });
  const [state, setState] = useState('');
  useEffect(() => {
    setForm({ name: event.name, wallTitle: s.wallTitle || '', tagline: s.tagline ?? 'Share · Explore · Relive' });
  }, [event.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setState(''); };
  async function save(e) {
    e.preventDefault();
    setState('saving');
    setState((await onSave(form)) ? 'saved' : '');
  }
  return (
    <form onSubmit={save} className="names">
      <label className="field"><span>Event name</span><input className="input" value={form.name} maxLength={80} onChange={set('name')} required /></label>
      <label className="field"><span>Wall title</span><input className="input" value={form.wallTitle} maxLength={80} onChange={set('wallTitle')} placeholder={form.name} /></label>
      <label className="field"><span>Line under the title</span><input className="input" value={form.tagline} maxLength={100} onChange={set('tagline')} placeholder="Leave empty to hide" /></label>
      <button className="btn primary" disabled={state === 'saving'}>{state === 'saved' ? 'Saved ✓' : 'Save names'}</button>
    </form>
  );
}

export default function Admin() {
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState(null);
  const [memories, setMemories] = useState([]);
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [film, setFilm] = useState({ job: null, latest: null });

  const event = events.find((e) => e.id === eventId);
  const logout = useCallback(() => { setToken(''); setAuthed(false); }, []);
  const guard = useCallback((err) => { if (err.status === 401) logout(); else setNotice(err.message); }, [logout]);

  useEffect(() => {
    if (!authed) return;
    api.events().then((list) => { setEvents(list); setEventId((id) => id ?? list[0]?.id ?? null); }).catch(guard);
  }, [authed, guard]);

  useEffect(() => {
    if (!authed || !eventId) return;
    api.adminMemories(eventId).then(setMemories).catch(guard);
    api.film(eventId).then(setFilm).catch(() => {});
  }, [authed, eventId, guard]);

  useEffect(() => {
    if (!authed || !eventId) return;
    const socket = connectSocket({ admin: true });
    socket.on('admin:memory', (m) => {
      if (m.eventId !== eventId) return;
      setMemories((l) => (l.some((x) => x.id === m.id) ? l.map((x) => (x.id === m.id ? m : x)) : [m, ...l]));
    });
    socket.on('admin:remove', ({ id }) => setMemories((l) => l.filter((m) => m.id !== id)));
    socket.on('film:update', (u) => {
      if (u.eventId !== eventId) return;
      setFilm((f) => ({ ...f, job: u.job }));
      if (u.job.state === 'done') api.film(eventId).then(setFilm).catch(() => {});
    });
    return () => socket.disconnect();
  }, [authed, eventId]);

  const counts = useMemo(() => ({
    pending: memories.filter((m) => m.status === 'pending').length,
    approved: memories.filter((m) => m.status === 'approved').length,
    rejected: memories.filter((m) => m.status === 'rejected').length,
    featured: memories.filter((m) => m.featured).length,
    all: memories.length,
  }), [memories]);

  const shown = memories.filter((m) => (filter === 'all' ? true : filter === 'featured' ? m.featured : m.status === filter));

  async function onAction(kind, m) {
    try {
      if (kind === 'approve') await api.updateMemory(m.id, { status: 'approved' });
      if (kind === 'reject') await api.updateMemory(m.id, { status: 'rejected' });
      if (kind === 'feature') await api.updateMemory(m.id, { featured: !m.featured });
      if (kind === 'regen') await api.regenerate(m.id);
      if (kind === 'delete' && window.confirm('Permanently delete this memory and its files?')) {
        await api.deleteMemory(m.id);
        setMemories((l) => l.filter((x) => x.id !== m.id));
      }
    } catch (e) { guard(e); }
  }

  async function setting(key, value) {
    try {
      const updated = await api.updateSettings(eventId, { [key]: value });
      setEvents((l) => l.map((e) => (e.id === updated.id ? updated : e)));
    } catch (e) { guard(e); }
  }

  async function saveNames(form) {
    try {
      const updated = await api.updateDetails(eventId, form);
      setEvents((l) => l.map((e) => (e.id === updated.id ? updated : e)));
      return true;
    } catch (e) { guard(e); return false; }
  }

  async function generate() {
    setBusy('story'); setNotice('');
    try {
      const s = await api.generateStory(eventId);
      setNotice(`Story updated on the wall: “${s.title}”`);
    } catch (e) { guard(e); } finally { setBusy(''); }
  }

  async function makeFilm() {
    try {
      const r = await api.makeFilm(eventId);
      setFilm((f) => ({ ...f, job: r.job }));
    } catch (e) { guard(e); }
  }

  async function newEvent() {
    const name = window.prompt('Name of the new event');
    if (!name) return;
    try {
      const e = await api.createEvent(name);
      setEvents((l) => [...l, e]); setEventId(e.id);
    } catch (x) { guard(x); }
  }

  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  const s = event?.settings || {};
  const origin = window.location.origin;

  return (
    <div className="admin">
      <header className="a-head">
        <div>
          <h1>Memory Wall</h1>
          <span className="chip blue">Organiser</span>
        </div>
        <div className="a-head-r">
          <select className="input" value={eventId ?? ''} onChange={(e) => setEventId(Number(e.target.value))}>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button className="btn" onClick={newEvent}>+ New event</button>
          <button className="btn" onClick={logout}>Sign out</button>
        </div>
      </header>

      {event && (
        <div className="a-grid">
          <section className="panel">
            <div className="stats">
              <div><b>{counts.pending}</b><span>Needs review</span></div>
              <div><b>{counts.approved}</b><span>On the wall</span></div>
              <div><b>{counts.featured}</b><span>Featured</span></div>
              <div><b>{counts.all}</b><span>Total</span></div>
            </div>
            <div className="tabs" role="tablist">
              {FILTERS.map(([k, label]) => (
                <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
                  {label} <span>{counts[k]}</span>
                </button>
              ))}
            </div>
            <div className="list">
              {shown.length ? shown.map((m) => <Row key={m.id} m={m} onAction={onAction} />) : <p className="none">Nothing here yet.</p>}
            </div>
          </section>

          <aside className="side">
            <section className="panel">
              <h2>Names</h2>
              <p className="hint">The event name appears on the upload page. The wall title and the line under it appear on the display.</p>
              <Names event={event} onSave={saveNames} />
            </section>

            <section className="panel">
              <h2>What the display shows</h2>
              <div className="seg" role="radiogroup" aria-label="Display view">
                {[['gallery', 'Gallery', 'Live pinboard of memories'], ['story', 'Story', 'AI story slideshow']].map(([key, label, hint]) => (
                  <button key={key} role="radio" aria-checked={(s.displayMode || 'gallery') === key} className={(s.displayMode || 'gallery') === key ? 'on' : ''} onClick={() => setting('displayMode', key)}>
                    <strong>{label}</strong><small>{hint}</small>
                  </button>
                ))}
              </div>
              <p className="hint">Changes appear on the display instantly. Story shows once a story exists, until then the display stays on Gallery.</p>
            </section>

            <section className="panel">
              <h2>Display settings</h2>
              <Toggle label="Photos" hint="Accept and show photos" checked={s.photos !== false} onChange={(v) => setting('photos', v)} />
              <Toggle label="Videos" hint="Accept and show videos" checked={s.videos !== false} onChange={(v) => setting('videos', v)} />
              <Toggle label="AI stories" hint="AI titles, captions and Story mode" checked={s.aiStories !== false} onChange={(v) => setting('aiStories', v)} />
              <Toggle label="AI moderation" hint="AI approves or rejects automatically. Off = everything waits for you" checked={s.aiModeration !== false} onChange={(v) => setting('aiModeration', v)} />
            </section>

            <section className="panel">
              <h2>Final event story</h2>
              <p className="hint">The story rebuilds itself automatically as memories are approved (oldest to newest). Use this to refresh it right now.</p>
              <button className="btn primary" onClick={generate} disabled={busy === 'story' || !counts.approved || s.aiStories === false}>
                {busy === 'story' ? <><span className="spinner" /> Writing…</> : 'Regenerate story now'}
              </button>
              {notice && <p className="notice">{notice}</p>}
            </section>

            <section className="panel">
              <h2>Event film</h2>
              <p className="hint">Renders the whole event as an MP4: title, chapters, then every photo, clip and message in order. Long events keep the best moments.</p>
              <button className="btn primary" onClick={makeFilm} disabled={film.job?.state === 'rendering' || !counts.approved}>
                {film.job?.state === 'rendering'
                  ? <><span className="spinner" /> Rendering {film.job.total ? `${film.job.done}/${film.job.total}` : '…'}</>
                  : film.latest ? 'Create a new film' : 'Create event film'}
              </button>
              {film.job?.state === 'error' && <p className="err">Could not make the film: {film.job.error}</p>}
              {film.latest && (
                <div className="film">
                  <video src={mediaUrl(film.latest.url)} controls preload="metadata" />
                  <small>{film.latest.memories} memories · {Math.floor(film.latest.seconds / 60)}:{String(film.latest.seconds % 60).padStart(2, '0')}</small>
                  <a href={mediaUrl(film.latest.url)} download={`${event.slug}-film.mp4`}>Download MP4 ↓</a>
                </div>
              )}
            </section>

            <section className="panel">
              <h2>Links</h2>
              <a href={`${origin}/wall?event=${event.slug}`} target="_blank" rel="noreferrer">Open display screen ↗</a>
              <a href={`${origin}/upload?event=${event.slug}`} target="_blank" rel="noreferrer">Open visitor upload page ↗</a>
              <p className="hint">On the display screen itself: press <kbd>F</kbd> or double-click for fullscreen (browsers don't allow this to be controlled remotely).</p>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
