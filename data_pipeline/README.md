# Data Pipeline Guide

This document is the implementation reference for the ETL pipeline under `data_pipeline/`.

## What this pipeline does

The pipeline ingests three categories of data:

1. Events: scrape MLH, Devpost, and Devfolio hackathons; normalize and deduplicate; load into `events`.
2. Flights: transform a raw flights CSV into route aggregates; load into `routes`.
3. Lodging: combine Booking + Tripadvisor hotel CSVs into city nightly averages; load into `lodging`.

The orchestrator for all flows is `data_pipeline/run_pipeline.js`.

## High-level architecture

1. Scrapers produce raw event JSON/CSV with shared fields:
`name`, `city`, `start_datetime`, `end_datetime`, `total_prize`, `website`.
2. Event formatter (`formatters/events/clean_events.py`) normalizes time/location/prize data and deduplicates records.
3. JS loaders insert or upsert into Postgres tables.
4. Backend admin route (`POST /api/admin/sync-events`) runs the orchestrator asynchronously.

## Repository layout

- `data_pipeline/run_pipeline.js`: orchestration entrypoint.
- `data_pipeline/scrapers/mlh/scrape_mlh_2026.py`: MLH scraper.
- `data_pipeline/scrapers/devpost/scrape_devpost.py`: Devpost scraper.
- `data_pipeline/scrapers/devfolio/scrape_devfolio.py`: Devfolio scraper.
- `data_pipeline/formatters/events/clean_events.py`: event normalization + merge + dedupe.
- `data_pipeline/formatters/flights/format_routes_from_flights.py`: flights CSV to routes dataset.
- `data_pipeline/formatters/hotels/format_lodging_from_hotels.py`: hotel CSVs to lodging dataset.
- `data_pipeline/loaders/load_to_supabase.js`: events loader.
- `data_pipeline/loaders/load_routes.js`: routes loader.
- `data_pipeline/loaders/load_lodging.js`: lodging loader.

## Prerequisites

1. Python 3.10+ (for `zoneinfo` and current formatter/scraper code).
2. Node.js 18+.
3. Postgres/Supabase connection string.

Install dependencies from repo root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r data_pipeline/requirements.txt

cd data_pipeline
npm install
cd ..
```

## Environment variables

Create `.env` in repo root (or copy `.env.example`):

```bash
SUPABASE_DB_URL=postgres://...
DATABASE_URL=postgres://...             # optional fallback
EVENTS_TABLE=events                     # optional override
ROUTES_TABLE=routes                     # optional override
LODGING_TABLE=lodging                   # optional override
```

Resolution order in loaders:

1. `--db-url`
2. `SUPABASE_DB_URL`
3. `DATABASE_URL`

## Quick start

Run full events pipeline (MLH + Devpost + Devfolio):

```bash
node data_pipeline/run_pipeline.js
```

Dry run (no DB writes, still runs scrape/format):

```bash
node data_pipeline/run_pipeline.js --dry-run
```

Run only Devfolio events:

```bash
node data_pipeline/run_pipeline.js \
  --skip-mlh \
  --skip-devpost \
  --dry-run
```

Use pre-generated scraper files instead of scraping:

```bash
node data_pipeline/run_pipeline.js \
  --mlh-input data_pipeline/output/mlh_2026_events.json \
  --devpost-input data_pipeline/output/devpost_hackathons.json \
  --devfolio-input data_pipeline/output/devfolio_hackathons.json \
  --dry-run
```

Run flights + hotels formatting/loading in same invocation:

```bash
node data_pipeline/run_pipeline.js \
  --include-flights \
  --flights-input /path/to/flights.csv \
  --include-hotels \
  --hotels-booking-input /path/to/booking_hotel.csv \
  --hotels-tripadvisor-input /path/to/tripadvisor_room.csv
