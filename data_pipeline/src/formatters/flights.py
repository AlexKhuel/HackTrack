#!/usr/bin/env python3
"""Format raw flights CSV into rows for public.routes.

Target schema:
  id bigint not null,
  origin_airport text,
  destination_airport text,
  city text,
  avg_outbound_price real,
  avg_return_price real,
  avg_outbound_duration_minutes smallint,
  avg_return_duration_minutes smallint

Notes:
- Durations are computed after converting departure/arrival local timestamps to UTC.
- One output row is produced per airport pair. Outbound direction is configurable.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

SPACE_RE = re.compile(r"\s+")
PRICE_RE = re.compile(r"-?\d+(?:,\d{3})*(?:\.\d+)?")

# Fallback tz map for common US airports in the provided flights dataset.
# You can extend this map or pass --airport-tz overrides for additional airports.
FALLBACK_AIRPORT_TZ: dict[str, str] = {
    "BOS": "America/New_York",
    "JFK": "America/New_York",
    "LAS": "America/Los_Angeles",
    "LAX": "America/Los_Angeles",
    "ORD": "America/Chicago",
    "SFO": "America/Los_Angeles",
}

DEFAULT_AIRPORT_TO_CITY: dict[str, str] = {
    "ATL": "Atlanta",
    "AUS": "Austin",
    "BNA": "Nashville",
    "BOS": "Boston",
    "BWI": "Baltimore",
    "CLE": "Cleveland",
    "CLT": "Charlotte",
    "CMH": "Columbus",
    "CMI": "Champaign",
    "DCA": "Washington",
    "DEN": "Denver",
    "DFW": "Dallas",
    "DTW": "Detroit",
    "EWR": "Newark",
    "GNV": "Gainesville",
    "IAH": "Houston",
    "ITH": "Ithaca",
    "JFK": "New York",
    "LAS": "Las Vegas",
    "LAX": "Los Angeles",
    "MCI": "Kansas City",
    "MCO": "Orlando",
    "MIA": "Miami",
    "MSP": "Minneapolis",
    "OAK": "Oakland",
    "ORD": "Chicago",
    "PDX": "Portland",
    "PHL": "Philadelphia",
    "PHX": "Phoenix",
    "PIT": "Pittsburgh",
    "RDU": "Raleigh",
    "SAN": "San Diego",
    "SAT": "San Antonio",
    "SEA": "Seattle",
    "SFO": "San Francisco",
    "SJC": "San Jose",
    "SLC": "Salt Lake City",
    "SNA": "Irvine",
    "STL": "St. Louis",
}

DEFAULT_AIRPORT_CITY_MAP_PATH = Path(__file__).resolve().parents[2] / "data" / "airport_city_map.json"

OUTPUT_FIELDS = [
    "id",
    "origin_airport",
    "destination_airport",
    "city",
    "avg_outbound_price",
    "avg_return_price",
    "avg_outbound_duration_minutes",
    "avg_return_duration_minutes",
]


def log(message: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{ts}] {message}")


@dataclass
class RunningStats:
    count: int = 0
    price_sum: float = 0.0
    duration_sum: int = 0

    def add(self, price: float, duration_minutes: int) -> None:
        self.count += 1
        self.price_sum += price
        self.duration_sum += duration_minutes

    def avg_price(self) -> float | None:
        if self.count == 0:
            return None
        return round(self.price_sum / self.count, 2)

    def avg_duration(self) -> int | None:
        if self.count == 0:
            return None
        return int(round(self.duration_sum / self.count))


def normalize_space(value: Any) -> str | None:
    if value is None:
        return None
    text = SPACE_RE.sub(" ", str(value)).strip()
    return text or None


def parse_price(raw: Any) -> float | None:
    text = normalize_space(raw)
    if not text:
        return None

    match = PRICE_RE.search(text)
    if not match:
        return None

    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return None


def parse_local_datetime(raw: Any) -> datetime | None:
    text = normalize_space(raw)
    if not text:
        return None

    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue

    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def parse_bool_like(raw: Any) -> bool:
    text = (normalize_space(raw) or "").casefold()
    return text in {"1", "true", "yes", "y"}


def normalize_airport_code(raw: Any) -> str | None:
    token = normalize_space(raw)
    if not token:
        return None
    token = token.upper()
    if len(token) == 4 and token.startswith("K") and token[1:].isalpha():
        token = token[1:]
    if len(token) == 3 and token.isalpha():
        return token
    return None


def airport_timezone_map(extra_overrides: list[str]) -> dict[str, str]:
    mapping = dict(FALLBACK_AIRPORT_TZ)

    # Optional enrichment from airportsdata package if available.
    try:
        import airportsdata  # type: ignore

        loaded = airportsdata.load("IATA")
        for code, meta in loaded.items():
            if not isinstance(meta, dict):
                continue
            tz = meta.get("tz")
            if isinstance(tz, str) and tz:
                mapping[code.upper()] = tz
    except Exception:
        pass

    for override in extra_overrides:
        if "=" not in override:
            raise ValueError(f"Invalid --airport-tz override: {override}. Expected CODE=Area/City")
        code, tz_name = override.split("=", 1)
        code = code.strip().upper()
        tz_name = tz_name.strip()
        if not code or not tz_name:
            raise ValueError(f"Invalid --airport-tz override: {override}. Expected CODE=Area/City")
        # Validate timezone string early.
        ZoneInfo(tz_name)
        mapping[code] = tz_name

    return mapping


def airport_city_map(path: Path | None) -> dict[str, str]:
    mapping = dict(DEFAULT_AIRPORT_TO_CITY)
    map_path = path
    if map_path is None and DEFAULT_AIRPORT_CITY_MAP_PATH.exists():
        map_path = DEFAULT_AIRPORT_CITY_MAP_PATH
    if map_path is None:
        return mapping

    with map_path.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)

    loaded = 0
    if isinstance(payload, dict):
        items = payload.items()
    elif isinstance(payload, list):
        items = []
        for row in payload:
            if not isinstance(row, dict):
                continue
            code = row.get("airport_code") or row.get("iata") or row.get("code")
            city = row.get("city")
            items.append((code, city))
    else:
        raise ValueError("airport-city map must be either a JSON object or array of objects")

    for code_raw, city_raw in items:
        code = normalize_airport_code(code_raw)
        city = normalize_space(city_raw)
        if code and city and code not in mapping:
            mapping[code] = city
            loaded += 1

    log(f"Loaded {loaded} airport→city entries from {map_path}")
    return mapping


def compute_duration_minutes_utc(
    departure_local: datetime,
    arrival_local: datetime,
    departure_tz: ZoneInfo,
    arrival_tz: ZoneInfo,
    lands_next_day: bool,
) -> int | None:
    dep_local = departure_local
    arr_local = arrival_local

    # Some datasets mark next-day flights but keep same calendar date in arrival.
    if lands_next_day and arr_local <= dep_local:
        arr_local = arr_local + timedelta(days=1)

    dep_utc = dep_local.replace(tzinfo=departure_tz).astimezone(timezone.utc)
    arr_utc = arr_local.replace(tzinfo=arrival_tz).astimezone(timezone.utc)

    # Guard for bad/ambiguous local date data.
    attempts = 0
    while arr_utc <= dep_utc and attempts < 2:
        arr_local = arr_local + timedelta(days=1)
        arr_utc = arr_local.replace(tzinfo=arrival_tz).astimezone(timezone.utc)
        attempts += 1

    delta_minutes = int(round((arr_utc - dep_utc).total_seconds() / 60))
    if delta_minutes <= 0:
        return None
    return delta_minutes


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        return [dict(row) for row in reader]


def write_output(rows: list[dict[str, Any]], output_path: Path, output_format: str) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if output_format == "json":
        with output_path.open("w", encoding="utf-8") as fh:
            json.dump(rows, fh, indent=2)
        return

    if output_format == "csv":
        with output_path.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.DictWriter(fh, fieldnames=OUTPUT_FIELDS)
            writer.writeheader()
            writer.writerows(rows)
        return

    raise ValueError(f"Unsupported output format: {output_format}")


def format_for_routes(
    raw_rows: list[dict[str, str]],
    airport_tz: dict[str, str],
    airport_to_city: dict[str, str],
    orientation: str,
    id_start: int,
) -> tuple[list[dict[str, Any]], int]:
    directed_stats: dict[tuple[str, str], RunningStats] = defaultdict(RunningStats)
    first_seen_direction: dict[tuple[str, str], tuple[str, str]] = {}
    skipped = 0

    for row in raw_rows:
        origin = (normalize_space(row.get("Departure Airport")) or "").upper()
        destination = (normalize_space(row.get("Arrival Airport")) or "").upper()
        if not origin or not destination or origin == destination:
            skipped += 1
            continue

        dep_local = parse_local_datetime(row.get("Departure Date"))
        arr_local = parse_local_datetime(row.get("Arrival Date"))
        price = parse_price(row.get("Price"))
        lands_next_day = parse_bool_like(row.get("Flight Lands Next Day"))

        if dep_local is None or arr_local is None or price is None:
            skipped += 1
            continue

        dep_tz_name = airport_tz.get(origin)
        arr_tz_name = airport_tz.get(destination)
        if not dep_tz_name or not arr_tz_name:
            skipped += 1
            continue

        try:
            dep_tz = ZoneInfo(dep_tz_name)
            arr_tz = ZoneInfo(arr_tz_name)
        except Exception:
            skipped += 1
            continue

        duration_minutes = compute_duration_minutes_utc(
            departure_local=dep_local,
            arrival_local=arr_local,
            departure_tz=dep_tz,
            arrival_tz=arr_tz,
            lands_next_day=lands_next_day,
        )
        if duration_minutes is None:
            skipped += 1
            continue

        directed_stats[(origin, destination)].add(price=price, duration_minutes=duration_minutes)

        pair = tuple(sorted((origin, destination)))
        if pair not in first_seen_direction:
            first_seen_direction[pair] = (origin, destination)

    route_rows: list[dict[str, Any]] = []
    for pair in sorted(first_seen_direction):
        if orientation == "lex":
            origin, destination = pair
        else:
            origin, destination = first_seen_direction[pair]

        outbound = directed_stats.get((origin, destination), RunningStats())
        inbound = directed_stats.get((destination, origin), RunningStats())

        route_rows.append(
            {
                "id": 0,
                "origin_airport": origin,
                "destination_airport": destination,
                "city": airport_to_city.get(origin),
                "avg_outbound_price": outbound.avg_price(),
                "avg_return_price": inbound.avg_price(),
                "avg_outbound_duration_minutes": outbound.avg_duration(),
                "avg_return_duration_minutes": inbound.avg_duration(),
            }
        )

    route_rows.sort(key=lambda row: (row["origin_airport"], row["destination_airport"]))
    for idx, row in enumerate(route_rows, start=id_start):
        row["id"] = idx

    return route_rows, skipped


def infer_output_format(output_path: Path, explicit: str | None) -> str:
    if explicit:
        return explicit
    return "json" if output_path.suffix.lower() == ".json" else "csv"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Format flights CSV into public.routes rows with UTC-based duration averaging."
    )
    parser.add_argument("--input", required=True, help="Path to raw flights CSV")
    parser.add_argument("--output", required=True, help="Output file path (.csv or .json)")
    parser.add_argument("--format", choices=("csv", "json"), default=None, help="Output format override")
    parser.add_argument(
        "--orientation",
        choices=("first-seen", "lex"),
        default="first-seen",
        help="Route direction for origin/destination in output rows",
    )
    parser.add_argument("--id-start", type=int, default=1, help="Starting id value")
    parser.add_argument(
        "--airport-tz",
        action="append",
        default=[],
        help="Override timezone mapping (repeatable): CODE=Area/City",
    )
    parser.add_argument(
        "--airport-city-map",
        default=None,
        help=(
            "Optional JSON mapping for city field. "
            "Accepts {\"LAX\":\"Los Angeles\"} or [{\"airport_code\":\"LAX\",\"city\":\"Los Angeles\"}]."
            " Defaults to data_pipeline/data/airport_city_map.json when present."
        ),
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    log(f"Starting flights formatter (input={input_path}, output={output_path})")

    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 2

    try:
        airport_tz = airport_timezone_map(args.airport_tz)
    except Exception as exc:
        print(f"Failed to load airport timezone mapping: {exc}", file=sys.stderr)
        return 2
    log(f"Loaded airport timezone mappings: {len(airport_tz)}")

    try:
        airport_city_map_path = Path(args.airport_city_map).expanduser().resolve() if args.airport_city_map else None
        if airport_city_map_path and not airport_city_map_path.exists():
            print(f"Airport-city map not found: {airport_city_map_path}", file=sys.stderr)
            return 2
        airport_to_city = airport_city_map(airport_city_map_path)
    except Exception as exc:
        print(f"Failed to load airport-city mapping: {exc}", file=sys.stderr)
        return 2
    log(f"Loaded airport-city mappings: {len(airport_to_city)}")

    try:
        rows = read_rows(input_path)
    except Exception as exc:
        print(f"Failed to read input CSV: {exc}", file=sys.stderr)
        return 1
    log(f"Read {len(rows)} raw flight rows")

    formatted_rows, skipped = format_for_routes(
        raw_rows=rows,
        airport_tz=airport_tz,
        airport_to_city=airport_to_city,
        orientation=args.orientation,
        id_start=args.id_start,
    )
    log(f"Formatted {len(formatted_rows)} route rows (skipped {skipped} raw rows)")

    if not formatted_rows:
        print("No output rows generated. Check input columns/timezones.", file=sys.stderr)
        return 1

    try:
        output_format = infer_output_format(output_path, args.format)
        write_output(formatted_rows, output_path, output_format)
    except Exception as exc:
        print(f"Failed to write output: {exc}", file=sys.stderr)
        return 1

    print(
        f"Wrote {len(formatted_rows)} routes to {output_path} "
        f"(from {len(rows)} input rows, skipped {skipped})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
