import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { uploadsDir } from './storage.js';

const W = 1920, H = 1080, FPS = 30;
const SERIF = "Georgia, 'Times New Roman', 'DejaVu Serif', serif";
const SANS = "'Segoe UI', Arial, 'DejaVu Sans', sans-serif";
const INK = '#343a52', MUTED = '#7b8097';
const here = path.dirname(fileURLToPath(import.meta.url));
const MUSIC = process.env.FILM_MUSIC || path.resolve(here, '..', 'assets', 'music.mp3');

/* ---------------- ffmpeg ---------------- */
function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, ['-y', '-hide_banner', ...args]);
    let err = '';
    p.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg failed (${code}): ${err.slice(-600)}`))));
  });
}
const ffmpegInfo = (file) => ffmpeg(['-i', file]).catch((e) => e.message); // -i alone exits non-zero but prints the duration

const fade = (d) => `fade=t=in:st=0:d=0.4,fade=t=out:st=${(d - 0.4).toFixed(2)}:d=0.4`;
const enc = ['-r', String(FPS), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-an'];

/* ---------------- drawing ---------------- */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxW, maxLines) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '…'); }
  return lines;
}

function paragraph(ctx, text, x, y, maxW, lh, maxLines) {
  const lines = wrap(ctx, text, maxW, maxLines);
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  return y + lines.length * lh;
}

function canvas(c1, c2) {
  const cv = createCanvas(W, H);
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  return { cv, ctx };
}

const png = (cv) => cv.encode('png');

function centered(ctx, { kicker, title, body }) {
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  let y = 380;
  if (kicker) { ctx.fillStyle = '#6a77c4'; ctx.font = `600 30px ${SANS}`; ctx.fillText(kicker.toUpperCase(), W / 2, y); y += 90; }
  ctx.fillStyle = INK; ctx.font = `500 96px ${SERIF}`;
  y = paragraph(ctx, title, W / 2, y, 1500, 112, 3) + 30;
  if (body) { ctx.fillStyle = MUTED; ctx.font = `400 42px ${SANS}`; paragraph(ctx, body, W / 2, y, 1300, 62, 3); }
}

const titleSlide = ({ title, subtitle }) => { const { cv, ctx } = canvas('#e7e1f6', '#dcebf7'); centered(ctx, { kicker: 'Our story', title, body: subtitle }); return png(cv); };
const chapterSlide = ({ n, heading, description }) => { const { cv, ctx } = canvas('#f3ece1', '#e7e1f6'); centered(ctx, { kicker: `Chapter ${n}`, title: heading, body: description }); return png(cv); };
const endSlide = ({ eventName }) => { const { cv, ctx } = canvas('#dcebf7', '#e7e1f6'); centered(ctx, { title: 'Thank you for sharing', body: eventName }); return png(cv); };

const BOX = { x: 160, y: 60, w: 1600, h: 700 };

/** Memory frame. For videos the card is left empty and ffmpeg overlays the clip on top of it. */
async function memorySlide(m, img) {
  const { cv, ctx } = canvas('#faf8f4', '#f1ecf8');
  // card
  ctx.save();
  ctx.shadowColor = 'rgba(52,58,82,0.12)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
  ctx.fillStyle = '#ffffff'; roundRect(ctx, BOX.x, BOX.y, BOX.w, BOX.h, 36); ctx.fill();
  ctx.restore();

  const textOnly = !img && !m.videoUrl;
  if (img) {
    const pad = 20, bw = BOX.w - pad * 2, bh = BOX.h - pad * 2;
    const s = Math.min(bw / img.width, bh / img.height);
    const w = img.width * s, h = img.height * s;
    ctx.save();
    roundRect(ctx, BOX.x + (BOX.w - w) / 2, BOX.y + (BOX.h - h) / 2, w, h, 24); ctx.clip();
    ctx.drawImage(img, BOX.x + (BOX.w - w) / 2, BOX.y + (BOX.h - h) / 2, w, h);
    ctx.restore();
  }
  if (textOnly) {
    ctx.fillStyle = '#efeaf9'; roundRect(ctx, BOX.x + 20, BOX.y + 20, BOX.w - 40, BOX.h - 40, 28); ctx.fill();
    ctx.textAlign = 'center'; ctx.fillStyle = INK; ctx.font = `italic 500 64px ${SERIF}`;
    const lines = wrap(ctx, `“${m.text || m.caption || ''}”`, 1300, 6);
    const top = BOX.y + BOX.h / 2 - (lines.length * 86) / 2 + 56;
    lines.forEach((l, i) => ctx.fillText(l, W / 2, top + i * 86));
  }

  // caption
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK; ctx.font = `500 58px ${SERIF}`;
  ctx.fillText(m.title || 'A shared moment', BOX.x, 860);
  ctx.fillStyle = MUTED; ctx.font = `400 32px ${SANS}`;
  const line = !textOnly ? m.caption || m.text : m.caption && m.caption !== m.text ? m.caption : '';
  if (line) paragraph(ctx, line, BOX.x, 920, 1250, 44, 2);
  ctx.textAlign = 'right'; ctx.font = `500 28px ${SANS}`;
  ctx.fillText(m.authorName || 'A guest', BOX.x + BOX.w, 860);
  return png(cv);
}

/* ---------------- media access ---------------- */
async function toFile(url, dir, name) {
  if (url.startsWith('file:')) return fileURLToPath(url);
  const rel = url.split('/uploads/')[1];
  if (rel && existsSync(path.join(uploadsDir, rel))) return path.join(uploadsDir, rel);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch ${url}`);
  const file = path.join(dir, name + path.extname(new URL(url).pathname));
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