```

## `run_pipeline.js` reference

### Core output and DB flags

- `--output-dir <path>`: base output directory. Default `data_pipeline/output`.
- `--cleaned-output <path>`: explicit cleaned events output path.
- `--db-url <postgres-url>`: explicit DB URL.
- `--batch-size <n>`: loader batch size. Default `500`.
- `--replace-existing`: truncates target table before load.
- `--dry-run`: skip DB writes.
- `--hang-warning-seconds <n>`: warn if a subprocess emits no output for `n` seconds. Default `60`.
- `--command-timeout-seconds <n>`: force-kill a subprocess after `n` seconds. Default `0` (disabled).

### Event source selection flags

- `--skip-mlh`: do not run/load MLH events.
- `--skip-devpost`: do not run/load Devpost events.
- `--skip-devfolio`: do not run/load Devfolio events.
- `--mlh-input <path>`: use existing MLH JSON/CSV.
- `--devpost-input <path>`: use existing Devpost JSON/CSV.
- `--devfolio-input <path>`: use existing Devfolio JSON/CSV.

### Event scraper tuning flags

- `--mlh-no-enrich`: disable MLH website enrichment pass.
- `--mlh-max-events <n>`: cap MLH events scraped.
- `--devpost-statuses <csv>`: statuses, default `open,upcoming`.
- `--devpost-max-hackathons <n>`: cap Devpost records.
- `--devpost-enrich-missing-prize`: fetch event pages to infer missing prize values.

### Flights flags

- `--include-flights`: run flights formatter + loader.
- `--flights-input <path>`: required with `--include-flights`.
- `--routes-table <name>`: target routes table (default `routes` or `ROUTES_TABLE`).

### Hotels flags

- `--include-hotels`: run lodging formatter + loader.
- `--hotels-booking-input <path>`: required with `--include-hotels`.
- `--hotels-tripadvisor-input <path>`: required with `--include-hotels`.
- `--lodging-table <name>`: target lodging table (default `lodging` or `LODGING_TABLE`).

## Individual script usage

### Scrapers

MLH:

```bash
python3 data_pipeline/scrapers/mlh/scrape_mlh_2026.py --output data_pipeline/output/mlh_2026_events.json
```

Devpost:

```bash
python3 data_pipeline/scrapers/devpost/scrape_devpost.py --output data_pipeline/output/devpost_hackathons.json
```

Devfolio:

```bash
python3 data_pipeline/scrapers/devfolio/scrape_devfolio.py --output data_pipeline/output/devfolio_hackathons.json
```

### Event cleaner

```bash
python3 data_pipeline/formatters/events/clean_events.py \
  --mlh data_pipeline/output/mlh_2026_events.json \
  --devpost data_pipeline/output/devpost_hackathons.json \
  --devfolio data_pipeline/output/devfolio_hackathons.json \
  --output data_pipeline/output/cleaned_events.json \
  --format json
```

### Loaders

Events:

```bash
node data_pipeline/loaders/load_to_supabase.js \
  --input data_pipeline/output/cleaned_events.json \
  --table events
```

Routes:

```bash
node data_pipeline/loaders/load_routes.js \
  --input data_pipeline/output/routes_formatted.json \
  --table routes
```

Lodging:

```bash
node data_pipeline/loaders/load_lodging.js \
  --input data_pipeline/output/lodging_formatted.json \
  --table lodging
```

## Default outputs

When running `run_pipeline.js` with defaults:

- `data_pipeline/output/mlh_2026_events.json`
- `data_pipeline/output/devpost_hackathons.json`
- `data_pipeline/output/devfolio_hackathons.json`
- `data_pipeline/output/cleaned_events.json`
- `data_pipeline/output/routes_formatted.json` (if `--include-flights`)
- `data_pipeline/output/lodging_formatted.json` (if `--include-hotels`)

`data_pipeline/output/` and `data_pipeline/output_test/` are generated working directories. They can be deleted safely; the orchestrator recreates output directories on the next run.

## Deduplication behavior for events

`clean_events.py` deduplicates in two stages:

1. Canonical URL key merge.
2. Normalized `name + start_date` merge.

Merged records combine source provenance in `source` (example: `devfolio,devpost,mlh`).

## Scheduled syncs

GitHub Actions schedule is defined in `.github/workflows/data_pipeline_sync.yml`.

- Cron: `0 0 * * 0,3` (Sunday and Wednesday at 00:00 UTC).
- Action: calls backend `POST /api/admin/sync-events`.
- Backend route then spawns `node data_pipeline/run_pipeline.js` in detached mode.

## Troubleshooting

- `ModuleNotFoundError` for `requests`/`bs4`/`dateutil`: install `pip install -r data_pipeline/requirements.txt`.
- `Missing DB URL`: set `SUPABASE_DB_URL` or pass `--db-url`.
- `No data sources selected`: include at least one events source or pass `--include-flights`/`--include-hotels` with required input paths.
- Unexpected empty events after cleaning: inspect raw scraper outputs and check for malformed `start_datetime` or `website` fields.

## Extending the events pipeline with a new source

1. Add scraper under `data_pipeline/scrapers/<source>/` emitting the standard event field set.
2. Add `--<source>` handling in `formatters/events/clean_events.py` and include source in `load_normalized_records`.
3. Add `--<source>-input` and `--skip-<source>` in `run_pipeline.js`, plus scraper execution block and cleaner wiring.
4. Update this README and any root-level docs that describe active event sources.
