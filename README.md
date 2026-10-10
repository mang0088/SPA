# Stillframe — entertainment catalog

Stillframe is an early, server-rendered-by-static-files entertainment catalogue built with semantic HTML, custom CSS, strict TypeScript, and The Movie Database (TMDB) v3 API. Its visual direction uses a restrained liquid-glass shell, ambient seafoam/aqua light, and responsive scan-friendly catalogue cards.

## Stack and structure

- `index.html` — minimal static shell and metadata.
- `css/main.css` — liquid-glass light/dark themes, aurora ambient layer, cards, filters, detail styles, and responsive breakpoints.
- `src/main.ts` — typed interactive catalogue UI and state.
- `src/catalog.ts`, `src/tmdb.ts`, `src/cache.ts`, `src/types.ts` — query mapping, request/cache boundary, and TMDB types.
- `src/auth.ts` — typed client boundary for the same-origin account API.
- `server.cjs` — static file server, constrained same-origin TMDB proxy, and email/password account API.
- `docs/BRAINSTORM.md` — reference critique, design alternatives, selection, gap analysis, and rollout plan.

## Run locally

Requires Node.js 18+ and npm.

1. Copy `.env.example` to `.env` and add your TMDB v3 API key as `TMDB_API_KEY`.
2. Run `npm install`.
3. Run `npm run dev` (strict TypeScript build followed by the local server).
4. Open `http://127.0.0.1:8080`.
5. Run `npm test` for the strict build and Node test suite.

The API key is read only by `server.cjs`; do not put it in browser JavaScript or commit `.env`. The browser uses the same-origin `/api/tmdb` proxy. The canonical upstream API base remains `https://api.themoviedb.org/3/`.

## Current catalogue features

- TMDB-backed Trending, Movies, TV Shows, Anime, and Asian Dramas tabs.
- Sort, language, release-status, and category filters in a panel opened by the header filter icon; active filters are flagged on the icon and tab/filter state is reflected in the URL.
- Season-scoped anime query with season/year selection; responsive cards, shimmer loading, retry/empty messaging, and load-more / intersection-sentinel pagination.
- Email/password accounts: signup, login, logout, and session restore from the header account area.
- Persistent theme and watchlist, live multi-search suggestions, and a title detail foundation for movie/TV routes.
- Existing people search is reachable through the search overlay's actor field.

## Accounts

`server.cjs` owns the whole account flow — no third-party identity service is involved.

- `POST /api/auth/signup` takes `displayName`, `email`, and `password` (8–128 characters) and returns the new account plus an `HttpOnly`, `SameSite=Lax` session cookie.
- `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/session` complete the flow.
- Passwords are hashed with `scrypt` and a per-account random salt; only the derived hash is stored.
- Sessions are opaque random tokens stored server-side as SHA-256 digests, so logout revokes them immediately and a leaked store is not a usable credential.
- Accounts and sessions live in `data/auth.json` (git-ignored, override with `DATA_DIR`). Static serving refuses to serve that directory.
- Requests to the account API are size-limited and rate-limited per client; the session cookie is marked `Secure` when `SESSION_COOKIE_SECURE=1`.
- An authenticated watchlist is stored per account on the server and syncs across signed-in browsers. Titles saved before signup/sign-in are merged into the account on the first session restore.
- Signing out clears account-specific watchlist data from that browser; signing back into the account restores it. Anonymous browsing can still use the local watchlist.
- Watchlist endpoints are `GET /api/auth/watchlist` and `PUT /api/auth/watchlist`; they require a valid session and accept up to 500 title records.

## Scope still in progress

This is an incremental upgrade, not yet the entire global-catalog roadmap in `docs/BRAINSTORM.md`. Accounts do not yet support password reset or email verification. Detail tabs currently have a foundations-only state; full episodes/videos/providers/visuals/recommendations interactions, schedule/trailers/genre/watchlist routes, SSR SEO, shared countdown ticker, full keyboard/dialog focus management, and measured AA contrast audit remain future milestones. Anime “Source” tags and episode countdowns are not guessed when TMDB data is missing. TMDB credentials and network availability are required for live catalogue data.

## TMDB attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.
