import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { Server } from 'socket.io';
import { migrate, one } from './db.js';
import { createRouter } from './routes.js';
import { uploadsDir } from './storage.js';
import { verifyToken } from './auth.js';

const origins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim());

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: origins } });

app.set('trust proxy', 1);
app.use(cors({ origin: origins }));
app.use(express.json({ limit: '100kb' }));
app.use('/uploads', express.static(uploadsDir, { maxAge: '7d' }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api', createRouter(io));

app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That file is too large (max 80 MB).' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

io.on('connection', (socket) => {
  if (verifyToken(socket.handshake.auth?.token)) socket.join('admin');
  socket.on('join', async (slug) => {
    const e = await one('SELECT id FROM events WHERE slug=$1', [String(slug)]).catch(() => null);
    if (e) socket.join(`event:${e.id}`);
  });
});

const port = process.env.PORT || 4000;
migrate()
  .then(() => server.listen(port, () => console.log(`Memory Wall API listening on :${port}`)))
  .catch((err) => {
    console.error('Startup failed:', err.message);
    process.exit(1);
  });
