#!/usr/bin/env python3
"""Scrape Devpost hackathons into a normalized dataset.

Output fields:
  - name
  - city
  - start_datetime
  - end_datetime
  - total_prize
  - website
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import math
import re
import sys
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, time
from typing import Any, Iterable

import requests
from bs4 import BeautifulSoup
from dateutil import parser as date_parser
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Hide macOS LibreSSL warning noise from urllib3 on some Python builds.
try:
    from urllib3.exceptions import NotOpenSSLWarning
except Exception:  # pragma: no cover - warning class may not exist across urllib3 versions
    NotOpenSSLWarning = None  # type: ignore
if NotOpenSSLWarning is not None:
    warnings.filterwarnings("ignore", category=NotOpenSSLWarning)

API_URL = "https://devpost.com/api/hackathons"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)

MONTH_RE = re.compile(
    r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|"
    r"Nov(?:ember)?|Dec(?:ember)?)\b",
    re.IGNORECASE,
)
YEAR_RE = re.compile(r"\b\d{4}\b")
TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")

PRIZE_NUMBER_RE = re.compile(
    r"(?P<symbol>[$€£₹¥])\s*(?P<number>\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)"
    r"\s*(?P<suffix>[kKmM])?"
)


@dataclass
class HackathonRecord:
    name: str
    city: str | None
    start_datetime: str | None
    end_datetime: str | None
    total_prize: str | None
    website: str


def build_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    retry = Retry(
        total=3,
        read=3,
        connect=3,
        backoff_factor=0.3,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=20, pool_maxsize=20)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


def normalize_space(text: str) -> str:
    return SPACE_RE.sub(" ", text).strip()


def clean_prize_amount(raw_prize: str | None) -> str | None:
    if not raw_prize:
        return None
    value = html.unescape(raw_prize)
    value = TAG_RE.sub("", value)
    value = normalize_space(value)
    return value or None


def has_month(text: str) -> bool:
    return bool(MONTH_RE.search(text))


def has_year(text: str) -> bool:
    return bool(YEAR_RE.search(text))


def month_token(text: str) -> str | None:
    match = MONTH_RE.search(text)
    return match.group(0) if match else None


def parse_submission_period_dates(period: str | None) -> tuple[str | None, str | None]:
    if not period:
        return None, None

    period = normalize_space(period.replace("–", "-"))
    if not period:
        return None, None

    if "-" not in period:
        try:
            single = date_parser.parse(period, fuzzy=True)
        except (ValueError, TypeError, OverflowError):
            return None, None

        start = datetime.combine(single.date(), time(0, 0, 0))
        end = datetime.combine(single.date(), time(23, 59, 59))
        return start.isoformat(), end.isoformat()

    left_raw, right_raw = [normalize_space(part) for part in period.split("-", 1)]

    left_has_month = has_month(left_raw)
    right_has_month = has_month(right_raw)
    left_has_year = has_year(left_raw)
    right_has_year = has_year(right_raw)

    try:
        if left_has_month and right_has_month:
            right = date_parser.parse(right_raw, fuzzy=True)
            left = date_parser.parse(left_raw, fuzzy=True, default=right)
        elif left_has_month and not right_has_month:
            if right_has_year and not left_has_year:
                right_year = YEAR_RE.search(right_raw).group(0)
                left = date_parser.parse(f"{left_raw}, {right_year}", fuzzy=True)
            else:
                left = date_parser.parse(left_raw, fuzzy=True)

            left_month = month_token(left_raw)
            right_augmented = f"{left_month} {right_raw}" if left_month else right_raw
            if left_has_year and not right_has_year:
                right_augmented = f"{right_augmented}, {left.year}"
            right = date_parser.parse(right_augmented, fuzzy=True)
        elif not left_has_month and right_has_month:
            if left_has_year and not right_has_year:
                right = date_parser.parse(f"{right_raw}, {YEAR_RE.search(left_raw).group(0)}", fuzzy=True)
            else:
                right = date_parser.parse(right_raw, fuzzy=True)
            right_month = month_token(right_raw)
            left_augmented = f"{right_month} {left_raw}" if right_month else left_raw
            if right_has_year and not left_has_year:
                left_augmented = f"{left_augmented}, {right.year}"
            left = date_parser.parse(left_augmented, fuzzy=True)
        else:
            left = date_parser.parse(left_raw, fuzzy=True)
            right = date_parser.parse(right_raw, fuzzy=True, default=left)
    except (ValueError, TypeError, OverflowError):
        return None, None

    if left > right and not left_has_year:
        try:
            left = left.replace(year=left.year - 1)
        except ValueError:
            pass

    if left > right and not right_has_year:
        try:
            right = right.replace(year=right.year + 1)
        except ValueError:
            pass

    start = datetime.combine(left.date(), time(0, 0, 0))
    end = datetime.combine(right.date(), time(23, 59, 59))
    return start.isoformat(), end.isoformat()


def extract_city(location: str | None) -> str | None:
    if not location:
        return None

    location = normalize_space(location)
    if not location:
        return None

    lowered = location.casefold()
    if "online" in lowered or "virtual" in lowered:
        return "Online"

    city = location.split(",", 1)[0].strip()
    return city or location


def parse_amount_value(match: re.Match[str]) -> float:
    value = float(match.group("number").replace(",", ""))
    suffix = (match.group("suffix") or "").lower()
    if suffix == "k":
        value *= 1_000
    elif suffix == "m":
        value *= 1_000_000
    return value


def extract_prize_from_text(text: str) -> str | None:
    lines = [normalize_space(line) for line in text.splitlines()]
    lines = [line for line in lines if line]

    best: tuple[float, str] | None = None
    for line in lines:
        lowered = line.casefold()
        if "prize" not in lowered and "win" not in lowered:
            continue

        for match in PRIZE_NUMBER_RE.finditer(line):
            amount = parse_amount_value(match)
            symbol = match.group("symbol")
            score = amount
            if "total prize" in lowered or "prize pool" in lowered:
                score += 1_000_000
            candidate = f"{symbol}{amount:,.0f}"
            if best is None or score > best[0]:
                best = (score, candidate)

    return best[1] if best else None


def map_hackathon(item: dict[str, Any]) -> HackathonRecord | None:
    name = normalize_space(str(item.get("title") or ""))
    website = normalize_space(str(item.get("url") or ""))
    if not name or not website:
        return None

    displayed_location = item.get("displayed_location") or {}
    if isinstance(displayed_location, dict):
        location = displayed_location.get("location")
    else:
        location = None

    start_datetime, end_datetime = parse_submission_period_dates(item.get("submission_period_dates"))
    return HackathonRecord(
        name=name,
        city=extract_city(location),
        start_datetime=start_datetime,
        end_datetime=end_datetime,
        total_prize=clean_prize_amount(item.get("prize_amount")),
        website=website,
    )


def fetch_hackathons(
    session: requests.Session,
    statuses: list[str],
    timeout: float,
    max_pages: int | None,
    max_hackathons: int | None,
) -> list[HackathonRecord]:
    page = 1
    total_pages: int | None = None
    records: list[HackathonRecord] = []

    while True:
        params: list[tuple[str, Any]] = [("page", page)]
        for status in statuses:
            params.append(("status[]", status))

        response = session.get(API_URL, params=params, timeout=timeout)
        response.raise_for_status()

        payload = response.json()
        hackathons = payload.get("hackathons") or []
        meta = payload.get("meta") or {}

        if total_pages is None:
            per_page = int(meta.get("per_page") or len(hackathons) or 1)
            total_count = meta.get("total_count")
            if isinstance(total_count, int) and per_page > 0:
                total_pages = max(1, math.ceil(total_count / per_page))

        if not hackathons:
            break

        for item in hackathons:
            if not isinstance(item, dict):
                continue
            record = map_hackathon(item)
            if not record:
                continue
            records.append(record)
            if max_hackathons is not None and len(records) >= max_hackathons:
                return records[:max_hackathons]

        page += 1

        if max_pages is not None and page > max_pages:
            break
        if total_pages is not None and page > total_pages:
            break

    return records


def enrich_missing_prizes(
    records: list[HackathonRecord],
    timeout: float,
    workers: int,
) -> list[HackathonRecord]:
    targets = [record for record in records if not record.total_prize]
    if not targets:
        return records

    def worker(record: HackathonRecord) -> tuple[str, str | None]:
        session = build_session()
        try:
            response = session.get(record.website, timeout=timeout)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, "html.parser")
            text = soup.get_text(separator="\n", strip=True)
            return record.website, extract_prize_from_text(text)
        except requests.RequestException:
            return record.website, None
        finally:
            session.close()

    by_website = {record.website: record for record in records}
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = [pool.submit(worker, record) for record in targets]
        for future in as_completed(futures):
            website, prize = future.result()
            if prize and website in by_website:
                by_website[website].total_prize = prize

    return records


def output_records(records: Iterable[HackathonRecord], output_path: str, output_format: str) -> None:
    rows = [asdict(record) for record in records]

    if output_format == "json":
        with open(output_path, "w", encoding="utf-8") as file_obj:
            json.dump(rows, file_obj, indent=2, ensure_ascii=False)
        return

    if output_format == "csv":
        fields = ["name", "city", "start_datetime", "end_datetime", "total_prize", "website"]
        with open(output_path, "w", newline="", encoding="utf-8") as file_obj:
            writer = csv.DictWriter(file_obj, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
        return

    raise ValueError(f"Unsupported output format: {output_format}")


def infer_format(output_path: str, explicit: str | None) -> str:
    if explicit:
        return explicit
    if output_path.lower().endswith(".csv"):
        return "csv"
    return "json"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scrape Devpost hackathons into a normalized dataset.")
    parser.add_argument(
        "--statuses",
        default="open,upcoming",
        help="Comma-separated statuses: open,upcoming,ended (default: open,upcoming)",
    )
    parser.add_argument("--output", default="devpost_hackathons.json", help="Output file path")
    parser.add_argument(
        "--format",
        choices=("json", "csv"),
        default=None,
        help="Output format (defaults from output extension)",
    )
    parser.add_argument("--max-pages", type=int, default=None, help="Optional page limit for API pagination")
    parser.add_argument("--max-hackathons", type=int, default=None, help="Optional cap on records")
    parser.add_argument("--timeout", type=float, default=20.0, help="HTTP timeout in seconds")
    parser.add_argument(
        "--enrich-missing-prize",
        action="store_true",
        help="Visit hackathon websites to infer missing prize amounts.",
    )
    parser.add_argument("--workers", type=int, default=8, help="Concurrent workers for enrichment")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    statuses = [part.strip().lower() for part in args.statuses.split(",") if part.strip()]
    allowed = {"open", "upcoming", "ended"}
    invalid = [status for status in statuses if status not in allowed]
    if invalid:
        print(f"Invalid statuses: {', '.join(invalid)}. Allowed: open, upcoming, ended", file=sys.stderr)
        return 2
    if not statuses:
        statuses = ["open", "upcoming"]

    output_format = infer_format(args.output, args.format)

    session = build_session()
    try:
        records = fetch_hackathons(
            session=session,
            statuses=statuses,
            timeout=args.timeout,
            max_pages=args.max_pages,
            max_hackathons=args.max_hackathons,
        )
    except requests.RequestException as exc:
        print(f"Failed to scrape Devpost API: {exc}", file=sys.stderr)
        session.close()
        return 1
    session.close()

    # Deduplicate by website while preserving first occurrence order.
    deduped: list[HackathonRecord] = []
    seen: set[str] = set()
    for record in records:
        key = record.website.casefold()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(record)
    records = deduped

    if args.enrich_missing_prize and records:
        records = enrich_missing_prizes(records, timeout=args.timeout, workers=args.workers)

    output_records(records, args.output, output_format)
    print(f"Wrote {len(records)} hackathons to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
