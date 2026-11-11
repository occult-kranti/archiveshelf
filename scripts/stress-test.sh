#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
PORT=${ARCHIVE_TEST_PORT:-$(python3 - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
)}
SERVER_PID=""
cleanup() {
  if [[ -n "$SERVER_PID" ]]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
mkdir -p "$WORK/fixtures"
for name in alpha beta gamma; do
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=320x180:rate=12" \
    -f lavfi -i "flite=text='Archive fixture $name survives parallel processing.':voice=slt" \
    -t 3 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$WORK/fixtures/$name.mp4"
done
python3 -m http.server "$PORT" --directory "$WORK/fixtures" >"$WORK/server.log" 2>&1 &
SERVER_PID=$!
sleep 1
URLS=()
for name in alpha beta gamma missing; do URLS+=(--url "http://127.0.0.1:$PORT/$name.mp4"); done
PYTHONPATH="$ROOT/.python" python3 "$ROOT/worker/archiveshelf.py" archive \
  "${URLS[@]}" --output "$WORK/output" --audio-format mp3 --concurrency 3 \
  --max-items 4 --allow-private-urls --rights-confirmed
python3 - "$WORK/output" <<'PY'
from pathlib import Path
import json, sys
root = Path(sys.argv[1])
rows = [json.loads(line) for line in (root / "index.jsonl").read_text().splitlines()]
audio = list(root.rglob("audio.mp3"))
video = [p for p in root.rglob("*") if p.suffix in {".mp4", ".webm", ".mkv"}]
assert len(audio) == 3, f"Expected 3 audio files, found {len(audio)}"
assert not video, f"Retained video files: {video}"
assert sum(row["status"] == "failed" for row in rows) == 1, "The deliberate 404 did not fail as expected"
print("PASS: 3 audio exports, 1 isolated 404, 0 retained videos")
PY
PYTHONPATH="$ROOT/.python" python3 "$ROOT/worker/archiveshelf.py" archive \
  --url "http://127.0.0.1:$PORT/alpha.mp4" --output "$WORK/output" \
  --audio-format mp3 --max-items 1 --allow-private-urls --rights-confirmed \
  | tee "$WORK/resume.log"
grep -q 'item_skipped' "$WORK/resume.log"
echo "PASS: resume skipped the existing item"
