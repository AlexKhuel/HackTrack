# Irvine Hacks / HackTrack

Student-focused hackathon discovery and feasibility ranking.

The app helps users find in-person hackathons they can realistically attend based on:
- home airport(s)
- budget
- travel time
- class schedule constraints
- friend cities (possible free lodging)

Live app: https://irvine-hacks-web.onrender.com/

_Last updated from repository source code on March 1, 2026._

## Current Architecture

This repository is a monorepo with three active runtime areas:

- `web_client/`: React + Vite frontend, with Capacitor iOS support and Google Sign-In integration.
- `api_services/http_api/`: Node.js + Express API (primary production backend).
- `etl_pipeline/`: Python + Node ETL pipeline for events, routes, and lodging datasets.

There is also a separate Python service:

- `api_services/feasibility_scoring_service/`: FastAPI scoring service. It is present in repo but not part of the main Express request path.

## High-Level Data Flow

1. ETL scrapes hackathons from MLH, Devpost, and Devfolio.
2. ETL normalizes, deduplicates, and loads data into Postgres/Supabase tables (`events`, `routes`, `lodging`).
3. Frontend submits user constraints to `GET /api/hackathons/feasible`.
4. Express API applies route, budget, schedule, and optional friend-city logic.
5. Frontend renders ranked cards with client-side scoring breakdown.

## Feature Set (As Implemented)

### Frontend (`web_client`)

- Google Sign-In support:
  - Web: Google Identity Services.
  - iOS: Capacitor social login plugin.
- Guest mode (no auth required to search).
- Optional persistence of user input when signed in (`/api/user-inputs`).
- After sign-in, restores latest saved input when URL query params are not explicitly set.
- URL-backed form state (`?view=...&...`) for shareable/reloadable sessions.
- Airport-based timezone/country inference with browser fallback.
- Local class time input converted into API-compatible timezone-aware boundaries.
- Results page features:
  - loading/error/empty states
  - client-side filters (max one-way travel hours, min prize pool)
  - client-side composite ranking visualization
  - external event links
  - "Copy Journal" action that builds a Markdown travel brief and copies it to clipboard
  - Google Flights / Hotels / Uber deep links in the copied journal
  - optional browser geolocation for better Uber pickup context
- On-demand event-page metadata scrape integration via `GET /api/hackathons/scrape-event`.
- Animated map background and responsive iOS-safe layout behavior.

### API (`api_services/http_api`)

- Feasibility endpoint at:
  - `GET /api/hackathons/feasible`
  - alias: `GET /api/events/feasible`
- Event metadata scrape endpoint at:
  - `GET /api/hackathons/scrape-event`
  - alias: `GET /api/events/scrape-event`
- Supports 1 to 3 origin airports and prioritizes route choices by airport order.
- Budget feasibility:
  - route price + lodging model
  - friend-city lodging waiver
  - local-drive handling for airport clusters (e.g., `LAX/SNA/LGB/ONT/BUR`)
- Time feasibility:
  - Friday departure and Monday return constraints
  - timezone-aware UTC boundary checks
- Optional `include_unmapped=true` mode to return feasible event rows with unknown route/cost metadata when strict feasibility cannot be resolved.
- Destination resolution fallbacks:
  - static city-to-airport mapping
  - route-city inference fallback
  - nearest-airport geocode fallback (Open-Meteo geocoding)
- Auth/user profile endpoints:
  - Google credential verification
  - signed JWT session tokens
  - `app_users` + linked `public."user"` input records
- Admin orchestration endpoint:
  - `POST /api/admin/sync-events` triggers ETL in a detached background process.
  - protected by `Authorization: <ADMIN_API_KEY>`.

### ETL (`etl_pipeline`)

- Orchestrator: `etl_pipeline/run_pipeline.js`
- Event scrapers:
  - `src/scrapers/mlh.py`
  - `src/scrapers/devpost.py`
  - `src/scrapers/devfolio.py`
- Optional flight schedule scraper (AeroDataBox):
  - `src/scrapers/flights.py`
- Formatters:
  - `events.py`: normalization + dedupe + optional online city lookup/cache
  - `flights.py`: route aggregates from raw flight rows
  - `hotels.py`: lodging normalization from hotel CSV
- Loaders:
  - `events.js` (insert with duplicate skipping)
  - `routes.js` (upsert)
  - `lodging.js` (insert/upsert depending on `id`)
- Bundled datasets committed in-repo:
  - `etl_pipeline/data/routes_weighted_post2020.json`
  - `etl_pipeline/data/lodging_formatted.json`
  - `etl_pipeline/data/airport_city_map.json`

## API Contract

### `GET /api/hackathons/feasible`

Required query params:
- `origin_airport`: 1 to 3 IATA codes (supports repeated params, comma-delimited text, and JSON-like arrays)
- `user_timezone`: valid IANA timezone
- `budget`: positive number

Optional query params:
- `friday_last_class_end`: ISO datetime with timezone
- `monday_first_class_start`: ISO datetime with timezone
- `include_lodging`: `true|false` (default `true`)
- `friend_cities`: repeated or delimited city values
- `date_range_start`: ISO datetime with timezone
- `date_range_end`: ISO datetime with timezone
- `max_flight_duration`: non-negative number (minutes, outbound+return)
- `min_prize_pool`: non-negative number
- `include_unmapped`: `true|false`

