import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import './Upload.css';

const CATEGORIES = ['Celebration', 'Milestone', 'Friendship', 'Family', 'Achievement', 'Everyday'];
const MAX_TEXT = 600;
const MAX_VIDEO_MB = 80;

/** Downscale big phone photos so uploads are fast and vision analysis stays within limits. */
async function shrinkImage(file, maxSide = 1600) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    return blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file; // e.g. HEIC on browsers that can't decode it: send as-is
  }
}

/** Grab one still from a video so the AI safety check can actually see it. Never shown publicly. */
function videoFrame(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    const done = (blob) => { URL.revokeObjectURL(url); resolve(blob); };
    const timer = setTimeout(() => done(null), 8000);
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 1) / 2); };
    v.onseeked = () => {
      clearTimeout(timer);
      const scale = Math.min(1, 800 / Math.max(v.videoWidth, v.videoHeight || 1));
      const c = document.createElement('canvas');
      c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      c.toBlob(done, 'image/jpeg', 0.8);
    };
    v.onerror = () => { clearTimeout(timer); done(null); };
  });
}

function Dropzone({ kind, file, onFile, onClear, accept }) {
  const [over, setOver] = useState(false);
  const input = useRef();
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const pick = (f) => f && onFile(f);

  if (file) {
    return (
      <div className="preview">
        {kind === 'photo' ? <img src={preview} alt="Selected" /> : <video src={preview} controls playsInline muted />}
        <button type="button" className="btn sm clear" onClick={onClear}>Remove</button>
      </div>
    );
  }
  return (
    <div
      className={`drop ${over ? 'over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]); }}
      onClick={() => input.current.click()}
      role="button" tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current.click()}
    >
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => pick(e.target.files[0])} />
      <strong>Tap to choose a {kind}</strong>
      <span>or drag and drop it here</span>
    </div>
  );
}

export default function Upload() {
  const [params] = useSearchParams();
  const slug = params.get('event') || 'default';
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState(null);
  const [video, setVideo] = useState(null);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [open, setOpen] = useState({ photo: false, video: false, text: false });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => { api.event(slug).then(setEvent).catch(() => setError('We could not find this event.')); }, [slug]);

  const settings = event?.settings || {};
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const hasContent = photo || video || text.trim();

  async function submit(e) {
    e.preventDefault();
    if (!hasContent) return setError('Add a photo, a video or a message to share.');
    setBusy(true); setError('');
    try {
      const form = new FormData();
      form.set('event', slug);
      // File.lastModified is the capture time for camera files; the server uses it only when it is plausible.
      const media = photo || video;
      if (media?.lastModified) form.set('takenAt', new Date(media.lastModified).toISOString());
      if (photo) form.set('photo', await shrinkImage(photo));
      if (video) {
        form.set('video', video);
        const frame = await videoFrame(video);
        if (frame) form.set('frame', new File([frame], 'frame.jpg', { type: 'image/jpeg' }));
      }
      if (text.trim()) form.set('text', text.trim());
      if (name.trim()) form.set('name', name.trim());
      if (category) form.set('category', category);
      const res = await api.submit(form);
      setDone(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPhoto(null); setVideo(null); setText(''); setCategory(''); setOpen({ photo: false, video: false, text: false }); setDone(null); setError('');
  }

  function chooseVideo(f) {
    if (f.size > MAX_VIDEO_MB * 1024 * 1024) return setError(`Please choose a video under ${MAX_VIDEO_MB} MB.`);
    setError(''); setVideo(f);
  }

  if (done) {
    return (
      <main className="up-shell">
        <section className="up-card thanks">
          <div className="heart">♡</div>
          <h1>Thank you for sharing</h1>
          <p>Your memory is being checked and will appear on the wall in a few moments.</p>
          <button className="btn primary" onClick={reset}>Share another memory</button>
        </section>
      </main>
    );
  }

  return (
    <main className="up-shell">
      <header className="up-head">
        <span className="chip blue">{event?.name || 'Memory Wall'}</span>
        <h1>Share a memory</h1>
        <p>{event?.description || 'Add a photo, a video or a few words. Every memory becomes part of our story.'}</p>
      </header>

      <form className="up-card" onSubmit={submit}>
        <div className="tiles" role="group" aria-label="What would you like to add?">
          {settings.photos !== false && (
            <button type="button" className={`tile ${open.photo ? 'on' : ''}`} onClick={() => toggle('photo')} aria-pressed={open.photo}>
              <i>🖼</i>Add photo
            </button>
          )}
          {settings.videos !== false && (
            <button type="button" className={`tile ${open.video ? 'on' : ''}`} onClick={() => toggle('video')} aria-pressed={open.video}>
              <i>🎞</i>Add video
            </button>
          )}
          <button type="button" className={`tile ${open.text ? 'on' : ''}`} onClick={() => toggle('text')} aria-pressed={open.text}>
            <i>✍️</i>Add text
          </button>
        </div>

        {open.photo && settings.photos !== false && (
          <Dropzone kind="photo" accept="image/*" file={photo} onFile={setPhoto} onClear={() => setPhoto(null)} />
        )}
        {open.video && settings.videos !== false && (
          <Dropzone kind="video" accept="video/*" file={video} onFile={chooseVideo} onClear={() => setVideo(null)} />
        )}
        {open.text && (
          <label className="field">
            <span>Your message <em>{text.length}/{MAX_TEXT}</em></span>
            <textarea className="input" rows={4} maxLength={MAX_TEXT} value={text} onChange={(e) => setText(e.target.value)} placeholder="What made this moment special?" />
          </label>
        )}

        <label className="field">
          <span>Your name (optional)</span>
          <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Shown on your memory card" autoComplete="given-name" />
        </label>

        <div className="field">
          <span>Category (optional)</span>
          <div className="cats">
            {CATEGORIES.map((c) => (
              <button key={c} type="button" className={`cat ${category === c ? 'on' : ''}`} onClick={() => setCategory(category === c ? '' : c)}>{c}</button>
            ))}
          </div>
        </div>

        {error && <p className="err" role="alert">{error}</p>}
        <button className="btn primary submit" disabled={busy || !hasContent}>
          {busy ? <><span className="spinner" /> Sharing…</> : 'Share memory'}
        </button>
        <p className="fine">Memories are checked automatically to keep the wall friendly for everyone.</p>
      </form>
    </main>
  );
}
