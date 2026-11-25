import { useEffect, useRef, useState } from 'react';
import { mediaUrl } from '../api.js';
import './MemoryCard.css';

/** Renders photo / video / text memories in one consistent, soft card. */
export function Clip({ src, onEnded, className = 'mcard-media' }) {
  const ref = useRef();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true; // muted autoplay is allowed by browsers
    const go = () => v.play().catch(() => {});
    go();
    v.addEventListener('loadeddata', go);
    return () => v.removeEventListener('loadeddata', go);
  }, [src]);
  if (failed) return <div className={`${className} clip-fail`}>This video can't be played on this screen</div>;
  return (
    <video
      ref={ref} className={className} src={src} muted playsInline autoPlay preload="auto"
      loop={!onEnded} onEnded={onEnded} onError={() => { setFailed(true); onEnded?.(); }}
    />
  );
}

export default function MemoryCard({ memory: m, showAi = true, large = false, onVideoEnd }) {
  const hasMedia = m.photoUrl || m.videoUrl;
  const title = showAi ? m.title : null;
  const body = showAi ? m.caption || m.text : m.text;

  return (
    <article className={`mcard ${large ? 'large' : ''} ${hasMedia ? '' : 'text-only'}`}>
      {m.videoUrl ? (
        <Clip src={mediaUrl(m.videoUrl)} onEnded={onVideoEnd} />
      ) : (
        m.photoUrl && <img className="mcard-media" src={mediaUrl(m.photoUrl)} alt={title || 'Shared memory'} loading="lazy" />
      )}
      <div className="mcard-body">
        {title && <h3>{title}</h3>}
        {body && <p className={hasMedia ? 'mcard-caption' : 'mcard-quote'}>{hasMedia ? body : `“${body}”`}</p>}
        {hasMedia && m.text && showAi && m.caption !== m.text && <p className="mcard-own">“{m.text}”</p>}
        <footer>
          <span>{m.authorName || 'A guest'}</span>
          {m.tags?.[0] && <span className="chip">{m.tags[0]}</span>}
        </footer>
      </div>
    </article>
  );
}
