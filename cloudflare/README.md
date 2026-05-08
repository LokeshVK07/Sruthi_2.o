# Sruthi 2.o on Cloudflare — free deploy

Free public hosting using only Cloudflare's free tier:

- **Cloudflare Workers** — Worker that serves the catalogue API + scrapes
  masstamilan live for audio playback.
- **Cloudflare D1** — SQLite-compatible database that stores the 27k songs +
  4.7k albums catalogue exported from your local SQLite.
- **Static assets** — the simple HTML/JS frontend at `public/` is served by
  the same Worker via the `assets` binding, so no separate Pages project is
  required.

The local Python app (`apps/api/`) stays untouched and remains the source of
truth. This deploy is a read-only mirror of your catalogue plus live audio
proxy. Friends visit one URL, no system of yours running 24/7.

> **Note on audio:** masstamilan's CDN URLs are bound to the IP of the
> requester. The Worker scrapes the album page and immediately fetches the
> audio in the same invocation, so the URL is bound to a Cloudflare egress
> IP that's still alive a millisecond later. This works for ~95 % of albums.
> Cloudflare-WAF-blocked albums (e.g. *3 (Moonu)*) still need the local
> Python app's Playwright fallback — the hosted Worker will return 502 for
> those tracks and the frontend will skip to the next song silently.

---

## One-time setup

1. **Install Cloudflare's CLI** (no global install needed — npx pulls it):

   ```bash
   cd cloudflare
   npm install        # installs wrangler 3.x as a dev dep
   npx wrangler login # opens a browser, authenticates with your CF account
   ```

2. **Create the D1 database**:

   ```bash
   npx wrangler d1 create sruthi-catalog
   ```

   It prints a `database_id` (a UUID). Open `wrangler.jsonc` and replace
   `REPLACE_WITH_D1_DATABASE_ID` with that UUID.

3. **Generate the seed file** (already done once, regenerate whenever the
   local catalogue changes):

   ```bash
   npm run export
   ```

   This produces `cloudflare/data/seed.sql` (~18 MB, 27,565 songs / 4,727
   albums).

4. **Seed the remote D1 database**. Wrangler chunks the file automatically:

   ```bash
   npm run seed:remote
   ```

   This takes a couple of minutes — D1's free tier rate-limits a brand-new
   database to ~5 M rows/day, which is plenty.

5. **Deploy the Worker**:

   ```bash
   npm run deploy
   ```

   Wrangler prints a URL like
   `https://sruthi-2o.<your-subdomain>.workers.dev`. Open it in a browser.
   That's the public site — share with friends.

## Updating the catalogue later

Whenever your local Python app refreshes the catalogue and you want the
hosted version to mirror it:

```bash
npm run export        # regenerate seed.sql from local SQLite
npm run seed:remote   # push to D1 (drops + re-creates the two tables)
```

The seed file uses `DROP TABLE IF EXISTS` for `albums` and `songs` only — your
D1 database is reset cleanly with each refresh. Nothing else lives there yet.

## Local development against the real Worker runtime

```bash
npm run dev
```

`wrangler dev` runs the Worker locally with the real `workerd` runtime, an
in-process D1 instance, and the static assets at `public/`. By default it
seeds D1 *locally* the first time you run `npm run seed:local`.

## Project layout

```
cloudflare/
├── package.json          # wrangler scripts
├── wrangler.jsonc        # Worker + D1 + assets config
├── README.md
├── src/
│   └── worker.js         # router: API + audio proxy + static SPA fallback
├── public/               # static frontend (Pages-style assets)
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── Icon.png
├── scripts/
│   └── export_d1_sql.py  # SQLite → D1 SQL dump
└── data/
    └── seed.sql          # generated; do not edit by hand
```

## API surface (mirrors `apps/api/app/main.py`)

| Endpoint | Notes |
|---|---|
| `GET /api/health` | quick liveness probe |
| `GET /api/library/home` | recently-added songs + top artists + counts |
| `GET /api/library/songs?limit=…` | paginated song list |
| `GET /api/albums` | album cards |
| `GET /api/albums/:album_id` | album detail with songs |
| `GET /api/song/:song_id` | single song row |
| `GET /api/search/all?q=…&limit=…` | grouped tracks/albums/artists/composers |
| `GET /api/stream/:song_id` | live scrape + audio proxy |

`/api/playlists`, `/api/favorites`, `/api/recently-played`, and
`/api/composers` return empty stubs — the frontend keeps those features in
`localStorage` since the hosted version has no per-user backend storage. If
you ever want server-side accounts, layer Cloudflare Access on top and store
state in D1 keyed by `cf-access-authenticated-user-email`.

## Costs

Everything used here is on Cloudflare's free tier:

- **Workers free**: 100,000 requests/day
- **D1 free**: 5 GB storage, 5M reads/day, 100K writes/day
- **Static assets**: unlimited bandwidth, no per-request charge
- **Custom domain (optional)**: free if you already own one

Estimated friend-scale usage (10 friends listening daily): well under 5 % of
any free-tier limit.