Response shape:
- `count`
- `results[]` with:
  - `event`
  - `route`
  - `cost_estimate`
  - `time_feasibility`

### `GET /api/hackathons/scrape-event`

Required query params:
- `url`: absolute `http` or `https` URL

Behavior:
- fetches page HTML and extracts event metadata using JSON-LD plus common `<meta>` tags
- blocks localhost/private-network targets for safety

Response shape:
- `fetched_url`
- `event` with:
  - `name`
  - `school`
  - `city`
  - `state`
  - `country`
  - `venue_name`
  - `start_datetime_utc`
  - `end_datetime_utc`
  - `url`
  - `source`

### Auth/User Endpoints

- `POST /api/auth/google`
- `GET /api/auth/me`
- `POST /api/user-inputs`
- `GET /api/user-inputs/latest`

### Admin Endpoint

- `POST /api/admin/sync-events` (requires `Authorization: <ADMIN_API_KEY>`)

### Health

- `GET /health`

## Important Current Behavior Notes

- The feasibility SQL in `routes/hackathons.js` currently includes rows where `source` contains `mlh` or `devpost`, so merged `mlh,devpost` records are included too.
- `POST /api/admin/sync-events` currently spawns ETL with:
  - `--include-all`
  - `--skip-devfolio`
  This keeps routes/lodging updated and refreshes MLH + Devpost events in that path.
- Frontend ranking display is computed client-side in `ResultsList.jsx` and is separate from backend feasibility pass/fail decisions.
- Frontend sets `include_unmapped=true` only for unconstrained searches (no explicit budget, travel-time, or class-time constraints) so users can still see upcoming events when route/cost coverage is incomplete.

## Local Setup

### 1) Prerequisites

- Node.js 20+
- Python 3.10+
- Access to a Postgres/Supabase database

### 2) Environment files

From repo root:

```bash
cp .env.example .env
cp web_client/.env.example web_client/.env
```

Set at least these root `.env` values:

- `SUPABASE_DB_URL`
- `GOOGLE_CLIENT_ID`
- `AUTH_JWT_SECRET`

Common optional root `.env` values:

- `GOOGLE_IOS_CLIENT_ID`
- `GOOGLE_CLIENT_IDS`
- `ADMIN_API_KEY`
- `PORT`
- `EVENTS_TABLE`
- `ROUTES_TABLE`
- `LODGING_TABLE`
- `AERODATABOX_API_KEY` (only for AeroDataBox flights scraper)

Set at least these `web_client/.env` values:

- `VITE_API_BASE_URL=http://127.0.0.1:3000`
- `VITE_GOOGLE_CLIENT_ID=...`

Optional web client values:

- `VITE_API_BASE_URL_IOS=...`
- `VITE_GOOGLE_IOS_CLIENT_ID=...`
- `VITE_GOOGLE_SERVER_CLIENT_ID=...`

### 3) Install dependencies

```bash
npm --prefix api_services install
npm --prefix web_client install
npm --prefix etl_pipeline install

python3 -m venv .venv
source .venv/bin/activate
pip install -r etl_pipeline/requirements.txt
pip install -r api_services/feasibility_scoring_service/requirements.txt
```

## Running Locally

### API (Express)

```bash
npm --prefix api_services run dev
```

Default: `http://127.0.0.1:3000`

### Frontend (Vite)

```bash
npm --prefix web_client run dev
```

If API is not on `3000`, set `VITE_API_BASE_URL` in `web_client/.env` to the API origin.

`VITE_API_PROXY_TARGET` is only needed when using Vite's dev proxy for relative `/api` requests.

For iOS (Capacitor), set `VITE_API_BASE_URL_IOS` to a host reachable from your phone/simulator (not `localhost` on-device).

### ETL (full pipeline)

```bash
npm --prefix etl_pipeline run pipeline:all
```

Dry run:

```bash
npm --prefix etl_pipeline run pipeline:all:dry
```

### Optional FastAPI scoring service

```bash
uvicorn api_services.feasibility_scoring_service.app:app --reload --port 8000
```

## Verification Commands

API tests:

```bash
npm --prefix api_services test
```

Frontend production build:

```bash
npm --prefix web_client run build
```

ETL dry run (no DB writes):

```bash
npm --prefix etl_pipeline run pipeline:all:dry
```

## Deployment and Operations

### Render (`render.yaml`)

Defines two services:

- `irvine-hacks-api` (Node web service)
- `irvine-hacks-web` (static Vite build)

### Scheduled ETL trigger

GitHub Actions workflow:

- `.github/workflows/etl_pipeline_sync.yml`
- Runs at `00:00 UTC` every Sunday and Wednesday.
- Calls `POST $BACKEND_URL/api/admin/sync-events` with `Authorization: $ADMIN_API_KEY`.

## Repository Layout

```text
.
├── api_services/
│   ├── http_api/
│   │   ├── index.js
│   │   ├── auth.js
│   │   ├── db.js
│   │   ├── routes/
│   │   └── feasibility/
│   └── feasibility_scoring_service/
├── etl_pipeline/
│   ├── run_pipeline.js
│   ├── src/
│   │   ├── scrapers/
│   │   ├── formatters/
│   │   └── loaders/
│   └── data/
├── web_client/
│   ├── src/
│   └── ios/
└── render.yaml
```
