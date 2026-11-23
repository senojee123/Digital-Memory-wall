import { mediaUrl } from '../api.js';
import './MemoryCard.css';

/** Renders photo / video / text memories in one consistent, soft card. */
export default function MemoryCard({ memory: m, showAi = true, large = false }) {
  const hasMedia = m.photoUrl || m.videoUrl;
  const title = showAi ? m.title : null;
  const body = showAi ? m.caption || m.text : m.text;

  return (
    <article className={`mcard ${large ? 'large' : ''} ${hasMedia ? '' : 'text-only'}`}>
      {m.photoUrl && <img className="mcard-media" src={mediaUrl(m.photoUrl)} alt={title || 'Shared memory'} loading="lazy" />}
      {m.videoUrl && (
        <video className="mcard-media" src={mediaUrl(m.videoUrl)} muted loop playsInline autoPlay preload="metadata" />
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
