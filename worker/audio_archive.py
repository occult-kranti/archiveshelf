#!/usr/bin/env python3
"""Resumable shard runner for authorized audio and transcription archives."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import time

from archiveshelf import Options, append_index, event, process_video


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--shard-index", type=int, default=0)
    parser.add_argument("--shard-count", type=int, default=1)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--backend", choices=("openai", "faster-whisper"), default="faster-whisper")
    parser.add_argument("--allow-private-urls", action="store_true", help="Only for local fixtures you control")
    args = parser.parse_args()
    if not 1 <= args.shard_count <= 8 or not 0 <= args.shard_index < args.shard_count:
        raise SystemExit("Expected 0 <= shard-index < shard-count <= 8")
    with args.csv.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    selected = [row for index, row in enumerate(rows) if index % args.shard_count == args.shard_index]
    if args.limit:
        selected = selected[: args.limit]
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    options = Options(
        output=output,
        audio_format="mp3",
        transcribe_missing=True,
        whisper_backend=args.backend,
        whisper_model="tiny",
        concurrency=1,
        max_items=len(selected) or 1,
        allow_private_urls=args.allow_private_urls,
    )
    results: list[dict] = []
    for row in selected:
        url = row["webpage_url"]
        try:
            manifest = process_video(url, options)
        except Exception as error:
            manifest = {
                "version": 1,
                "status": "failed",
                "url": url,
                "id": row.get("external_id"),
                "title": row.get("title"),
                "channel": row.get("channel"),
                "artifacts": {},
                "transcriptText": "",
                "errors": [{"stage": "item", "code": "error", "message": str(error)[:1200]}],
            }
        manifest["sourceItemNumber"] = row.get("source_item_number")
        manifest["scope"] = row.get("scope")
        append_index(output, manifest)
        results.append(manifest)
        event("shard_progress", shard=args.shard_index, completed=len(results), total=len(selected), status=manifest["status"])
        time.sleep(0.35)
    summary = {
        "shardIndex": args.shard_index,
        "shardCount": args.shard_count,
        "total": len(results),
        "complete": sum(item["status"] == "complete" for item in results),
        "partial": sum(item["status"] == "partial" for item in results),
        "failed": sum(item["status"] == "failed" for item in results),
        "audio": sum(bool(item.get("artifacts", {}).get("audio")) for item in results),
        "transcripts": sum(bool(item.get("artifacts", {}).get("transcriptTxt")) for item in results),
        "resumed": sum(bool(item.get("resumed")) for item in results),
        "backend": args.backend,
        "results": results,
    }
    (output / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    (output / "results.jsonl").write_text(
        "\n".join(json.dumps({key: value for key, value in item.items() if key != "transcriptText"}, ensure_ascii=False) for item in results) + "\n",
        encoding="utf-8",
    )
    event("shard_finished", **{key: value for key, value in summary.items() if key != "results"})
    return 0 if summary["audio"] or not results else 2


if __name__ == "__main__":
    raise SystemExit(main())
