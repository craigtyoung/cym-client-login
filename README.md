# VoiceCraft — Client Preview & Approvals

A single-purpose, reusable page for sending a client their catalogue to **preview and approve**, track by track. Built for the done-for-you production model: the client hears each piece, approves the ones they're happy with, and adds a note where they want a change. Approvals persist in the browser and can be copied as a clean summary to send back (WhatsApp, email).

First client: **Boris Walter — Sacred Sanctuary**.

## How it works
- `index.html` — the app (design + logic). Do not edit per client.
- `client-data.js` — **the only file you edit per client.** Client name, project, intro, and the track list (grouped by collection) live here.
- `audio/` — drop the preview mp3s here. Each track's `audio:` field is the filename inside this folder. Leave it `""` and the card shows "Preview will be added here shortly."

Approvals + notes are saved in the client's own browser (localStorage), so they survive a refresh. The **Copy my approvals** button builds a plain-text summary (approved list + change requests) for the client to paste back to Craig. No login, no backend.

## Spin up a new client
1. Copy this whole folder, rename it (e.g. `client-preview-clayton`).
2. Edit `client-data.js` — swap client info + track list.
3. Drop preview mp3s into `audio/`, set each `audio:` filename.
4. Set `brand.logoSrc` to the VoiceCraft logo file if you want the image instead of the text wordmark.
5. Deploy (see below) and send the client the link.

## Deploy to Railway
This is a static site. Simplest path: serve the folder with any static host.
- Railway: add a static file server (e.g. a tiny `serve`/Express wrapper) or use a static-site template, point it at this folder.
- Or host on VoiceCraft alongside the platform.

## Status values (in `client-data.js`)
- `ready` — produced, ready for the client's review + approval
- `near` — almost there, final touch in progress
- `queue` — client's vocal is in; music + production still to come

## Notes
- Prices are intentionally **not** shown to the client — this page is preview + approval only.
- Seed data was built from `Sacred-Sanctuary-Project-Organization.csv` (27 pieces across Stories, Bhagavad Gita, Marcus Aurelius).

Related vault notes: [[boris-proposal-2026-09]] · [[boris-walter]]
