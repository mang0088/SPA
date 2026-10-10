# Entertainment catalog: design brainstorm and delivery plan

## Reconnaissance snapshot

- **Repository tree:** `README.md`, `index.html`, `css/main.css`, `js/main.js`, `.vscode/launch.json` (plus Git metadata). There is no `src/`, component library, package manifest, lockfile, test directory, router, TypeScript compiler, or build system.
- **Current stack:** static HTML + Bootstrap 4.6 loaded from CDN, hand-written CSS, and plain browser JavaScript. The page uses History API/hash navigation and `localStorage`; it has no state library.
- **Current features:** actor-name search via TMDB, browser-local search-result caching, name/popularity sorting, actor-to-known-film navigation, and a landing area with eight randomly shuffled popular movies and a shuffle button.
- **Credentials:** the browser JavaScript currently embeds a TMDB API key. A static page cannot safely read a server `.env` file; moving the literal into a frontend `.env` or build-time variable would still publish it in browser assets. The safe migration is a small same-origin server proxy that reads `TMDB_API_KEY` from an ignored `.env`, injects it server-side, and exposes only a constrained TMDB request route. Keep `.env.example` secret-free. Previously published Git history cannot be retroactively made secret by this source change; rotate the key in TMDB if it has been shared publicly.
- **Routing/page gap:** no `/discover`, `/title`, `/search`, `/schedule`, `/watchlist`, `/trailers`, or `/browse/genre` routes exist. The current hash scheme covers person search and known-for media only. There are no typed models, shared TMDB client, request deduplication, response cache policy, detail tabs, theme persistence, SEO route metadata, or TMDB attribution.

## LiveChart reference critique

LiveChart is useful as a *density and scanning* reference: clear category navigation, compact repeated rows/cards, visible dates/episode metadata, and strong grouping make a large catalogue quick to compare. Copying its anime-specific hierarchy literally would poorly serve films, Western TV, and Asian dramas; reproducing its density without a visual hierarchy would also make the existing small app feel noisy. This project should borrow the information order and scanability, not its identity or styling. Every result still uses the same restrained liquid-glass materials, legible typography, and clear whitespace.

## Three composition concepts

### A — Floating glass rail + editorial bento

A compact floating glass header sits above a featured, asymmetric bento hero; a narrow segmented rail changes catalog type, followed by dense adaptive cards. Detail pages use a backdrop hero, a glass poster/sidebar, and tabbed content.

- **Strengths:** memorable landing hierarchy; easy to feature one title; naturally uses layers and depth.
- **Risks:** bento loses useful rows to decoration; sidebar and rail compete on smaller screens; more elaborate than the current one-page application can support immediately.

### B — Centered serene feed + ambient aurora

A floating pill header anchors a centered title/context line, glass segmented catalog tabs, a single filter strip, and a regular adaptive grid. Detail pages keep a restrained backdrop behind a two-column glass information panel and a segmented content bar.

- **Strengths:** fast to scan, responsive, and predictable across Movies, TV, anime, and dramas; works well with the required four/three/two/one-column grid; shares a reusable visual grammar between catalog and detail pages.
- **Risks:** less editorial drama than a bento hero; needs good card hierarchy and occasional featured content to avoid sameness.

### C — Sidebar glass dock + wide catalogue cards

A persistent glass dock holds catalog sections and filters while wide horizontal result cards prioritize synopsis, network, and episode information. Detail pages use a wide poster/backdrop split.

- **Strengths:** excellent for TV schedules and dense metadata; desktop filters remain available while scanning.
- **Risks:** costly horizontal space on tablets/phones, awkward for poster-led movie browsing, and would require more responsive state/navigation work.

## Chosen direction: B with selective A/C elements

Use the serene centered feed as the default composition. Add one modest editorial featured area only when genuine TMDB data supports it (never fabricated editorial text); use a compact, optionally collapsible information treatment for episode-rich TV/anime cards. Keep the same frosted surfaces, hairlines, subtle specular edge, soft colored shadows, rounded chips, and muted seafoam/aqua palette throughout. Detail pages should use the restrained two-column hero/sidebar arrangement from A, stacking cleanly on narrow screens. Borrow C's grouping and scan-friendly episode/date alignment only for a future schedule view.

## Content strategy for dense media data

