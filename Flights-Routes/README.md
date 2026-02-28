# Flights Routes Formatter

Formats a raw flights CSV into rows for:

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

```bash
python3 Flights-Routes/format_routes_from_flights.py \
  --input /Users/joshuadowd/Downloads/flights.csv \
  --output /Users/joshuadowd/Downloads/routes_formatted.csv
```

## Notes

- Durations are computed after converting local departure/arrival timestamps to UTC.
- Default route direction is first-seen per airport pair.
- Use `--orientation lex` to force alphabetical direction.
- Use `--airport-tz CODE=Area/City` to override airport timezone mapping.
