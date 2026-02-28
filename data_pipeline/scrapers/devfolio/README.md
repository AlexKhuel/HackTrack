# Devfolio Hackathon Scraper

Scrapes Devfolio hackathons from `https://devfolio.co/hackathons` and outputs:

- `name`
- `city`
- `start_datetime`
- `end_datetime`
- `total_prize`
- `website`

## Usage

Default run (JSON):

```bash
python3 scrape_devfolio.py
```

Explicit output path:

```bash
python3 scrape_devfolio.py --output devfolio_hackathons.json
```

CSV output:

```bash
python3 scrape_devfolio.py --output devfolio_hackathons.csv
```

Limit records while testing:

```bash
python3 scrape_devfolio.py --max-hackathons 25
```

## Notes

- Event URLs are discovered from the Devfolio hackathons listing page.
- Dates are parsed from each event page (`Runs from`) into datetime text.
- Prize amounts are extracted best-effort from visible event page text.