- Keep the poster as the primary visual anchor; show title, genre, premiere/release, rating, and one concise synopsis first.
- Movies use only fields TMDB actually supplies: release date, runtime (from a cached/detail request), rating, and genres. Do not invent availability or runtime on list responses.
- TV/anime/dramas put the episode/season and next-air information into small frosted chips; show network and source only after a cached detail/keyword lookup. Unknown values are omitted or represented by a quiet em dash, never fabricated.
- Streaming providers are a dedicated detail section, grouped by TMDB's region and offer type; do not put provider logos on every list card.
- Cast, videos, images, and recommendations are separate detail tabs/rails so they do not overload the catalogue card.
- Countdown values require a single shared ticker, timezone-aware targets, and explicit “Airing now”/“Released” terminal states; do not start one timer per card.
- On narrow screens, preserve the same priority order and hide only secondary metadata behind an accessible expansion, rather than shrinking text to illegibility.

## Architecture and preservation decisions

- Preserve the existing static app as the starting point and keep actor search/sorting/history behavior during migration.
- Do not claim a frontend `.env` protects an API key. Add a same-origin Node proxy before removing browser credentials; run the static UI through that server. Keep the canonical TMDB v3 base URL unchanged in the server/client wrapper contract.
- Introduce strict TypeScript incrementally for the TMDB boundary and new catalog state. Avoid a framework/router dependency until the first working vanilla implementation proves the page/routing needs; add one only if route-level complexity warrants it.
- The catalog brief is a multi-milestone product, not a safe one-shot edit. Each milestone should end with a running-app check and a truthful gap report.

## Gap analysis against target pages

| Target | Existing coverage | Gap |
| --- | --- | --- |
| Discover: Trending, Movies, TV, Anime, Asian Dramas | Random page of popular movies; shuffle | No tabs, URL-synced state, filters, genre mapping, adaptive media cards, pagination, loading/retry states |
| Detail: movie/TV | Actor known-for display | No title routes, appended detail calls, hero/sidebar, episodes, videos, providers, visuals, recommendations, ratings |
| Search | Actor-only search | No multi-search, live suggestions, media-type tabs, debounce/count |
| Schedule | None | Entire page and JST weekday grouping missing |
| Watchlist | None | Saved state, persistence, and badge missing |
| Trailers/genres/404 | None | All missing |
| Liquid-glass system | Dark glass treatment and motion from earlier work | No light theme, restrained aurora/grain system, full tokenized theme, reliable blur fallback, shared chip/tab/skeleton states, or contrast audit |
| Platform engineering | Plain JS and browser fetch/localStorage | No env boundary, server, TypeScript, shared client/cache/types, tests, build scripts, request dedupe, aborts, or route SEO |
| Cross-cutting | Some lazy poster images and responsive layouts | No global attribution, namespaced preferences, reduced-motion audit across all effects, or comprehensive keyboard/ARIA behavior |

## Ordered implementation plan (M0–M9)

1. **M0 — this document:** record reference critique, alternatives, selection, content strategy, and gaps before product-code edits.
2. **M1 — safe foundation:** add a secret-free `.env.example`, ignore local `.env`, and a same-origin TMDB proxy so the API key is never sent to the browser. Add a typed request/cache boundary as tooling permits; retain existing page behavior.
3. **M2 — Liquid Glass shell:** establish serene light/dark tokens, ambient background, accessible theme persistence, shared glass controls, header/footer, and fallback/reduced-motion behavior.
4. **M3 — Discover hub:** route/tab state for Trending, Movies, TV, season-scoped Anime, and Asian Dramas; API-backed filters, responsive grid, pagination, skeleton/empty/error states.
5. **M4 — adaptive cards:** media-specific metadata, bookmarks, and one shared timezone-aware countdown ticker; lazy detail lookups only where needed.
6. **M5 — detail foundation:** movie/TV detail routes, single appended detail request, backdrop/sidebar, INFO panel, metadata, cast, user rating.
7. **M6 — detail data tabs:** seasons/episodes, videos, providers/regions, visuals/lightbox, and recommendations.
8. **M7 — supporting destinations:** multi-search, schedule, watchlist, trailers, genre browsing, and not-found state.
9. **M8 — accessibility/responsive/SEO:** keyboard semantics, AA contrast checks, responsive QA at 360/768/1024/1440, route metadata, attribution.
10. **M9 — release QA:** audit every positive/negative design constraint, verify API/key boundaries, no-console-error/regression passes, and document remaining TMDB data limitations.

## M0 completion

This document is the design and implementation decision record and precedes all implementation changes for the requested catalog upgrade.
