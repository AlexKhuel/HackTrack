#!/usr/bin/env python3
"""Run scrapers + cleaner, then call JS loader to insert into Supabase Postgres."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent


def log(message: str) -> None:
    print(message, flush=True)


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def run_command(cmd: list[str], cwd: Path) -> None:
    log(f"$ {' '.join(cmd)}")
    subprocess.run(cmd, cwd=str(cwd), check=True)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run MLH + Devpost scrapers, clean merged data, and load into Supabase Postgres via JS."
    )
    parser.add_argument("--output-dir", default=str(SCRIPT_DIR / "output"), help="Pipeline output directory")
    parser.add_argument(
        "--cleaned-output",
        default=None,
        help="Path for cleaned events JSON (default: <output-dir>/cleaned_events.json)",
    )

    parser.add_argument("--mlh-input", default=None, help="Use existing MLH JSON/CSV instead of scraping")
    parser.add_argument("--devpost-input", default=None, help="Use existing Devpost JSON/CSV instead of scraping")
    parser.add_argument("--skip-mlh", action="store_true", help="Skip MLH source")
    parser.add_argument("--skip-devpost", action="store_true", help="Skip Devpost source")

    parser.add_argument("--mlh-no-enrich", action="store_true", help="Disable MLH website enrichment")
    parser.add_argument("--devpost-enrich-missing-prize", action="store_true", help="Enable Devpost prize enrichment")
    parser.add_argument("--devpost-statuses", default="open,upcoming", help="Devpost statuses")
    parser.add_argument("--mlh-max-events", type=int, default=None, help="Optional MLH event cap")
    parser.add_argument(
        "--devpost-max-hackathons", type=int, default=None, help="Optional Devpost record cap"
    )

    parser.add_argument("--table", default="events", help="Target table name")
    parser.add_argument("--db-url", default=None, help="Postgres connection URL override")
    parser.add_argument("--batch-size", type=int, default=500, help="Insert batch size")
    parser.add_argument("--replace-existing", action="store_true", help="TRUNCATE table before inserting")
    parser.add_argument("--dry-run", action="store_true", help="Run pipeline but skip DB write")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)

    load_env_file(REPO_ROOT / ".env")
    load_env_file(SCRIPT_DIR / ".env")

    if args.table == "events" and os.getenv("EVENTS_TABLE"):
        args.table = str(os.getenv("EVENTS_TABLE"))

    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    cleaned_output = (
        Path(args.cleaned_output).expanduser().resolve()
        if args.cleaned_output
        else (output_dir / "cleaned_events.json")
    )

    mlh_input: Path | None = None
    devpost_input: Path | None = None

    if not args.skip_mlh:
        if args.mlh_input:
            mlh_input = Path(args.mlh_input).expanduser().resolve()
        else:
            mlh_output = output_dir / "mlh_2026_events.json"
            cmd = [
                sys.executable,
                str(REPO_ROOT / "MLH-Scraper" / "scrape_mlh_2026.py"),
                "--output",
                str(mlh_output),
            ]
            if args.mlh_no_enrich:
                cmd.append("--no-enrich")
            if args.mlh_max_events is not None:
                cmd.extend(["--max-events", str(args.mlh_max_events)])
            run_command(cmd, REPO_ROOT)
            mlh_input = mlh_output

    if not args.skip_devpost:
        if args.devpost_input:
            devpost_input = Path(args.devpost_input).expanduser().resolve()
        else:
            devpost_output = output_dir / "devpost_hackathons.json"
            cmd = [
                sys.executable,
                str(REPO_ROOT / "Devpost-Scraper" / "scrape_devpost.py"),
                "--output",
                str(devpost_output),
                "--statuses",
                args.devpost_statuses,
            ]
            if args.devpost_enrich_missing_prize:
                cmd.append("--enrich-missing-prize")
            if args.devpost_max_hackathons is not None:
                cmd.extend(["--max-hackathons", str(args.devpost_max_hackathons)])
            run_command(cmd, REPO_ROOT)
            devpost_input = devpost_output

    if mlh_input is None and devpost_input is None:
        log("No data sources selected. Use default settings or provide --mlh-input/--devpost-input.")
        return 2

    clean_cmd = [
        sys.executable,
        str(REPO_ROOT / "Parse-Scraped-Data" / "clean_events.py"),
        "--output",
        str(cleaned_output),
        "--format",
        "json",
    ]
    if mlh_input:
        clean_cmd.extend(["--mlh", str(mlh_input)])
    if devpost_input:
        clean_cmd.extend(["--devpost", str(devpost_input)])
    run_command(clean_cmd, REPO_ROOT)

    if shutil.which("node") is None:
        log("Missing dependency: node. Install Node.js to run Supabase-Pipeline/load_to_supabase.js")
        return 2

    load_cmd = [
        "node",
        str(SCRIPT_DIR / "load_to_supabase.js"),
        "--input",
        str(cleaned_output),
        "--table",
        args.table,
        "--batch-size",
        str(args.batch_size),
    ]
    if args.db_url:
        load_cmd.extend(["--db-url", args.db_url])
    if args.replace_existing:
        load_cmd.append("--replace-existing")
    if args.dry_run:
        load_cmd.append("--dry-run")

    run_command(load_cmd, REPO_ROOT)
    log(f"Cleaned output: {cleaned_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
