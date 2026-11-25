# Memory Wall

Visitors scan a QR code, share a photo, video or message, and an AI-written story builds on a big exhibition screen in real time. Organisers moderate everything from a dashboard.

```
client/   React + Vite (plain CSS)   → Vercel
server/   Express + Socket.IO + pg   → Render / Railway / AWS
```

| Route | Purpose |
|---|---|
| `/upload?event=<slug>` | Mobile visitor upload (the QR code points here) |
| `/wall?event=<slug>` | Fullscreen display. Keys: `G` gallery, `S` story, `F` fullscreen |
| `/admin` | Organiser dashboard (password login) |

## Run locally

1. Create a Postgres database (`createdb memorywall`).
2. Backend:
   ```
   cd server
   cp .env.example .env     # set DATABASE_URL, ADMIN_PASSWORD, AUTH_SECRET, GEMINI_API_KEY
   npm install
   npm run dev              # tables + a "default" event are created on first start
   ```
3. Frontend:
   ```
   cd client
   npm install
   npm run dev              # http://localhost:5173 (proxies the API; reachable from phones on your LAN)
   ```
4. Open `/admin`, sign in, then open `/wall` on the display and `/upload` on a phone.

## How it works

- **Submit**: any mix of photo, video, text. Photos are downscaled in the browser, then stored (local disk or S3). Memories start as *pending* unless *Auto-approve* is on.
- **AI**: for each memory the server asks Gemini (vision + text) for a title, caption, short story, timeline line, theme, tags and story chapter. Without `GEMINI_API_KEY` a keyword-based fallback keeps everything working. Videos are categorised from their text and category only; frames are not analysed yet.
- **Realtime**: approving a memory emits `memory:upsert` over Socket.IO and it appears on the wall with a spotlight. Reject/delete emits `memory:remove`. Settings and stories also push live.
- **Final story**: *Generate event story* groups approved memories (featured first) into Beginning / Special Moments / Achievements / Future Memories. The wall's Story mode plays it as an auto-advancing slideshow.
- **Toggles**: photos, videos and AI stories can be switched per event; the wall reacts instantly.

## Deploy

- **Database**: any cloud Postgres (Neon, Supabase, Render, RDS). Set `PGSSL=true` if required.
- **Backend** (Render/Railway): root `server`, start `npm start`. Set every variable from `.env.example`; `CLIENT_ORIGIN` = your Vercel URL, `PUBLIC_API_URL` = the backend URL. These hosts have ephemeral disks, so set `STORAGE_DRIVER=s3`, with a bucket allowing public reads (or a CDN in `S3_PUBLIC_URL`) and AWS credentials in the usual `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`. Firebase Storage was not wired in; `server/src/storage.js` is the only file to swap.
- **Frontend** (Vercel): root `client`, set `VITE_API_URL` to the backend URL. `vercel.json` handles SPA routing.

## Before a real event

- Change `ADMIN_PASSWORD` and `AUTH_SECRET`.
- Keep *Auto-approve* off for public audiences. All content is reviewed by a human first.
- Do a full dry run on the venue network with the actual display.