/* ---------------- render ---------------- */
/**
 * chapters: [{ heading, description, memories: [memory rows as serialized DTOs] }]  (already in order)
 * Returns { file, seconds, cleanup }.
 */
export async function renderFilm({ title, subtitle, eventName, chapters, onProgress = () => {} }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mw-film-'));
  const cleanup = () => fs.rm(dir, { recursive: true, force: true });
  try {
    const segments = [];
    const total = 2 + chapters.length + chapters.reduce((n, c) => n + c.memories.length, 0);
    let done = 0, idx = 0;
    const tick = () => onProgress(++done, total);

    const still = async (buf, seconds) => {
      const img = path.join(dir, `s${idx}.png`), out = path.join(dir, `s${idx++}.mp4`);
      await fs.writeFile(img, buf);
      await ffmpeg(['-loop', '1', '-i', img, '-t', String(seconds), '-vf', fade(seconds), ...enc, out]);
      segments.push(out); tick();
    };

    await still(await titleSlide({ title, subtitle }), 4.5);

    for (const [ci, ch] of chapters.entries()) {
      await still(await chapterSlide({ n: ci + 1, heading: ch.heading, description: ch.description }), 3.5);
      for (const m of ch.memories) {
        try {
          let img = null, clip = null;
          if (m.photoUrl) {
            try { img = await loadImage(await fs.readFile(await toFile(m.photoUrl, dir, `p${idx}`))); } catch { img = null; }
          }
          if (m.videoUrl) clip = await toFile(m.videoUrl, dir, `v${idx}`);

          const frame = path.join(dir, `m${idx}.png`), out = path.join(dir, `m${idx++}.mp4`);
          await fs.writeFile(frame, await memorySlide(m, clip ? null : img));
          if (clip) {
            const secs = 8;
            await ffmpeg([
              '-loop', '1', '-i', frame, '-i', clip, '-t', String(secs),
              '-filter_complex',
              `[1:v]scale=${BOX.w - 40}:${BOX.h - 40}:force_original_aspect_ratio=decrease,fps=${FPS},setsar=1[v];` +
                `[0:v][v]overlay=(W-w)/2:${BOX.y + BOX.h / 2}-h/2:shortest=1,${fade(5)}[o]`,
              '-map', '[o]', ...enc, out,
            ]).catch(async () => {
              // A clip ffmpeg cannot decode: fall back to the caption card alone.
              await ffmpeg(['-loop', '1', '-i', frame, '-t', '4', '-vf', fade(4), ...enc, out]);
            });
          } else {
            const secs = !img && !m.photoUrl ? 5.5 : 5;
            await ffmpeg(['-loop', '1', '-i', frame, '-t', String(secs), '-vf', fade(secs), ...enc, out]);
          }
          segments.push(out);
        } catch (err) {
          console.warn('Skipping a memory in the film:', err.message);
        }
        tick();
      }
    }

    await still(await endSlide({ eventName }), 4);

    const list = path.join(dir, 'list.txt');
    await fs.writeFile(list, segments.map((s) => `file '${s.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'));
    const joined = path.join(dir, 'joined.mp4');
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);

    const out = path.join(dir, 'film.mp4');
    let seconds = 0;
    const info = await ffmpegInfo(joined);
    const t = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(info);
    if (t) seconds = +t[1] * 3600 + +t[2] * 60 + +t[3];

    if (existsSync(MUSIC) && seconds) {
      await ffmpeg([
        '-i', joined, '-stream_loop', '-1', '-i', MUSIC, '-map', '0:v', '-map', '1:a', '-t', seconds.toFixed(2),
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-af', `afade=t=in:d=2,afade=t=out:st=${Math.max(0, seconds - 3).toFixed(2)}:d=3`,
        '-movflags', '+faststart', out,
      ]);
    } else {
      await ffmpeg(['-i', joined, '-c', 'copy', '-movflags', '+faststart', out]);
    }
    return { file: out, seconds, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
