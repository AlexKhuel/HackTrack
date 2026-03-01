#!/usr/bin/env python3
"""Scrape MLH 2026 events and enrich records from event websites.

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
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timezone
from typing import Any, Iterable, Iterator
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from dateutil import parser as date_parser
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

DEFAULT_URL = "https://www.mlh.com/seasons/2026/events"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)

MONTH_TO_NUM = {
    "JAN": 1,
    "JANUARY": 1,
    "FEB": 2,
    "FEBRUARY": 2,
    "MAR": 3,
    "MARCH": 3,
    "APR": 4,
    "APRIL": 4,
    "MAY": 5,
    "JUN": 6,
    "JUNE": 6,
    "JUL": 7,
    "JULY": 7,
    "AUG": 8,
    "AUGUST": 8,
    "SEP": 9,
    "SEPT": 9,
    "SEPTEMBER": 9,
    "OCT": 10,
    "OCTOBER": 10,
    "NOV": 11,
    "NOVEMBER": 11,
    "DEC": 12,
    "DECEMBER": 12,
}

MONTH_PATTERN = (
    r"Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|"
    r"Nov(?:ember)?|Dec(?:ember)?"
)

DATE_RANGE_RE = re.compile(
    rf"(?P<m1>{MONTH_PATTERN})\s*(?P<d1>\d{{1,2}})(?:st|nd|rd|th)?\s*[-–]\s*"
    rf"(?:(?P<m2>{MONTH_PATTERN})\s*)?(?P<d2>\d{{1,2}})(?:st|nd|rd|th)?",
    re.IGNORECASE,
)

MODE_RE = re.compile(
    r"\b(?:in[- ]?person(?:\s+only)?|digital(?:\s+only)?|online(?:\s+only)?)\b",
    re.IGNORECASE,
)
CATEGORY_PREFIX_RE = re.compile(r"^(?:DIVERSITY|HIGH SCHOOL)\s+", re.IGNORECASE)

SYMBOL_TO_CODE = {
    "$": "USD",
    "€": "EUR",
    "£": "GBP",
    "₹": "INR",
    "¥": "JPY",
}

SYMBOL_AMOUNT_RE = re.compile(
    r"(?P<symbol>[$€£₹¥])\s*"
    r"(?P<number>\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|\d+(?:\.\d+)?)"
    r"\s*(?P<suffix>[kKmM])?"
)
CODE_AMOUNT_RE = re.compile(
    r"(?P<number>\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|\d+(?:\.\d+)?)"
    r"\s*(?P<suffix>[kKmM])?\s*"
    r"(?P<code>USD|CAD|EUR|GBP|INR|AUD|JPY|PKR|MXN|SGD)\b",
    re.IGNORECASE,
)


@dataclass
class EventRecord:
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


def log(message: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}] {message}")


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def normalize_city(city: str | None) -> str | None:
    if not city:
        return None
    city = normalize_space(city)
    city = re.sub(r"\s*,\s*", ", ", city)
    return city.strip(" -")


def month_to_num(token: str) -> int:
    return MONTH_TO_NUM[token.strip().upper().rstrip(".")]


def season_year_for_month(month: int, season_year: int) -> int:
    # MLH season "2026" spans Jul 2025 -> Jun 2026.
    return season_year - 1 if month >= 7 else season_year


def parse_date_range(date_text: str, season_year: int) -> tuple[str | None, str | None]:
    match = DATE_RANGE_RE.search(date_text)
    if not match:
        return None, None

    m1 = month_to_num(match.group("m1"))
    d1 = int(match.group("d1"))
    m2 = month_to_num(match.group("m2") or match.group("m1"))
    d2 = int(match.group("d2"))

    y1 = season_year_for_month(m1, season_year)
    y2 = season_year_for_month(m2, season_year)

    start_day = date(y1, m1, d1)
    end_day = date(y2, m2, d2)

    if end_day < start_day:
        if match.group("m2"):
            end_day = date(y2 + 1, m2, d2)
        else:
            next_month = m1 + 1
            next_year = y1
            if next_month == 13:
                next_month = 1
                next_year += 1
            end_day = date(next_year, next_month, d2)

    start_dt = datetime.combine(start_day, time(0, 0, 0))
    end_dt = datetime.combine(end_day, time(23, 59, 59))
    return start_dt.isoformat(), end_dt.isoformat()


def clean_name(name: str | None) -> str | None:
    if not name:
        return None
    name = normalize_space(name)
    name = CATEGORY_PREFIX_RE.sub("", name).strip(" -")
    return name or None


def parse_name_and_city_from_text(raw_text: str) -> tuple[str | None, str | None, str | None]:
    text = normalize_space(raw_text)
    match = DATE_RANGE_RE.search(text)
    if not match:
        return None, None, None

    before = normalize_space(text[: match.start()])
    after = normalize_space(text[match.end() :])
    after = MODE_RE.sub("", after).strip(" -")

    city = normalize_city(after) if after else None
    name = clean_name(before)

    if name and city:
        name_words = [w for w in re.split(r"[\s,]+", name) if w]
        city_words = [w for w in re.split(r"[\s,]+", city) if w]
        if city_words and len(name_words) > len(city_words):
            if [w.casefold() for w in name_words[: len(city_words)]] == [
                w.casefold() for w in city_words
            ]:
                stripped = " ".join(name_words[len(city_words) :]).strip(" -,")
                if stripped:
                    name = stripped

    return name, city, match.group(0)


def parse_anchor_record(anchor: Any, href: str, season_year: int) -> EventRecord | None:
    strings = [normalize_space(s) for s in anchor.stripped_strings if normalize_space(s)]
    text = normalize_space(" ".join(strings))
    if not DATE_RANGE_RE.search(text):
        return None

    date_text = None
    city = None
    name = None

    date_idx = None
    for idx, token in enumerate(strings):
        token_match = DATE_RANGE_RE.search(token)
        if token_match:
            date_idx = idx
            date_text = token_match.group(0)
            break

    if date_idx is not None:
        before_tokens = [CATEGORY_PREFIX_RE.sub("", t).strip() for t in strings[:date_idx]]
        before_tokens = [t for t in before_tokens if t]
        after_tokens = [
            MODE_RE.sub("", t).strip(" -")
            for t in strings[date_idx + 1 :]
            if not MODE_RE.fullmatch(t.strip())
        ]
        after_tokens = [t for t in after_tokens if t]

        if before_tokens:
            name = before_tokens[-1]
        if after_tokens:
            city = after_tokens[0]

    if not name or not city or not date_text:
        fallback_name, fallback_city, fallback_date = parse_name_and_city_from_text(text)
        name = name or fallback_name
        city = city or fallback_city
        date_text = date_text or fallback_date

    if not name or not date_text:
        return None

    start_datetime, end_datetime = parse_date_range(date_text, season_year)
    return EventRecord(
        name=name,
        city=normalize_city(city),
        start_datetime=start_datetime,
        end_datetime=end_datetime,
        total_prize=None,
        website=href,
    )


def scrape_mlh_events(
    session: requests.Session,
    season_url: str,
    season_year: int,
    timeout: float,
) -> list[EventRecord]:
    response = session.get(season_url, timeout=timeout)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")

    events: list[EventRecord] = []
    seen: set[tuple[str, str | None, str | None, str]] = set()

    for anchor in soup.find_all("a", href=True):
        href = urljoin(season_url, anchor["href"]).strip()
        if not href.startswith(("http://", "https://")):
            continue

        record = parse_anchor_record(anchor, href, season_year)
        if not record:
            continue

        key = (
            record.name.casefold(),
            (record.city or "").casefold(),
            record.start_datetime,
            record.website,
        )
        if key in seen:
            continue
        seen.add(key)
        events.append(record)

    events.sort(key=lambda event: (event.start_datetime or "", event.name.casefold()))
    return events


def iter_json_objects(value: Any) -> Iterator[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from iter_json_objects(item)
    elif isinstance(value, list):
        for item in value:
            yield from iter_json_objects(item)


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return date_parser.parse(value)
    except (ValueError, TypeError, OverflowError):
        return None


def normalize_datetime_for_compare(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def extract_event_dates_from_jsonld(soup: BeautifulSoup) -> tuple[str | None, str | None]:
    candidates: list[tuple[datetime, datetime]] = []
    for tag in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = (tag.string or tag.get_text() or "").strip()
        if not raw:
            continue
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue

        for obj in iter_json_objects(payload):
            if "startDate" not in obj:
                continue
            start = parse_iso_datetime(obj.get("startDate"))
            end = parse_iso_datetime(obj.get("endDate")) if obj.get("endDate") else None
            if start and end:
                candidates.append((start, end))

    if not candidates:
        return None, None
    start, end = min(candidates, key=lambda pair: normalize_datetime_for_compare(pair[0]))
    return start.isoformat(), end.isoformat()


def expand_suffix(number: float, suffix: str | None) -> float:
    if not suffix:
        return number
    if suffix.lower() == "k":
        return number * 1_000
    if suffix.lower() == "m":
        return number * 1_000_000
    return number


def parse_numeric_amount(raw: str) -> float:
    return float(raw.replace(",", ""))


def extract_currency_amounts(text: str) -> list[tuple[str, float]]:
    amounts: list[tuple[str, float]] = []
    for match in SYMBOL_AMOUNT_RE.finditer(text):
        symbol = match.group("symbol")
        number = expand_suffix(parse_numeric_amount(match.group("number")), match.group("suffix"))
        currency = SYMBOL_TO_CODE.get(symbol, symbol)
        amounts.append((currency, number))
    for match in CODE_AMOUNT_RE.finditer(text):
        code = match.group("code").upper()
        number = expand_suffix(parse_numeric_amount(match.group("number")), match.group("suffix"))
        amounts.append((code, number))
    return amounts


def format_amount(currency: str, amount: float) -> str:
    rounded = round(amount)
    symbols = {v: k for k, v in SYMBOL_TO_CODE.items()}
    symbol = symbols.get(currency)
    if symbol:
        return f"{symbol}{rounded:,.0f}"
    return f"{currency} {rounded:,.0f}"


def score_prize_line(line: str) -> int:
    lowered = line.lower()
    score = 0
    if "prize" in lowered:
        score += 1
    if "total prize" in lowered or "prize pool" in lowered:
        score += 3
    if "win" in lowered:
        score += 1
    if "sponsor" in lowered or "registration" in lowered:
        score -= 1
    return score


def extract_total_prize(text: str) -> str | None:
    best: tuple[int, str] | None = None
    lines = [normalize_space(line) for line in re.split(r"[\n\r]+", text)]
    lines = [line for line in lines if line]

    for line in lines:
        if "prize" not in line.lower():
            continue
        amounts = extract_currency_amounts(line)
        if not amounts:
            continue
        score = score_prize_line(line)
        grouped: dict[str, list[float]] = {}
        for currency, amount in amounts:
            grouped.setdefault(currency, []).append(amount)

        for currency, values in grouped.items():
            total = sum(values) if len(values) > 1 and re.search(r"\b(?:1st|2nd|3rd|track)\b", line, re.I) else max(values)
            candidate = format_amount(currency, total)
            rank = score * 1_000_000 + int(total)
            if best is None or rank > best[0]:
                best = (rank, candidate)

    return best[1] if best else None


def should_override_dates(start_datetime: str | None, end_datetime: str | None) -> bool:
    if not start_datetime or not end_datetime:
        return True
    try:
        start = date_parser.parse(start_datetime)
        end = date_parser.parse(end_datetime)
    except (ValueError, TypeError, OverflowError):
        return True
    return start.time() == time(0, 0, 0) and end.time() == time(23, 59, 59)


def enrich_record(record: EventRecord, timeout: float) -> EventRecord:
    session = build_session()
    try:
        response = session.get(record.website, timeout=timeout)
        response.raise_for_status()
    except requests.RequestException:
        return record

    try:
        soup = BeautifulSoup(response.text, "html.parser")

        site_start, site_end = extract_event_dates_from_jsonld(soup)
        if site_start and site_end and should_override_dates(record.start_datetime, record.end_datetime):
            record.start_datetime = site_start
            record.end_datetime = site_end

        if not record.total_prize:
            visible_text = soup.get_text(separator="\n", strip=True)
            record.total_prize = extract_total_prize(visible_text)
        return record
    finally:
        session.close()


def output_records(records: Iterable[EventRecord], output_path: str, output_format: str) -> None:
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
    parser = argparse.ArgumentParser(
        description="Scrape MLH 2026 events and optionally enrich from event websites."
    )
    parser.add_argument("--season-url", default=DEFAULT_URL, help="MLH season events page URL")
    parser.add_argument("--season-year", default=2026, type=int, help="Season year to infer dates")
    parser.add_argument("--output", default="mlh_2026_events.json", help="Output file path")
    parser.add_argument(
        "--format",
        choices=("json", "csv"),
        default=None,
        help="Output format (defaults from output extension)",
    )
    parser.add_argument(
        "--no-enrich",
        action="store_true",
        help="Skip visiting each event website for prize/date enrichment.",
    )
    parser.add_argument("--workers", default=8, type=int, help="Concurrent website enrichment workers")
    parser.add_argument("--timeout", default=20.0, type=float, help="HTTP timeout in seconds")
    parser.add_argument("--max-events", type=int, default=None, help="Optional cap on number of events")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    log("Starting MLH scraper")
    output_format = infer_format(args.output, args.format)
    session = build_session()
    log(f"Fetching MLH season page: {args.season_url}")

    try:
        records = scrape_mlh_events(
            session=session,
            season_url=args.season_url,
            season_year=args.season_year,
            timeout=args.timeout,
        )
    except requests.RequestException as exc:
        print(f"Failed to scrape MLH events page: {exc}", file=sys.stderr)
        session.close()
        return 1
    session.close()
    log(f"Fetched {len(records)} events from MLH")

    if args.max_events is not None:
        records = records[: args.max_events]
        log(f"Applied max-events limit: {len(records)} records retained")

    if not args.no_enrich and records:
        log(f"Enriching {len(records)} MLH events from event websites with {args.workers} workers")
        enriched: list[EventRecord] = []
        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            futures = [pool.submit(enrich_record, record, args.timeout) for record in records]
            for future in as_completed(futures):
                enriched.append(future.result())
        records = sorted(enriched, key=lambda item: (item.start_datetime or "", item.name.casefold()))
        log(f"Enrichment completed for {len(records)} MLH events")

    output_records(records, args.output, output_format)
    print(f"Wrote {len(records)} events to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
