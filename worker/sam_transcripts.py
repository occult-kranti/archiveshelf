#!/usr/bin/env python3
"""Collect Sam the Illusionist's official numbered session transcripts."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from channel_inventory import crawl_sam, request_session, summarize, write_outputs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--delay", type=float, default=1.0)
    args = parser.parse_args()
    channel = {
        "name": "SAM THE ILLUSIONIST",
        "url": "https://www.youtube.com/@SAMTHEILLUSIONIST",
        "status": "verified",
        "verification": "Official samtheillusionist.com outbound YouTube link",
        "inventorySources": ["https://samtheillusionist.com/"],
    }
    output = args.output.resolve()
    records, expected = crawl_sam(channel, request_session(), output, args.delay, args.limit or None)
    summary = summarize(channel, records, expected, [])
    if args.limit == 1 and not any(record.transcript_path for record in records):
        raise SystemExit("Smoke transcript could not be collected; see per-session errors in the output")
    write_outputs(output, [summary], records)
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
