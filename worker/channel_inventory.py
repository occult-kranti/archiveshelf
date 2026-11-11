#!/usr/bin/env python3
"""Multi-source channel inventories with explicit coverage verification.

No proxies, credential harvesting, anti-bot bypasses, or private-source access.
YouTube and creator-index adapters share one CSV/JSON/Markdown export schema.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import csv
import dataclasses
import datetime as dt
import json
from pathlib import Path
import re
import time
from typing import Any, Iterable
from urllib.parse import urlsplit

import requests
from bs4 import BeautifulSoup
import yt_dlp

from archiveshelf import safe_name


MONTHS = {name: index for index, name in enumerate(
    ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"), 1
)}
MONTH_PATTERN = r"JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEPT?(?:EMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?"
FIELDS = (
    "channel", "scope", "external_id", "source_item_number", "title", "webpage_url", "source_url",
    "upload_date", "location", "duration_seconds", "view_count", "like_count",
    "comment_count", "description", "language", "categories", "tags",
    "availability", "live_status", "subtitle_languages", "automatic_caption_languages",
    "transcript_path", "metadata_status", "error",
)


@dataclasses.dataclass
class Video:
    channel: str
    scope: str
    external_id: str
    title: str
    webpage_url: str
    source_url: str
    source_item_number: str | None = None
    upload_date: str | None = None
    location: str | None = None
    duration_seconds: float | None = None
    view_count: int | None = None
    like_count: int | None = None
    comment_count: int | None = None
    description: str | None = None
    language: str | None = None
    categories: str | None = None
    tags: str | None = None
    availability: str | None = None
    live_status: str | None = None
    subtitle_languages: str | None = None
    automatic_caption_languages: str | None = None
    transcript_path: str | None = None
    metadata_status: str = "complete"
    error: str | None = None

    def row(self) -> dict[str, Any]:
        return dataclasses.asdict(self)


class SourceError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def video_id(url: str) -> str:
    if "youtu.be/" in url:
        return urlsplit(url).path.strip("/").split("/")[0]
    query = dict(part.split("=", 1) for part in urlsplit(url).query.split("&") if "=" in part)
    return query.get("v", url)


def iso_date(month: str, day: str, year: str) -> str:
    normalized = month.upper()[:3]
    if normalized == "SEP":
        normalized = "SEP"
    return f"{int(year):04d}-{MONTHS[normalized]:02d}-{int(day):02d}"


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(path)


def fetch(session: requests.Session, url: str, timeout: int = 25) -> str:
    response = session.get(url, timeout=timeout)
    if response.status_code in (401, 403):
        raise SourceError("restricted", f"HTTP {response.status_code} for {url}")
    if response.status_code == 429:
        raise SourceError("rate_limited", f"HTTP 429 for {url}")
    if response.status_code >= 400:
        raise SourceError("unavailable", f"HTTP {response.status_code} for {url}")
    response.encoding = response.apparent_encoding
    return response.text


def request_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({
        "User-Agent": "ArchiveShelfResearch/1.0 (+https://github.com/occult-kranti/archiveshelf)",
        "Accept": "text/html,application/xhtml+xml",
    })
    return session


def crawl_kryon(channel: dict[str, Any], session: requests.Session, delay: float) -> list[Video]:
    records: list[Video] = []
    for source in channel.get("inventorySources", []):
        html = fetch(session, source)
        soup = BeautifulSoup(html, "html.parser")
        year_match = re.search(r"eng(\d{2})", source)
        year = f"20{year_match.group(1)}" if year_match else "unknown"
        for cell in soup.find_all("td"):
            anchors = [a for a in cell.find_all("a", href=True) if "youtu.be/" in a["href"]]
            text = cell.get_text(" ", strip=True)
            number = re.match(r"(\d{4}-\d{3})", text)
            date = re.search(rf"\b({MONTH_PATTERN})\.?\s+(\d{{1,2}}),\s+(\d{{4}})\b", text, re.I)
            if not anchors or not number or not date:
                continue
            anchor = next((a for a in anchors if a.get_text(" ", strip=True).strip('"“” ')), anchors[0])
            location = ""
            if date:
                location = text[number.end() if number else 0:date.start()].strip(" –—-")
            title = anchor.get_text(" ", strip=True).strip('"“” ')
            records.append(Video(
                channel=channel["name"], scope=f"creator_index_{year}",
                external_id=video_id(anchor["href"]), title=title,
                webpage_url=anchor["href"], source_url=source,
                source_item_number=number.group(1),
                upload_date=iso_date(*date.groups()) if date else None,
                location=location or None,
                metadata_status="creator_index",
            ))
        time.sleep(delay)
    return records


def session_number(url: str) -> int | None:
    match = re.search(r"/session-(\d+)", url)
    return int(match.group(1)) if match else None


def parse_sam_index(channel: dict[str, Any], html: str) -> dict[int, dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    source = channel["inventorySources"][0]
    entries: dict[int, dict[str, str]] = {}
    for anchor in soup.find_all("a", href=True):
        number = session_number(anchor["href"])
        if number is None:
            continue
        title = anchor.get_text(" ", strip=True)
        if title.isdigit() and number in entries:
            continue
        entries[number] = {"title": title or f"Session {number}", "url": anchor["href"], "source": source}
    return entries


def parse_sam_session(channel: dict[str, Any], entry: dict[str, str], number: int, html: str, output: Path) -> Video:
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)
    match = re.search(r"Session\s*#\s*\d+\s*•\s*([^•]+)\s*•\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})", text)
    upload_date = None
    category = None
    if match:
        category = match.group(1).strip()
        upload_date = dt.datetime.strptime(match.group(2), "%B %d, %Y").date().isoformat()
    heading = soup.find("h1")
    title = heading.get_text(" ", strip=True) if heading else entry["title"]
    if ":" in title and heading is None:
        title = title.split(":", 1)[-1].strip()
    description_tag = soup.find("meta", attrs={"name": "description"})
    description = description_tag.get("content") if description_tag else None
    transcript = ""
    content = soup.find("main") or soup.find("article") or soup.body
    if content:
        clone = BeautifulSoup(str(content), "html.parser")
        for unwanted in clone.find_all(["script", "style", "nav", "header", "footer", "form", "button"]):
            unwanted.decompose()
        transcript = clone.get_text("\n", strip=True)
        summary_at = transcript.find("Summary:")
        if summary_at >= 0:
            transcript = transcript[summary_at:]
    relative = f"transcripts/session-{number}.txt"
    if transcript:
        atomic_write(output / relative, transcript + "\n")
    return Video(
        channel=channel["name"], scope="creator_session_index",
        external_id=f"session-{number}", title=title,
        webpage_url=entry["url"], source_url=entry["source"],
        upload_date=upload_date, categories=category,
        description=description, transcript_path=relative if transcript else None,
        metadata_status="creator_session",
    )


def crawl_sam(channel: dict[str, Any], session: requests.Session, output: Path, delay: float) -> tuple[list[Video], int | None]:
    source = channel["inventorySources"][0]
    entries = parse_sam_index(channel, fetch(session, source))
    expected = max(entries) if entries else None
    records: list[Video] = []
    blocked: SourceError | None = None
    for number in sorted(entries):
        entry = entries[number]
        if blocked:
            records.append(Video(
                channel=channel["name"], scope="creator_session_index",
                external_id=f"session-{number}", title=entry["title"],
                webpage_url=entry["url"], source_url=entry["source"],
                metadata_status="index_only", error=str(blocked),
            ))
            continue
        try:
            html = fetch(session, entry["url"])
            records.append(parse_sam_session(channel, entry, number, html, output))
            time.sleep(delay)
        except SourceError as error:
            blocked = error
            records.append(Video(
                channel=channel["name"], scope="creator_session_index",
                external_id=f"session-{number}", title=entry["title"],
                webpage_url=entry["url"], source_url=entry["source"],
                metadata_status="index_only", error=str(error),
            ))
        except (requests.RequestException, ValueError) as error:
            records.append(Video(
                channel=channel["name"], scope="creator_session_index",
                external_id=f"session-{number}", title=entry["title"],
                webpage_url=entry["url"], source_url=entry["source"],
                metadata_status="error", error=str(error)[:500],
            ))
    return records, expected


def crawl_youtube(channel: dict[str, Any], full_metadata: bool, workers: int) -> tuple[list[Video], int | None]:
    url = channel["url"].rstrip("/") + "/videos"
    options = {
        "quiet": True, "no_warnings": True, "extract_flat": "in_playlist",
        "skip_download": True, "ignoreerrors": True, "socket_timeout": 12,
        "retries": 0, "noplaylist": False,
    }
    try:
        with yt_dlp.YoutubeDL(options) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as error:
        raise SourceError("source_unreachable", str(error)[:800]) from error
    entries = [entry for entry in (info.get("entries") or []) if entry and entry.get("id")]
    expected = info.get("playlist_count")
    records: list[Video] = []
    def convert(entry: dict[str, Any]) -> Video:
        target = entry.get("webpage_url") or f"https://www.youtube.com/watch?v={entry['id']}"
        details = entry
        if full_metadata:
            try:
                with yt_dlp.YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True, "socket_timeout": 20, "retries": 1}) as ydl:
                    details = ydl.extract_info(target, download=False)
            except Exception as error:
                return Video(channel=channel["name"], scope="youtube_channel", external_id=entry["id"], title=entry.get("title") or entry["id"], webpage_url=target, source_url=url, metadata_status="error", error=str(error)[:500])
        return Video(
            channel=channel["name"], scope="youtube_channel", external_id=entry["id"],
            title=details.get("title") or entry["id"], webpage_url=target, source_url=url,
            upload_date=details.get("upload_date"), duration_seconds=details.get("duration"),
            view_count=details.get("view_count"), like_count=details.get("like_count"),
            comment_count=details.get("comment_count"), description=details.get("description"),
            language=details.get("language"), categories=" | ".join(details.get("categories") or []) or None,
            tags=" | ".join(details.get("tags") or []) or None,
            availability=details.get("availability"), live_status=details.get("live_status"),
            subtitle_languages=" | ".join(sorted((details.get("subtitles") or {}).keys())) or None,
            automatic_caption_languages=" | ".join(sorted((details.get("automatic_captions") or {}).keys())) or None,
            metadata_status="complete" if full_metadata else "flat",
        )
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        records = list(pool.map(convert, entries))
    return records, expected


def summarize(channel: dict[str, Any], records: list[Video], expected: int | None, errors: list[str], duplicates_removed: int = 0, index_entries: int | None = None, source_items: int | None = None) -> dict[str, Any]:
    unique = {record.external_id: record for record in records}
    dates = sorted(record.upload_date for record in unique.values() if record.upload_date)
    complete = sum(record.metadata_status not in {"error", "index_only", "flat"} for record in unique.values())
    return {
        "channel": channel["name"],
        "url": channel.get("url"),
        "identityStatus": channel["status"],
        "verification": channel.get("verification"),
        "scopes": sorted({record.scope for record in records}) or ["not_crawled"],
        "expectedCount": expected,
        "indexEntries": index_entries if index_entries is not None else len(records),
        "sourceItems": source_items if source_items is not None else len({(record.scope, record.source_item_number or record.external_id) for record in unique.values()}),
        "totalVideos": len(unique),
        "earliestVideo": dates[0] if dates else None,
        "latestVideo": dates[-1] if dates else None,
        "metadataComplete": complete,
        "transcripts": sum(bool(record.transcript_path) for record in unique.values()),
        "totalDurationSeconds": sum(record.duration_seconds or 0 for record in unique.values()),
        "totalViews": sum(record.view_count or 0 for record in unique.values()),
        "totalLikes": sum(record.like_count or 0 for record in unique.values()),
        "totalComments": sum(record.comment_count or 0 for record in unique.values()),
        "withCaptions": sum(bool(record.subtitle_languages or record.automatic_caption_languages) for record in unique.values()),
        "duplicatesRemoved": duplicates_removed,
        "errors": errors,
        "channelWideVerified": bool(
            channel.get("url") and expected is not None and expected == len(unique)
            and unique and all(record.scope == "youtube_channel" for record in unique.values())
            and all(record.metadata_status != "error" for record in unique.values())
        ),
        "coverageNote": errors[0] if errors else ("Channel-wide count verified" if channel.get("url") and expected == len(unique) and expected is not None and unique and all(record.scope == "youtube_channel" for record in unique.values()) else f"{len(unique)} unique videos from {source_items if source_items is not None else len({(record.scope, record.source_item_number or record.external_id) for record in unique.values()})} creator-index items; channel-wide count unknown"),
    }


def unresolved_summary(channel: dict[str, Any]) -> dict[str, Any]:
    return {
        "channel": channel["name"], "url": None, "identityStatus": "unresolved",
        "verification": channel.get("verification"), "scopes": ["not_crawled"],
        "expectedCount": None, "indexEntries": 0, "sourceItems": 0, "totalVideos": 0, "earliestVideo": None,
        "latestVideo": None, "metadataComplete": 0, "transcripts": 0,
        "totalDurationSeconds": 0, "totalViews": 0, "totalLikes": 0,
        "totalComments": 0, "withCaptions": 0, "duplicatesRemoved": 0,
        "errors": ["Canonical channel URL is unresolved"],
        "channelWideVerified": False,
        "coverageNote": "Unresolved identity; skipped rather than guessing",
    }


def markdown_table(headers: list[str], rows: Iterable[Iterable[Any]]) -> str:
    def clean(value: Any) -> str:
        if value is None or value == "":
            return "—"
        return str(value).replace("|", "\\|").replace("\n", " ")
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    lines.extend("| " + " | ".join(clean(value) for value in row) + " |" for row in rows)
    return "\n".join(lines) + "\n"


def write_outputs(output: Path, summaries: list[dict[str, Any]], records: list[Video]) -> None:
    output.mkdir(parents=True, exist_ok=True)
    rows = [record.row() for record in sorted(records, key=lambda item: (item.channel, item.upload_date or "", item.external_id))]
    atomic_write(output / "videos.json", json.dumps(rows, indent=2, ensure_ascii=False))
    atomic_write(output / "channel-summary.json", json.dumps(summaries, indent=2, ensure_ascii=False))
    with (output / "videos.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    with (output / "channels.csv").open("w", encoding="utf-8", newline="") as handle:
        fields = list(summaries[0].keys()) if summaries else []
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for summary in summaries:
            writer.writerow({key: " | ".join(value) if isinstance(value, list) else value for key, value in summary.items()})

    generated = dt.datetime.now(dt.timezone.utc).isoformat()
    introduction = f"# Channel inventory\n\nGenerated: {generated}\n\nCounts are scoped and verified independently. A creator index is not automatically equivalent to every upload on the corresponding channel. Blocked and unresolved sources remain visible.\n\n"
    introduction += markdown_table(
        ["Channel", "Scope", "Earliest", "Latest", "Unique videos", "Index entries", "Source items", "Metadata", "Transcripts", "Views", "Verified", "Notes"],
        ([s["channel"], " / ".join(s["scopes"]), s["earliestVideo"], s["latestVideo"], s["totalVideos"], s["indexEntries"], s["sourceItems"], s["metadataComplete"], s["transcripts"], s["totalViews"], s["channelWideVerified"], s["coverageNote"]] for s in summaries),
    )
    atomic_write(output / "CHANNELS.md", introduction)
    video_intro = "# Video inventory\n\n" + markdown_table(
        ["Channel", "Date", "Title", "Duration", "Views", "Likes", "Comments", "Captions", "Metadata", "Source"],
        ([r.channel, r.upload_date, r.title, r.duration_seconds, r.view_count, r.like_count, r.comment_count, r.subtitle_languages or r.automatic_caption_languages, r.metadata_status, r.webpage_url] for r in records),
    )
    atomic_write(output / "VIDEOS.md", video_intro)
    verification = {
        "generatedAt": generated,
        "channels": summaries,
        "totals": {
            "channels": len(summaries),
            "resolvedChannels": sum(s["identityStatus"] == "verified" for s in summaries),
            "videos": sum(s["totalVideos"] for s in summaries),
            "transcripts": sum(s["transcripts"] for s in summaries),
            "channelWideVerified": sum(bool(s["channelWideVerified"]) for s in summaries),
        },
        "audioExecution": "Not run for third-party channels because authorization was not confirmed",
    }
    atomic_write(output / "verification.json", json.dumps(verification, indent=2, ensure_ascii=False))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--only", action="append", help="Case-insensitive channel-name substring; repeatable")
    parser.add_argument("--full-metadata", action="store_true")
    parser.add_argument("--workers", type=int, choices=(1, 2, 3), default=2)
    parser.add_argument("--delay", type=float, default=1.0)
    parser.add_argument("--force-network", action="store_true", help="Retry sources marked unreachable in the manifest")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    selected = [channel for channel in manifest["channels"] if not args.only or any(term.lower() in channel["name"].lower() for term in args.only)]
    summaries: list[dict[str, Any]] = []
    all_records: list[Video] = []
    session = request_session()
    for channel in selected:
        if channel["status"] != "verified":
            summaries.append(unresolved_summary(channel))
            print(json.dumps({"type": "channel_skipped", "channel": channel["name"], "reason": "unresolved"}), flush=True)
            continue
        records: list[Video] = []
        expected: int | None = None
        errors: list[str] = []
        channel_output = args.output / "channels" / slugify(channel["name"])
        channel_output.mkdir(parents=True, exist_ok=True)
        try:
            if channel.get("executionError") and not args.force_network:
                raise SourceError("source_blocked", channel["executionError"])
            if "kryon.com" in " ".join(channel.get("inventorySources", [])):
                records = crawl_kryon(channel, session, args.delay)
            elif "samtheillusionist.com" in " ".join(channel.get("inventorySources", [])):
                records, expected = crawl_sam(channel, session, channel_output, args.delay)
            elif "magentapixie.com" in " ".join(channel.get("inventorySources", [])):
                fetch(session, channel["inventorySources"][0])
                errors.append("The generic YouTube adapter was not needed after creator-index access")
            else:
                direct_status = manifest.get("directYouTubeStatus", {})
                if direct_status.get("status") == "blocked" and not args.force_network:
                    raise SourceError("source_unreachable", direct_status.get("reason", "Direct YouTube is blocked in this environment"))
                records, expected = crawl_youtube(channel, args.full_metadata, args.workers)
        except (SourceError, requests.RequestException) as error:
            errors.append(str(error))
        except Exception as error:
            errors.append(f"{type(error).__name__}: {str(error)[:800]}")
        unique = {record.external_id: record for record in records}
        ordered = list(unique.values())
        all_records.extend(ordered)
        atomic_write(channel_output / "videos.json", json.dumps([record.row() for record in ordered], indent=2, ensure_ascii=False))
        source_items = len({(record.scope, record.source_item_number or record.external_id) for record in records})
        summary = summarize(channel, ordered, expected, errors, len(records) - len(ordered), len(records), source_items)
        summaries.append(summary)
        atomic_write(channel_output / "summary.json", json.dumps(summary, indent=2, ensure_ascii=False))
        print(json.dumps({"type": "channel_finished", "channel": channel["name"], "videos": len(ordered), "errors": errors}), flush=True)
    write_outputs(args.output, summaries, all_records)
    print(json.dumps({"type": "inventory_finished", "channels": len(summaries), "videos": len(all_records)}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
