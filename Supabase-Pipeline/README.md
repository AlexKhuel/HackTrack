# Supabase Pipeline

Runs the full flow in one command:

1. Scrape MLH events (Python)
2. Scrape Devpost events (Python)
3. Clean + merge duplicates (`Parse-Scraped-Data/clean_events.py`)
4. Insert into Supabase Postgres `events` table (JavaScript)

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r Supabase-Pipeline/requirements.txt
npm install --prefix Supabase-Pipeline
```

Create env file:

```bash
cp .env.example .env
# Fill SUPABASE_DB_URL in the repo root .env
```

## Run

From repo root:

```bash
python3 Supabase-Pipeline/run_pipeline.py
```

This writes intermediate files to:

- `Supabase-Pipeline/output/mlh_2026_events.json`
- `Supabase-Pipeline/output/devpost_hackathons.json`
- `Supabase-Pipeline/output/cleaned_events.json`

## Useful options

Default avoids reinserting rows already in DB by checking:

- normalized `url`
- normalized `name + start_date`

Refresh table from scratch:

```bash
python3 Supabase-Pipeline/run_pipeline.py --replace-existing
```

Dry run (no DB writes):

```bash
python3 Supabase-Pipeline/run_pipeline.py --dry-run
```

Use existing scraped files instead of re-scraping:

```bash
python3 Supabase-Pipeline/run_pipeline.py \
  --mlh-input /path/to/mlh_2026_events.json \
  --devpost-input /path/to/devpost_hackathons.json
```

Include ended Devpost hackathons:

```bash
python3 Supabase-Pipeline/run_pipeline.py --devpost-statuses open,upcoming,ended
```

## JS loader only

If you already have a cleaned JSON file, you can run DB load directly:

```bash
node Supabase-Pipeline/load_to_supabase.js --input Supabase-Pipeline/output/cleaned_events.json
```

## Notes

- Target table defaults to `events` and can be changed with `--table`.
- `id` is not inserted because your table auto-generates it.
- JS loader uses `SUPABASE_DB_URL` (or `DATABASE_URL`) unless `--db-url` is passed.
