import { Link } from 'react-router-dom';

const items = [
  ['/wall', 'Display screen', 'The fullscreen memory wall for the big screen', '🖥'],
  ['/upload', 'Visitor upload', 'What guests see after scanning the QR code', '📱'],
  ['/admin', 'Organiser dashboard', 'Approve memories and generate the story', '🗂'],
];

export default function Home() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeContent: 'center', gap: 28, padding: 24, textAlign: 'center',
      background: 'radial-gradient(ellipse at 20% 0%, var(--lavender), transparent 55%), radial-gradient(ellipse at 100% 100%, var(--blue), transparent 55%), var(--bg)' }}>
      <h1 style={{ fontSize: '2.4rem' }}>Memory Wall</h1>
      <div style={{ display: 'grid', gap: 14, width: 'min(440px, 100%)' }}>
        {items.map(([to, title, text, icon]) => (
          <Link key={to} to={to} style={{ display: 'flex', gap: 16, alignItems: 'center', textAlign: 'left', padding: '18px 20px',
            background: 'var(--surface)', borderRadius: 20, boxShadow: 'var(--shadow)', color: 'inherit', textDecoration: 'none' }}>
            <span style={{ fontSize: 30 }}>{icon}</span>
            <span><strong style={{ display: 'block' }}>{title}</strong><small style={{ color: 'var(--muted)' }}>{text}</small></span>
          </Link>
        ))}
      </div>
    </main>
  );
}
