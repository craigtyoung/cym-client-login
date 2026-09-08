# Craig Young Music — Client Preview & Approvals

A single-purpose, reusable platform for taking a client through their catalogue **stage by stage** and collecting their approvals. Built for the done-for-you production model: the client hears each piece at each stage, approves what they're happy with, previews the cover art, and leaves a note where they want a change. Everything persists on the server and can be copied as a clean summary the client pastes back (WhatsApp, email).

First client: **Boris Walter — The Spiritual Sanctuary**.

## The pipeline — 5 stages per piece
1. **Raw** — the client uploads their recording; you gate it (`received` → `accepted` → or `rerecord`).
2. **Cleaned vocal** — you produce it, the client **approves**.
3. **Music** — you add the suggested music, the client previews (optional note).
4. **Final production** — the client gives **final sign-off**.
5. **Cover artwork** — you upload the cover, the client **approves** it (or asks for a change). Consistency per collection is handled by a locked MidJourney recipe, not the platform. Titles are left off covers — every player shows the title as metadata.

Each producing stage has a "ready for client to review" flag so nothing shows until you release it.

## Roles + logins
- **Admin** (you) — upload audio + covers to any stage, toggle when a stage is ready, edit piece details, add/remove pieces, collections, and sacred-text sub-collections. All live, no code edits.
- **Client** — sees only released stages, approves / requests changes, uploads their own raw recording.
- **View as client** — an admin-only toggle in the top bar flips you into the exact client view (read-only) so you can see what they see without logging out.
- **Dashboard** — an admin-only overview: counts (awaiting you / awaiting client / final approved / covers approved) plus a "needs your attention" list that surfaces raw recordings to accept, re-records, and every change the client has requested in one place.

## Files
- `index.html` — the whole app (design + logic). Shared across all clients; don't edit per client.
- `server.js` — Express backend: logins, uploads, persistent JSON store, media serving.
- `seed.js` — the initial catalogue written to the store on **first run only**. This is the per-client starting point: swap client info + track list here before a new client's first launch. After first run the live data lives in `<DATA_DIR>/data.json` and is edited through the admin UI.
- `audio/` — bundled demo audio copied into the store on first run.

Data + uploaded audio + covers live under `DATA_DIR` (a mounted Railway Volume in production). The store is migrated forward automatically on load — new fields are backfilled, retired ones dropped — so older stores keep working after an update.

## Spin up a new client
1. Copy this folder, rename it.
2. Edit `seed.js` — swap client info + track list.
3. Set `ADMIN_CODE` and `CLIENT_CODE` env vars (defaults: `craig-admin` / `sanctuary`).
4. Deploy (below), launch once so the store seeds, then load audio + covers through the admin UI and send the client the link + their code.

## Deploy to Railway
Ships with `server.js` + `package.json` + `railway.json`, so Railway builds and runs it with no extra config. Mount a Volume at `DATA_DIR` (e.g. `/data`) so the store + uploads persist.

```
railway login
railway init --name cym-client-preview
railway up
railway domain
```
Redeploy after any code edit with `railway up`. Content edits happen live in the admin UI, not via redeploy.

Verified locally: `PORT=3210 DATA_DIR=./testdata node server.js` serves index, data, audio, and covers correctly.

## Notes
- Prices are intentionally **not** shown to the client — this is preview + approval only.
- Approvals + notes persist server-side, so they survive across devices and refreshes (not browser-local).
- Seed data was built from `Sacred-Sanctuary-Project-Organization.csv` (27 pieces across Spiritual Stories, Bhagavad Gita, Marcus Aurelius).

Related vault notes: [[boris-proposal-2026-09]] · [[boris-walter]]
