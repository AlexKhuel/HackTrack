#!/usr/bin/env python3
"""Format US Airline Flight Routes and Fares CSV into public.routes rows.

Expected input columns include:
- Year
- quarter
- airport_1
- airport_2
- nsmiles
- passengers
- fare

Output schema:
- id
- origin_airport
- destination_airport
- avg_outbound_price
- avg_return_price
- avg_outbound_duration_minutes
- avg_return_duration_minutes

This script keeps only recent rows (default: Year >= 2021) and computes
recency-weighted averages so newer quarters influence prices more than older
quarters. Optional passenger weighting is also applied by default.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


OUTPUT_FIELDS = [
    "id",
    "origin_airport",
    "destination_airport",
    "avg_outbound_price",
    "avg_return_price",
    "avg_outbound_duration_minutes",
    "avg_return_duration_minutes",
]


@dataclass
class FareRow:
    origin: str
    destination: str
    year: int
    quarter: int
    fare: float
    passengers: float
    miles: float


@dataclass
class WeightedStats:
    weight_sum: float = 0.0
    weighted_price_sum: float = 0.0
    weighted_duration_sum: float = 0.0
    sample_count: int = 0

    def add(self, price: float, duration_minutes: float, weight: float) -> None:
        self.weight_sum += weight
        self.weighted_price_sum += price * weight
        self.weighted_duration_sum += duration_minutes * weight
        self.sample_count += 1

    def avg_price(self) -> float | None:
        if self.weight_sum <= 0:
            return None
        return round(self.weighted_price_sum / self.weight_sum, 2)

    def avg_duration(self) -> int | None:
        if self.weight_sum <= 0:
            return None
        return int(round(self.weighted_duration_sum / self.weight_sum))


def log(message: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"[{ts}] {message}")


def parse_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_int(value: Any) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def infer_output_format(output_path: Path, explicit: str | None) -> str:
    if explicit:
        return explicit
    return "json" if output_path.suffix.lower() == ".json" else "csv"


def open_csv_with_fallback(path: Path) -> tuple[csv.DictReader, Any]:
    encodings = ("utf-8-sig", "utf-8", "cp1252", "latin-1")
    last_error: Exception | None = None

    for encoding in encodings:
        try:
            fh = path.open("r", encoding=encoding, newline="")
            reader = csv.DictReader(fh)
            _ = reader.fieldnames
            return reader, fh
        except Exception as exc:  # pragma: no cover - defensive fallback
            last_error = exc
            try:
                fh.close()  # type: ignore[name-defined]
            except Exception:
                pass

    raise ValueError(f"Could not read CSV {path}: {last_error}")


def load_recent_rows(path: Path, min_year: int) -> tuple[list[FareRow], dict[str, int]]:
    reader, fh = open_csv_with_fallback(path)

    counts = {
        "raw": 0,
        "kept": 0,
        "skipped_old": 0,
        "skipped_missing": 0,
        "skipped_invalid": 0,
    }
    rows: list[FareRow] = []

    try:
        for row in reader:
            counts["raw"] += 1

            year = parse_int(row.get("Year"))
            quarter = parse_int(row.get("quarter"))
            origin = (row.get("airport_1") or "").strip().upper()
            destination = (row.get("airport_2") or "").strip().upper()
            fare = parse_float(row.get("fare"))
            passengers = parse_float(row.get("passengers"))
            miles = parse_float(row.get("nsmiles"))

            if year is None or quarter is None or not origin or not destination:
                counts["skipped_missing"] += 1
                continue

            if year < min_year:
                counts["skipped_old"] += 1
                continue

            if quarter not in {1, 2, 3, 4}:
                counts["skipped_invalid"] += 1
                continue

            if origin == destination:
                counts["skipped_invalid"] += 1
                continue

            if fare is None or passengers is None or miles is None:
                counts["skipped_missing"] += 1
                continue

            if fare <= 0 or passengers <= 0 or miles <= 0:
                counts["skipped_invalid"] += 1
                continue

            rows.append(
                FareRow(
                    origin=origin,
                    destination=destination,
                    year=year,
                    quarter=quarter,
                    fare=fare,
                    passengers=passengers,
                    miles=miles,
                )
            )
            counts["kept"] += 1
    finally:
        fh.close()

    return rows, counts


def quarter_index(year: int, quarter: int) -> int:
    return year * 4 + quarter


def recency_weight(current_idx: int, row_idx: int, half_life_quarters: float) -> float:
    if half_life_quarters <= 0:
        return 1.0
    delta = max(0, current_idx - row_idx)
    return math.pow(0.5, delta / half_life_quarters)


def estimate_duration_minutes(miles: float, speed_mph: float, fixed_overhead_minutes: float) -> float:
    cruise_minutes = (miles / speed_mph) * 60.0
    estimated = cruise_minutes + fixed_overhead_minutes
    return max(30.0, estimated)


def format_rows(
    rows: list[FareRow],
    *,
    half_life_quarters: float,
    passenger_weight_power: float,
    speed_mph: float,
    fixed_overhead_minutes: float,
    orientation: str,
    id_start: int,
) -> list[dict[str, Any]]:
    if not rows:
        return []

    max_idx = max(quarter_index(row.year, row.quarter) for row in rows)

    directed_stats: dict[tuple[str, str], WeightedStats] = defaultdict(WeightedStats)
    first_seen_direction: dict[tuple[str, str], tuple[str, str]] = {}

    for row in rows:
        idx = quarter_index(row.year, row.quarter)
        recent_factor = recency_weight(max_idx, idx, half_life_quarters)

        passenger_base = max(row.passengers, 1.0)
        passenger_factor = math.pow(passenger_base, passenger_weight_power)
        weight = recent_factor * passenger_factor

        duration_minutes = estimate_duration_minutes(
            miles=row.miles,
            speed_mph=speed_mph,
            fixed_overhead_minutes=fixed_overhead_minutes,
        )

        directed_stats[(row.origin, row.destination)].add(
            price=row.fare,
            duration_minutes=duration_minutes,
            weight=weight,
        )

        pair = tuple(sorted((row.origin, row.destination)))
        if pair not in first_seen_direction:
            first_seen_direction[pair] = (row.origin, row.destination)

    output_rows: list[dict[str, Any]] = []
    for pair in sorted(first_seen_direction):
        if orientation == "lex":
            origin, destination = pair
        else:
            origin, destination = first_seen_direction[pair]

        outbound = directed_stats.get((origin, destination), WeightedStats())
        inbound = directed_stats.get((destination, origin), WeightedStats())

        outbound_price = outbound.avg_price()
        return_price = inbound.avg_price()
        if outbound_price is None and return_price is not None:
            outbound_price = return_price
        if return_price is None and outbound_price is not None:
            return_price = outbound_price

        outbound_duration = outbound.avg_duration()
        return_duration = inbound.avg_duration()
        if outbound_duration is None and return_duration is not None:
            outbound_duration = return_duration
        if return_duration is None and outbound_duration is not None:
            return_duration = outbound_duration

        output_rows.append(
            {
                "id": 0,
                "origin_airport": origin,
                "destination_airport": destination,
                "avg_outbound_price": outbound_price,
                "avg_return_price": return_price,
                "avg_outbound_duration_minutes": outbound_duration,
                "avg_return_duration_minutes": return_duration,
            }
        )

    output_rows.sort(key=lambda row: (row["origin_airport"], row["destination_airport"]))
    for idx, row in enumerate(output_rows, start=id_start):
        row["id"] = idx

    return output_rows


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


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Format US Airline Flight Routes and Fares CSV into routes rows using post-2020 data and "
            "recency-weighted averages."
        )
    )
    parser.add_argument("--input", required=True, help="Path to US Airline Flight Routes and Fares CSV")
    parser.add_argument("--output", required=True, help="Output file path (.json or .csv)")
    parser.add_argument("--format", choices=("json", "csv"), default=None, help="Output format override")
    parser.add_argument(
        "--min-year",
        type=int,
        default=2021,
        help="Minimum Year to keep (default: 2021, i.e. post-2020)",
    )
    parser.add_argument(
        "--half-life-quarters",
        type=float,
        default=8.0,
        help="Recency half-life in quarters (default: 8 = 2 years)",
    )
    parser.add_argument(
        "--passenger-weight-power",
        type=float,
        default=1.0,
        help=(
            "Exponent for passenger weighting (default: 1.0). "
            "Set 0 for recency-only weighting."
        ),
    )
    parser.add_argument(
        "--speed-mph",
        type=float,
        default=500.0,
        help="Assumed average gate-to-gate speed basis for duration estimate (default: 500 mph)",
    )
    parser.add_argument(
        "--fixed-overhead-minutes",
        type=float,
        default=45.0,
        help="Fixed minutes added to duration estimate for taxi/ops overhead (default: 45)",
    )
    parser.add_argument(
        "--orientation",
        choices=("first-seen", "lex"),
        default="first-seen",
        help="Route direction for origin/destination in output rows",
    )
    parser.add_argument("--id-start", type=int, default=1, help="Starting id value")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()

    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 2

    if args.min_year < 1990:
        print("--min-year looks invalid for this dataset.", file=sys.stderr)
        return 2

    if args.half_life_quarters < 0:
        print("--half-life-quarters must be >= 0.", file=sys.stderr)
        return 2

    if args.passenger_weight_power < 0:
        print("--passenger-weight-power must be >= 0.", file=sys.stderr)
        return 2

    if args.speed_mph <= 0:
        print("--speed-mph must be > 0.", file=sys.stderr)
        return 2

    if args.fixed_overhead_minutes < 0:
        print("--fixed-overhead-minutes must be >= 0.", file=sys.stderr)
        return 2

    log(
        "Starting US fares formatter "
        f"(input={input_path}, min_year={args.min_year}, half_life_quarters={args.half_life_quarters})"
    )

    try:
        rows, counts = load_recent_rows(input_path, min_year=args.min_year)
    except Exception as exc:
        print(f"Failed reading input CSV: {exc}", file=sys.stderr)
        return 1

    log(
        f"Rows: raw={counts['raw']}, kept={counts['kept']}, "
        f"skipped_old={counts['skipped_old']}, skipped_missing={counts['skipped_missing']}, "
        f"skipped_invalid={counts['skipped_invalid']}"
    )

    if not rows:
        print("No rows available after filtering. Try lowering --min-year.", file=sys.stderr)
        return 1

    output_rows = format_rows(
        rows,
        half_life_quarters=args.half_life_quarters,
        passenger_weight_power=args.passenger_weight_power,
        speed_mph=args.speed_mph,
        fixed_overhead_minutes=args.fixed_overhead_minutes,
        orientation=args.orientation,
        id_start=args.id_start,
    )

    log(f"Generated {len(output_rows)} route rows")

    if not output_rows:
        print("No output route rows generated.", file=sys.stderr)
        return 1

    try:
        output_format = infer_output_format(output_path, args.format)
        write_output(output_rows, output_path, output_format)
    except Exception as exc:
        print(f"Failed writing output: {exc}", file=sys.stderr)
        return 1

    print(
        f"Wrote {len(output_rows)} routes to {output_path} "
        f"(from {counts['kept']} kept rows, post-{args.min_year - 1})."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
