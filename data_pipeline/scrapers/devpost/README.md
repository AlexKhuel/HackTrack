# Devpost Hackathon Scraper

Scrapes Devpost hackathons from `https://devpost.com/api/hackathons` and outputs:

- `name`
- `city`
- `start_datetime`
- `end_datetime`
- `total_prize`
- `website`

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Usage

Default run (active hackathons: `open,upcoming`):

```bash
python3 scrape_devpost.py
```

CSV output:

```bash
python3 scrape_devpost.py --output devpost_hackathons.csv
```

Include historical ended hackathons:

```bash
python3 scrape_devpost.py --statuses open,upcoming,ended
```

Only ended hackathons:

```bash
python3 scrape_devpost.py --statuses ended
```

Limit records while testing:

```bash
python3 scrape_devpost.py --max-hackathons 25
```

Optional enrichment for missing prize values:

```bash
python3 scrape_devpost.py --enrich-missing-prize
```

## Notes

- `city` is best-effort from Devpost location text (for online events it is `Online`).
- Date ranges from `submission_period_dates` are converted to datetime strings using:
  - `00:00:00` for start of first day
  - `23:59:59` for end of last day
- `total_prize` is sourced from Devpost `prize_amount` and normalized to plain text.
- Some records may still have `null` fields when Devpost does not provide structured values.
