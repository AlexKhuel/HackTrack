#!/usr/bin/env python3
"""Scrape Devfolio hackathons into a normalized dataset.

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
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, time, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin, urlparse, urlunparse

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

LISTING_URL = "https://devfolio.co/hackathons"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)

SPACE_RE = re.compile(r"\s+")
MONTH_RE = re.compile(
    r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|"
    r"Nov(?:ember)?|Dec(?:ember)?)\b",
    re.IGNORECASE,
)
FULL_YEAR_RE = re.compile(r"\b\d{4}\b")
SHORT_YEAR_RE = re.compile(r"'(\d{2})\b")
TIME_RE = re.compile(r"\b\d{1,2}:\d{2}\s*(?:[AaPp]\.?[Mm]\.?)?\b")
ISOISH_SINGLE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+\-Zz]+)?$")

PRIZE_NUMBER_RE = re.compile(
    r"(?P<symbol>[$€£₹¥])\s*(?P<number>\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|\d+(?:\.\d+)?)"
    r"\s*(?P<suffix>[kKmM])?\+?"
)

NOISE_LOCATION_TOKENS = {
    "live now",
    "open",
    "upcoming",
    "past",
    "applications closed",
    "happening",
    "runs from",
    "offline",
    "in-person",
}


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


def log(message: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}] {message}")


def normalize_space(text: str | None) -> str:
    if text is None:
        return ""
    return SPACE_RE.sub(" ", text).strip()


def canonicalize_event_url(raw_url: str) -> str | None:
    href = normalize_space(raw_url)
    if not href:
        return None

    absolute = urljoin(LISTING_URL, href)
    parsed = urlparse(absolute)
    host = parsed.netloc.lower().strip()
    if not host.endswith(".devfolio.co"):
        return None

    if host.startswith("www."):
        host = host[4:]
    if host == "devfolio.co":
        return None

    return urlunparse(("https", host, "/", "", "", ""))


def extract_event_urls(listing_html: str) -> list[str]:
    soup = BeautifulSoup(listing_html, "html.parser")
    discovered: list[str] = []
    seen: set[str] = set()

    for anchor in soup.find_all("a", href=True):
        url = canonicalize_event_url(anchor.get("href", ""))
        if not url:
            continue
        key = url.casefold()
        if key in seen:
            continue
        seen.add(key)
        discovered.append(url)

    if discovered:
        return discovered

    # Fallback for HTML variants where links are embedded in scripts.
    for host in re.findall(r"https?://([a-z0-9-]+\.devfolio\.co)", listing_html, flags=re.IGNORECASE):
        url = canonicalize_event_url(f"https://{host}")
        if not url:
            continue
        key = url.casefold()
        if key in seen:
            continue
        seen.add(key)
        discovered.append(url)
    return discovered


def has_month(text: str) -> bool:
    return bool(MONTH_RE.search(text))


def has_year(text: str) -> bool:
    return bool(FULL_YEAR_RE.search(text) or SHORT_YEAR_RE.search(text))


def month_token(text: str) -> str | None:
    match = MONTH_RE.search(text)
    return match.group(0) if match else None


def has_time(text: str) -> bool:
    return bool(TIME_RE.search(text))


def extract_year_token(text: str) -> str | None:
    full = FULL_YEAR_RE.search(text)
    if full:
        return full.group(0)
    short = SHORT_YEAR_RE.search(text)
    if short:
        return f"20{short.group(1)}"
    return None


def parse_date_range(value: str | None) -> tuple[str | None, str | None]:
    if not value:
        return None, None

    period = normalize_space(value.replace("–", "-").replace("—", "-"))
    period = re.sub(r"\bDate\b,?\s*", "", period, flags=re.IGNORECASE)
    if not period:
        return None, None

    if "-" not in period or ISOISH_SINGLE_RE.fullmatch(period):
        try:
            parsed = date_parser.parse(period, fuzzy=True)
        except (ValueError, TypeError, OverflowError):
            return None, None

        if has_time(period):
            return parsed.isoformat(), parsed.isoformat()

        start = datetime.combine(parsed.date(), time(0, 0, 0))
        end = datetime.combine(parsed.date(), time(23, 59, 59))
        return start.isoformat(), end.isoformat()

    left_raw, right_raw = [normalize_space(part) for part in period.split("-", 1)]
    if not left_raw or not right_raw:
        return None, None

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
                inferred_year = extract_year_token(right_raw)
                left = date_parser.parse(f"{left_raw}, {inferred_year}", fuzzy=True) if inferred_year else date_parser.parse(left_raw, fuzzy=True)
            else:
                left = date_parser.parse(left_raw, fuzzy=True)

            left_month = month_token(left_raw)
            right_augmented = f"{left_month} {right_raw}" if left_month else right_raw
            if left_has_year and not right_has_year:
                right_augmented = f"{right_augmented}, {left.year}"
            right = date_parser.parse(right_augmented, fuzzy=True)
        elif not left_has_month and right_has_month:
            if left_has_year and not right_has_year:
                inferred_year = extract_year_token(left_raw)
                right = date_parser.parse(f"{right_raw}, {inferred_year}", fuzzy=True) if inferred_year else date_parser.parse(right_raw, fuzzy=True)
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

    start = left if has_time(left_raw) else datetime.combine(left.date(), time(0, 0, 0))
    end = right if has_time(right_raw) else datetime.combine(right.date(), time(23, 59, 59))

    if end < start:
        start, end = end, start

    return start.isoformat(), end.isoformat()


def extract_text_lines(soup: BeautifulSoup) -> list[str]:
    lines: list[str] = []
    seen: set[str] = set()
    for raw_line in soup.get_text(separator="\n").splitlines():
        line = normalize_space(raw_line)
        if not line:
            continue
        key = line.casefold()
        if key in seen:
            continue
        seen.add(key)
        lines.append(line)
    return lines


def clean_title(text: str | None) -> str | None:
    title = normalize_space(text)
    if not title:
        return None
    title = re.sub(r"\s*\|\s*Devfolio.*$", "", title, flags=re.IGNORECASE)
    title = normalize_space(title)
    return title or None


def extract_name(soup: BeautifulSoup, lines: list[str], website: str) -> str | None:
    for heading in soup.find_all("h1"):
        candidate = clean_title(heading.get_text(" ", strip=True))
        if candidate and candidate.casefold() not in {"overview", "prizes", "lineup", "schedule"}:
            return candidate

    og_title = soup.find("meta", attrs={"property": "og:title"})
    if og_title and og_title.get("content"):
        candidate = clean_title(str(og_title.get("content")))
        if candidate:
            return candidate

    if soup.title and soup.title.string:
        candidate = clean_title(soup.title.string)
        if candidate:
            return candidate

    host = urlparse(website).netloc
    if host.endswith(".devfolio.co"):
        return host.split(".", 1)[0].replace("-", " ").title()

    return lines[0] if lines else None


def extract_city(lines: list[str]) -> str | None:
    for idx, line in enumerate(lines):
        lowered = line.casefold()
        if lowered not in {"happening", "location"}:
            continue

        for look_ahead in range(1, 5):
            next_idx = idx + look_ahead
            if next_idx >= len(lines):
                break
            candidate = lines[next_idx]
            candidate_lower = candidate.casefold()
            if candidate_lower in NOISE_LOCATION_TOKENS:
                continue
            if "online" in candidate_lower or "virtual" in candidate_lower:
                return "Online"
            return candidate

    if any(line.casefold() in {"online", "virtual"} for line in lines):
        return "Online"
    return None


def extract_runs_from_text(lines: list[str]) -> str | None:
    for idx, line in enumerate(lines):
        lowered = line.casefold()
        if "runs from" not in lowered:
            continue

        inline = normalize_space(re.sub(r"(?i)^.*runs from[:\s-]*", "", line))
        if inline and inline.casefold() != "runs from":
            return inline

        for look_ahead in range(1, 5):
            next_idx = idx + look_ahead
            if next_idx >= len(lines):
                break
            candidate = lines[next_idx]
            candidate_lower = candidate.casefold()
            if candidate_lower in NOISE_LOCATION_TOKENS:
                continue
            return candidate

    for line in lines[:150]:
        if has_month(line) and "-" in line:
            return line
    return None


def parse_amount_value(match: re.Match[str]) -> float:
    value = float(match.group("number").replace(",", ""))
    suffix = (match.group("suffix") or "").lower()
    if suffix == "k":
        value *= 1_000
    elif suffix == "m":
        value *= 1_000_000
    return value


def extract_prize(lines: list[str]) -> str | None:
    best: tuple[float, str] | None = None
    boosts = (
        "available in prizes",
        "prize pool",
        "prizes worth",
        "total prize",
        "total prizes",
        "rewards worth",
        "grand prize",
    )

    for idx, line in enumerate(lines):
        context = line
        if idx + 1 < len(lines):
            context = f"{line} {lines[idx + 1]}"

        lowered = context.casefold()
        for match in PRIZE_NUMBER_RE.finditer(context):
            amount = parse_amount_value(match)
            if amount <= 0:
                continue

            score = amount
            if any(phrase in lowered for phrase in boosts):
                score += 1_000_000
            if "credit" in lowered:
                score -= amount * 0.5
            if "entry fee" in lowered or "registration fee" in lowered:
                score -= amount

            candidate = f"{match.group('symbol')}{amount:,.0f}"
            if best is None or score > best[0]:
                best = (score, candidate)

    return best[1] if best else None


def parse_event_page(html_text: str, website: str) -> HackathonRecord | None:
    soup = BeautifulSoup(html_text, "html.parser")
    lines = extract_text_lines(soup)
    name = extract_name(soup, lines, website)
    if not name:
        return None

    city = extract_city(lines)
    runs_from = extract_runs_from_text(lines)
    start_datetime, end_datetime = parse_date_range(runs_from)
    total_prize = extract_prize(lines)

    return HackathonRecord(
        name=name,
        city=city,
        start_datetime=start_datetime,
        end_datetime=end_datetime,
        total_prize=total_prize,
        website=website,
    )


def fetch_listing_urls(session: requests.Session, listing_url: str, timeout: float) -> list[str]:
    response = session.get(listing_url, timeout=timeout)
    response.raise_for_status()
    return extract_event_urls(response.text)


def fetch_hackathons(urls: list[str], timeout: float, workers: int) -> list[HackathonRecord]:
    records_by_index: dict[int, HackathonRecord] = {}

    def worker(url: str) -> HackathonRecord | None:
        local_session = build_session()
        try:
            response = local_session.get(url, timeout=timeout)
            response.raise_for_status()
            return parse_event_page(response.text, url)
        except requests.RequestException as exc:
            print(f"Warning: failed to fetch {url}: {exc}", file=sys.stderr)
            return None
        finally:
            local_session.close()

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        future_by_idx = {pool.submit(worker, url): idx for idx, url in enumerate(urls)}
        for future in as_completed(future_by_idx):
            idx = future_by_idx[future]
            try:
                record = future.result()
            except Exception as exc:  # pragma: no cover - defensive, individual failure should not abort run
                print(f"Warning: unexpected parse error for {urls[idx]}: {exc}", file=sys.stderr)
                continue
            if record is not None:
                records_by_index[idx] = record

    return [records_by_index[idx] for idx in sorted(records_by_index)]


def output_records(records: Iterable[HackathonRecord], output_path: str, output_format: str) -> None:
    out_path = Path(output_path).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    rows = [asdict(record) for record in records]

    if output_format == "json":
        with out_path.open("w", encoding="utf-8") as file_obj:
            json.dump(rows, file_obj, indent=2, ensure_ascii=False)
        return

    if output_format == "csv":
        fields = ["name", "city", "start_datetime", "end_datetime", "total_prize", "website"]
        with out_path.open("w", newline="", encoding="utf-8") as file_obj:
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
    parser = argparse.ArgumentParser(description="Scrape Devfolio hackathons into a normalized dataset.")
    parser.add_argument("--output", default="devfolio_hackathons.json", help="Output file path")
    parser.add_argument(
        "--format",
        choices=("json", "csv"),
        default=None,
        help="Output format (defaults from output extension)",
    )
    parser.add_argument("--listing-url", default=LISTING_URL, help="Devfolio hackathons listing URL")
    parser.add_argument("--max-hackathons", type=int, default=None, help="Optional cap on number of events")
    parser.add_argument("--timeout", type=float, default=20.0, help="HTTP timeout in seconds")
    parser.add_argument("--workers", type=int, default=8, help="Concurrent workers for event page fetches")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    log("Starting Devfolio scraper")

    if args.max_hackathons is not None and args.max_hackathons <= 0:
        print("--max-hackathons must be a positive integer.", file=sys.stderr)
        return 2
    if args.workers <= 0:
        print("--workers must be a positive integer.", file=sys.stderr)
        return 2
    if args.timeout <= 0:
        print("--timeout must be a positive number.", file=sys.stderr)
        return 2

    output_format = infer_format(args.output, args.format)
    log(f"Fetching listing page: {args.listing_url}")

    session = build_session()
    try:
        urls = fetch_listing_urls(session, args.listing_url, timeout=args.timeout)
    except requests.RequestException as exc:
        print(f"Failed to fetch Devfolio listing page: {exc}", file=sys.stderr)
        session.close()
        return 1
    session.close()
    log(f"Discovered {len(urls)} Devfolio event URLs")

    if args.max_hackathons is not None:
        urls = urls[: args.max_hackathons]
        log(f"Applying max-hackathons limit: {len(urls)} URLs retained")

    if not urls:
        print("No Devfolio event URLs found on listing page.", file=sys.stderr)
        return 1

    log(f"Fetching and parsing {len(urls)} Devfolio event pages with {args.workers} workers")
    records = fetch_hackathons(urls, timeout=args.timeout, workers=args.workers)
    records.sort(key=lambda row: ((row.start_datetime or ""), row.name.casefold()))
    log(f"Parsed {len(records)} Devfolio hackathon records")

    output_records(records, args.output, output_format)
    print(f"Wrote {len(records)} hackathons to {args.output} (from {len(urls)} Devfolio URLs)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
