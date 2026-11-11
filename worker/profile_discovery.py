#!/usr/bin/env python3
"""Bounded, parallel official-profile and source discovery without access bypasses."""
from __future__ import annotations

import argparse
import concurrent.futures
import dataclasses
import datetime as dt
import json
from pathlib import Path
import re
import time
from typing import Any
from urllib.parse import urljoin, urlsplit
import urllib.robotparser

import requests
from bs4 import BeautifulSoup

from agent_gw import AgentGwClient
from channel_inventory import fetch, request_session


SOCIAL = {"youtube.com", "youtu.be", "facebook.com", "instagram.com", "twitter.com", "x.com", "tiktok.com", "linkedin.com"}
RELEVANT = re.compile(r"transcript|caption|audio|video|session|archive|download|podcast|media", re.I)


@dataclasses.dataclass
class Discovery:
    channel: str
    status: str
    officialSite: str | None = None
    canonicalUrl: str | None = None
    pagesScanned: int = 0
    videoLinks: int = 0
    directMedia: int = 0
    documentLinks: int = 0
    transcriptLinks: int = 0
    evidence: list[str] = dataclasses.field(default_factory=list)
    errors: list[str] = dataclasses.field(default_factory=list)
    records: list[dict[str, Any]] = dataclasses.field(default_factory=list)


def host(url: str) -> str:
    return urlsplit(url).hostname or ""


def same_site(left: str, right: str) -> bool:
    a, b = host(left).removeprefix("www."), host(right).removeprefix("www.")
    return a == b or a.endswith("." + b) or b.endswith("." + a)


def allowed(session: requests.Session, url: str) -> bool:
    try:
        parsed = urlsplit(url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        parser = urllib.robotparser.RobotFileParser(robots_url)
        parser.read()
        return parser.can_fetch(session.headers["User-Agent"], url)
    except Exception:
        return True


def extract_page(url: str, html: str) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    result: dict[str, Any] = {"title": soup.title.get_text(" ", strip=True) if soup.title else "", "links": [], "videoObjects": []}
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "null")
            objects = data if isinstance(data, list) else [data]
            for item in objects:
                if isinstance(item, dict) and any(term in str(item.get("@type", "")).lower() for term in ("video", "audio", "episode")):
                    result["videoObjects"].append(item)
        except (ValueError, TypeError):
            continue
    for anchor in soup.find_all("a", href=True):
        href = urljoin(url, anchor["href"])
        text = anchor.get_text(" ", strip=True)
        result["links"].append({"url": href, "text": text})
    for tag in soup.find_all(["iframe", "source", "video", "audio"]):
        source = tag.get("src")
        if source:
            result["links"].append({"url": urljoin(url, source), "text": tag.get("title") or tag.name})
    return result


def crawl_site(channel: dict[str, Any], start_url: str, max_pages: int) -> Discovery:
    result = Discovery(channel=channel["name"], status="candidate", officialSite=start_url)
    session = request_session()
    queue = [(start_url, 0)]
    seen: set[str] = set()
    for url, depth in queue:
        if len(seen) >= max_pages or depth > 1 or not same_site(start_url, url):
            continue
        if url in seen or not allowed(session, url):
            continue
        seen.add(url)
        try:
            html = fetch(session, url, timeout=20)
            result.pagesScanned += 1
            page = extract_page(url, html)
            for link in page["links"]:
                href, text = link["url"], link["text"]
                hostname = host(href)
                if hostname in {"youtube.com", "www.youtube.com"} and any(part in href for part in ("/channel/", "/user/", "/@")):
                    result.canonicalUrl = result.canonicalUrl or href
                    result.status = "verified"
                    result.evidence.append(f"Official-site channel link: {href}")
                if "youtu.be/" in href or "youtube.com/watch" in href:
                    result.videoLinks += 1
                    result.records.append({"type": "youtube_video", "url": href, "title": text, "sourcePage": url})
                elif re.search(r"\.(mp3|m4a|wav|mp4|webm)(\?|$)", href, re.I):
                    result.directMedia += 1
                    result.records.append({"type": "direct_media", "url": href, "title": text, "sourcePage": url})
                elif RELEVANT.search(text + " " + href):
                    result.documentLinks += 1
                    if re.search(r"transcript|caption", text + " " + href, re.I):
                        result.transcriptLinks += 1
                    result.records.append({"type": "document", "url": href, "title": text, "sourcePage": url})
                    if depth < 1 and same_site(start_url, href):
                        queue.append((href, depth + 1))
            for item in page["videoObjects"]:
                result.records.append({"type": "jsonld", "url": item.get("url") or item.get("contentUrl"), "title": item.get("name"), "sourcePage": url, "data": item})
            time.sleep(0.25)
        except (requests.RequestException, ValueError) as error:
            result.errors.append(f"{url}: {str(error)[:300]}")
    return result


def search_site(channel: dict[str, Any], client: AgentGwClient) -> str | None:
    query = f"{channel['name']} official website YouTube channel"
    response = client.search(query)
    for item in response.get("search_results", [])[:5]:
        url = item.get("url")
        if url and host(url) not in SOCIAL:
            return url
    return None


def discover(channel: dict[str, Any], client: AgentGwClient, max_pages: int) -> Discovery:
    if channel.get("officialSite"):
        return crawl_site(channel, channel["officialSite"], max_pages)
    if channel["status"] == "verified":
        return Discovery(channel=channel["name"], status="verified", canonicalUrl=channel.get("url"), evidence=["Canonical URL already verified in manifest"])
    try:
        start = search_site(channel, client)
        if not start:
            return Discovery(channel=channel["name"], status="unresolved", errors=["No official site found in public search"])
        return crawl_site(channel, start, max_pages)
    except Exception as error:
        return Discovery(channel=channel["name"], status="unresolved", errors=[str(error)[:500]])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--max-pages", type=int, default=6)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    client = AgentGwClient(timeout=45)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(lambda channel: discover(channel, client, args.max_pages), manifest["channels"]))
    args.output.mkdir(parents=True, exist_ok=True)
    for result in results:
        slug = re.sub(r"[^a-z0-9]+", "-", result.channel.lower()).strip("-")
        (args.output / f"{slug}.json").write_text(json.dumps(dataclasses.asdict(result), indent=2, ensure_ascii=False), encoding="utf-8")
    rows = [dataclasses.asdict(result) for result in results]
    (args.output / "summary.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    lines = ["# Official profile discovery\n", "| Channel | Status | Pages | Video links | Direct media | Documents | Errors |", "|---|---|---|---|---|---|---|"]
    for result in results:
        lines.append(f"| {result.channel} | {result.status} | {result.pagesScanned} | {result.videoLinks} | {result.directMedia} | {result.documentLinks} | {len(result.errors)} |")
    (args.output / "DISCOVERY.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"channels": len(results), "verified": sum(result.status == "verified" for result in results), "videoLinks": sum(result.videoLinks for result in results), "directMedia": sum(result.directMedia for result in results), "documents": sum(result.documentLinks for result in results)}, indent=2))


if __name__ == "__main__":
    main()
