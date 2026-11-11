#!/usr/bin/env python3
"""Aggregate audio archive shards, verification tables, and release ZIPs."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import zipfile


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--release-dir", type=Path, required=True)
    parser.add_argument("--expected-csv", type=Path, required=True)
    args = parser.parse_args()
    results: list[dict] = []
    for path in sorted(args.artifacts.glob("shard-*/results.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            if line:
                results.append(json.loads(line))
    with args.expected_csv.open(encoding="utf-8", newline="") as handle:
        expected = list(csv.DictReader(handle))
    unique = {item.get("id") or item.get("url"): item for item in results}
    rows = list(unique.values())
    complete = sum(item["status"] == "complete" for item in rows)
    partial = sum(item["status"] == "partial" for item in rows)
    failed = sum(item["status"] == "failed" for item in rows)
    audio = sum(bool(item.get("artifacts", {}).get("audio")) for item in rows)
    transcripts = sum(bool(item.get("artifacts", {}).get("transcriptTxt")) for item in rows)
    resumed = sum(bool(item.get("resumed")) for item in rows)
    verification = {
        "expectedVideos": len(expected),
        "resultRows": len(rows),
        "allAttempted": len(rows) == len(expected),
        "complete": complete,
        "partial": partial,
        "failed": failed,
        "audioFiles": audio,
        "transcriptFiles": transcripts,
        "resumedItems": resumed,
        "missingIds": sorted({row["external_id"] for row in expected} - set(unique)),
        "duplicateRowsRemoved": len(results) - len(rows),
    }
    args.inventory.mkdir(parents=True, exist_ok=True)
    (args.inventory / "audio-verification.json").write_text(json.dumps(verification, indent=2, ensure_ascii=False), encoding="utf-8")
    fields = ["id", "sourceItemNumber", "title", "url", "status", "audio", "transcript", "path", "errors"]
    with (args.inventory / "audio-manifest.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for item in sorted(rows, key=lambda row: row.get("sourceItemNumber") or row.get("id") or ""):
            writer.writerow({
                "id": item.get("id"),
                "sourceItemNumber": item.get("sourceItemNumber"),
                "title": item.get("title"),
                "url": item.get("webpageUrl") or item.get("url"),
                "status": item.get("status"),
                "audio": bool(item.get("artifacts", {}).get("audio")),
                "transcript": bool(item.get("artifacts", {}).get("transcriptTxt")),
                "path": item.get("relativePath"),
                "errors": " | ".join(error.get("message", "") for error in item.get("errors", [])),
            })
    table = [
        "# Audio archive verification\n",
        f"- Expected videos: **{len(expected)}**",
        f"- Result rows: **{len(rows)}**",
        f"- All attempted: **{len(rows) == len(expected)}**",
        f"- Complete: **{complete}**",
        f"- Partial: **{partial}**",
        f"- Failed: **{failed}**",
        f"- Audio files: **{audio}**",
        f"- Transcript files: **{transcripts}**",
        f"- Resumed items: **{resumed}**",
        f"- Duplicate rows removed: **{len(results) - len(rows)}**",
        "\nSee `audio-manifest.csv` for every item and `audio-verification.json` for machine-readable counts. Audio and transcript media are release assets, not Git blobs.\n",
    ]
    (args.inventory / "AUDIO-STATUS.md").write_text("\n".join(table) + "\n", encoding="utf-8")
    args.release_dir.mkdir(parents=True, exist_ok=True)
    for shard in sorted(path for path in args.artifacts.glob("shard-*") if path.is_dir()):
        destination = args.release_dir / f"audio-transcripts-shard-{shard.name.split('-')[-1]}.zip"
        with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=4) as archive:
            for path in sorted(shard.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(shard))
    print(json.dumps(verification, indent=2))


if __name__ == "__main__":
    main()
