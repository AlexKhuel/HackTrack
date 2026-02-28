# Flights Routes Formatters

These scripts format flight datasets into rows for:

- `id`
- `origin_airport`
- `destination_airport`
- `avg_outbound_price`
- `avg_return_price`
- `avg_outbound_duration_minutes`
- `avg_return_duration_minutes`

Compatible with table:

```sql
create table public.routes (
  id bigint not null,
  origin_airport text null,
  destination_airport text null,
  avg_outbound_price real null,
  avg_return_price real null,
  avg_outbound_duration_minutes smallint null,
  avg_return_duration_minutes smallint null,
  constraint routes_pkey primary key (id)
);
```

## Usage

### 1) From departure/arrival timestamps dataset (`flights.csv`)

```bash
python3 data_pipeline/formatters/flights/format_routes_from_flights.py \
  --input /Users/joshuadowd/Downloads/flights.csv \
  --output /Users/joshuadowd/Downloads/routes_formatted.csv
```

### 2) From DOT fares dataset (`US Airline Flight Routes and Fares 1993-2024.csv`)

```bash
python3 data_pipeline/formatters/flights/format_routes_from_us_fares.py \
  --input "/Users/joshuadowd/Downloads/US Airline Flight Routes and Fares 1993-2024.csv" \
  --output /Users/joshuadowd/Downloads/routes_weighted_post2020.json \
  --min-year 2021 \
  --half-life-quarters 8
```

Committed trimmed dataset path in this repo:

`data_pipeline/data/routes_weighted_post2020.json`

## Notes

- `format_routes_from_flights.py`:
  - Durations are computed after converting local departure/arrival timestamps to UTC.
  - Use `--airport-tz CODE=Area/City` to override airport timezone mapping.
- `format_routes_from_us_fares.py`:
  - Keeps recent rows only (`--min-year`, default `2021`, i.e. post-2020).
  - Uses recency-weighted prices (newer quarters have higher impact).
  - Also weights by passengers by default (`--passenger-weight-power 1.0`).
  - Estimates duration from miles (`nsmiles`) using configurable speed/overhead.
- Both scripts default to one row per airport pair and support `--orientation lex`.
