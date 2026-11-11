#!/usr/bin/env python3
"""Convert official RSS/Atom podcast feeds into resumable archive manifests."""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
from typing import Any

from bs4 import BeautifulSoup

from channel_inventory import FIELDS, fetch, request_session


def timestamp(item) -> str | None:
    for name in ("pubDate", "published", "updated", "date"):
        tag = item.find(name)
        if not tag:
            continue
        value = tag.get_text(" ", strip=True)
        for fmt in ("%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S %Z", "%Y-%m-%dT%H:%M:%SZ"):
            try:
                parsed = dt.datetime.strptime(value, fmt)
                return parsed.date().isoformat()
            except ValueError:
                continue
    return None


def duration(item) -> float | None:
    tag = item.find("duration")
    if not tag:
        return None
    value = tag.get_text(" ", strip=True)
    try:
        parts = [float(part) for part in value.split(":")]
        seconds = 0.0
        for part in parts:
            seconds = seconds * 60 + part
        return seconds
    except ValueError:
        try:
            return float(value)
        except ValueError:
            return None


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def parse_feed(feed: dict[str, Any], session) -> dict[str, Any]:
    try:
        xml = fetch(session, feed["feedUrl"], timeout=45)
    except Exception as error:
        return {"channel": feed["channel"], "feedUrl": feed["feedUrl"], "episodes": 0, "records": [], "error": str(error)[:800]}
    soup = BeautifulSoup(xml, "xml")
    items = soup.find_all("item")
    records: list[dict[str, Any]] = []
    for index, item in enumerate(items, 1):
        enclosure = item.find("enclosure")
        if not enclosure or not enclosure.get("url"):
            continue
        title = item.title.get_text(" ", strip=True) if item.title else f"Episode {index}"
        guid = item.guid.get_text(" ", strip=True) if item.guid else enclosure["url"]
        link = item.link.get_text(" ", strip=True) if item.link else guid
        description_tag = item.find("summary") or item.find("description") or item.find("content:encoded")
        record = {field: "" for field in FIELDS}
        record.update({
            "channel": feed["channel"],
            "scope": "podcast_feed",
            "external_id": hashlib.sha256(guid.encode()).hexdigest()[:16],
            "source_item_number": str(index),
            "title": title,
            "webpage_url": link,
            "source_url": feed["feedUrl"],
            "upload_date": timestamp(item),
            "duration_seconds": duration(item),
            "description": description_tag.get_text(" ", strip=True) if description_tag else None,
            "media_url": enclosure["url"],
            "official_page": link,
            "media_status": "official_direct_mp3",
            "match_confidence": "1.000",
            "metadata_status": "podcast_feed",
        })
        records.append(record)
    return {"channel": feed["channel"], "feedUrl": feed["feedUrl"], "episodes": len(records), "records": records}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    feeds = json.loads(args.config.read_text(encoding="utf-8"))["feeds"]
    session = request_session()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda feed: parse_feed(feed, session), feeds))
    args.output.mkdir(parents=True, exist_ok=True)
    summary = []
    for result in results:
        slug = slugify(result["channel"])
        folder = args.output / slug
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "videos.json").write_text(json.dumps(result["records"], indent=2, ensure_ascii=False), encoding="utf-8")
        summary.append({"channel": result["channel"], "feedUrl": result["feedUrl"], "episodes": result["episodes"], "path": f"{slug}/videos.csv", "error": result.get("error")})
        import csv
        fields = list(FIELDS) + ["media_url", "official_page", "media_status", "match_confidence"]
        with (folder / "videos.csv").open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fields)
            writer.writeheader()
            writer.writerows(result["records"])
    all_records = [record for result in results for record in result["records"]]
    with (args.output / "podcast-episodes.csv").open("w", encoding="utf-8", newline="") as handle:
        fields = list(FIELDS) + ["media_url", "official_page", "media_status", "match_confidence"]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(all_records)
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    lines = ["# Official podcast feeds\n", "| Channel | Feed | Episodes | Error |", "|---|---|---|---|"]
    for result in results:
        lines.append(f"| {result['channel']} | {result['feedUrl']} | {result['episodes']} | {result.get('error', '')} |")
    (args.output / "FEEDS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"feeds": len(results), "episodes": sum(result["episodes"] for result in results)}, indent=2))


if __name__ == "__main__":
    main()
