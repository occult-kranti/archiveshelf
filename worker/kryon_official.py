#!/usr/bin/env python3
"""Resolve indexed Kryon videos to creator-hosted official MP3 downloads."""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import dataclasses
import difflib
import json
from pathlib import Path
import re
from typing import Any
from urllib.parse import urljoin

from channel_inventory import FIELDS, fetch, request_session


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def similarity(left: str, right: str) -> float:
    return difflib.SequenceMatcher(None, normalize(left), normalize(right)).ratio()


def index_events(session, years: list[int]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for year in years:
        index_url = f"https://www.kryon.com/freeAudio_folder/mobile_pages/{year}_freeAudio_m.html"
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(fetch(session, index_url), "html.parser")
        for anchor in soup.find_all("a", href=True):
            href = anchor["href"]
            if "cartprodimages" not in href or "download_" not in href:
                continue
            page = urljoin(index_url, href)
            label = anchor.get_text(" ", strip=True)
            events.append({"year": year, "page": page, "label": label})
    return list({event["page"]: event for event in events}.values())


def enrich_event(session, event: dict[str, Any]) -> dict[str, Any]:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(fetch(session, event["page"]), "html.parser")
    media: list[dict[str, Any]] = []
    for anchor in soup.find_all("a", href=True):
        href = anchor["href"]
        if ".mp3" not in href.lower():
            continue
        row = anchor.find_parent("tr")
        context = (row or anchor.parent).get_text(" ", strip=True)
        media.append({"url": urljoin(event["page"], href), "context": context, "filename": href.rsplit("/", 1)[-1]})
    return {**event, "media": media}


def best_page(record: dict[str, str], events: list[dict[str, Any]]) -> tuple[dict[str, Any], float]:
    scope_year = int(record["scope"].rsplit("_", 1)[-1])
    location = record.get("location") or ""
    location_tokens = {token for token in normalize(location).split(" ") if len(token) > 2}
    candidates = [event for event in events if event["year"] == scope_year]
    scored = []
    for event in candidates:
        event_text = normalize(event["label"] + " " + event["page"])
        location_score = max(similarity(location, event["label"]), similarity(location, event["page"]))
        matched_tokens = {token for token in location_tokens if token in event_text}
        if matched_tokens:
            location_score += 0.35
        scored.append((location_score, event))
    scored.sort(key=lambda item: item[0], reverse=True)
    return (scored[0][1], scored[0][0]) if scored else ({}, 0.0)


def best_media(record: dict[str, str], event: dict[str, Any]) -> tuple[dict[str, Any] | None, float]:
    title = record.get("title") or ""
    best: dict[str, Any] | None = None
    best_score = 0.0
    letter_match = re.fullmatch(r"The Letter\s+([A-Z])", title.strip(), re.I)
    for media in event.get("media", []):
        if letter_match:
            filename_normalized = normalize(media["filename"])
            if not re.search(rf"\bletter\s+{letter_match.group(1).lower()}\b", filename_normalized):
                continue
        context = media["context"] + " " + media["filename"]
        title_score = max(similarity(title, context), similarity(title, media["filename"]))
        if normalize(title) and normalize(title) in normalize(context):
            title_score += 0.5
        if title_score > best_score:
            best, best_score = media, title_score
    return best, best_score


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--summary", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=1)
    args = parser.parse_args()
    with args.input.open(encoding="utf-8", newline="") as handle:
        records = list(csv.DictReader(handle))
    session = request_session()
    events = index_events(session, sorted({int(record["scope"].rsplit("_", 1)[-1]) for record in records}))
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        enriched = list(pool.map(lambda event: enrich_event(session, event), events))
    output_rows: list[dict[str, Any]] = []
    matched = 0
    unmatched: list[str] = []
    for record in records:
        event, location_score = best_page(record, enriched)
        media, title_score = best_media(record, event) if event else (None, 0.0)
        score = location_score + title_score
        accepted = bool(media and location_score >= 0.60 and title_score >= 0.50)
        if accepted:
            matched += 1
        else:
            unmatched.append(record["external_id"])
        output_rows.append({
            **record,
            "media_url": media["url"] if accepted and media else "",
            "official_page": event.get("page", ""),
            "media_status": "official_direct_mp3" if accepted else "unavailable",
            "match_confidence": f"{score:.3f}",
        })
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as handle:
        fields = list(FIELDS) + ["media_url", "official_page", "media_status", "match_confidence"]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(output_rows)
    summary = {
        "totalIndexed": len(records),
        "matchedOfficialMedia": matched,
        "unavailableOfficialMedia": len(records) - matched,
        "unmatchedIds": unmatched,
        "officialEventPages": len(enriched),
        "matchingRule": "Same scope year + location/token similarity >= 0.60 + title/context similarity >= 0.50; serial fetching avoids session races",
    }
    args.summary.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    for record in output_rows[:5]:
        print(json.dumps({key: record[key] for key in ("external_id", "title", "media_url", "match_confidence", "media_status")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
