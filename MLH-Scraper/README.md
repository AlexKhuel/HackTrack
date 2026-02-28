# MLH 2026 Event Scraper

Scrapes events from [MLH 2026 season page](https://www.mlh.com/seasons/2026/events) and outputs:

- `name`
- `city`
- `start_datetime`
- `end_datetime`
- `total_prize`
- `website`

If MLH does not expose prize totals or exact datetimes, the scraper optionally visits each event website and attempts enrichment from visible text and JSON-LD metadata.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Usage

Default (JSON output with enrichment):

```bash
python3 scrape_mlh_2026.py
```

CSV output:

```bash
python3 scrape_mlh_2026.py --output mlh_2026_events.csv
```

Skip event-site enrichment (faster, MLH page only):

```bash
python3 scrape_mlh_2026.py --no-enrich
```

Limit events during testing:

```bash
python3 scrape_mlh_2026.py --max-events 5
```

## Notes

- MLH date ranges are converted to datetime strings using:
  - `00:00:00` for start of first day
  - `23:59:59` for end of last day
- For season year `2026`, months `Jul-Dec` are treated as `2025` (MLH season spans Jul 2025 to Jun 2026).
- `total_prize` can be `null` when no reliable amount is found.
