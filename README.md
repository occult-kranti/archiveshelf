# ArchiveShelf

> **Delivery status:** The verified full source is packaged separately. The automated expanded-file-tree import requires reconnecting this GitHub connection with the `workflow` scope. No source import is being represented as complete here.

ArchiveShelf is a source-first research archive for authorized media. Import videos, playlists, channels, or direct media URLs; keep searchable transcripts and audio; leave video files behind.

## Included in the verified build

- Responsive React library with title/channel/transcript search
- Authenticated import jobs, live progress, cancellation, and partial-failure notes
- MP3, M4A, WAV, or transcript-only exports
- TXT, Markdown, JSON, SRT, and WebVTT transcripts
- Optional `faster-whisper` fallback for missing captions
- Owner-checked audio, Markdown, per-video ZIP, and per-job ZIP downloads
- Resumable CLI with one to three workers and organized per-video folders
- Installable PWA, production server bundle, and Docker build
- Original CC0/local test suite with no third-party channel media

The UI is an original implementation informed by the supplied reference screenshots. It does not include BeyondTube branding, credits, private APIs, or unimplemented AI buttons.

## Architecture

```text
React UI ── tRPC ── authenticated job router ── Python worker ── yt-dlp / FFmpeg
   │                     │                            │
   │                     ├─ MySQL: jobs, sources, transcript text + segments
   │                     └─ Object storage: audio bytes
   │                                                    │
   └────────── owner-checked on-demand MD/ZIP ◀──────────┘
```

The standalone CLI uses the same `worker/archiveshelf.py` engine but writes directly to disk and does not require Kimi authentication, MySQL, or object storage.

## Run the web app

The platform scaffold supplies credentials in `.env`; never commit that file.

```bash
npm install
npm run setup:worker
npm run db:push
npm run dev
```

Open `http://localhost:3000`. For a production cold start:

```bash
npm run build
npm start
```

Published hosting and object storage consume the owner’s platform quota. On-demand web ZIPs are capped at 95 MB of input audio to bound memory.

### Optional local transcription

```bash
node scripts/setup-worker.mjs --transcribe
```

This installs `faster-whisper`. The first transcription also downloads a model. In the project sandbox the package imported, but model download exceeded the verification timeout; treat this optional path as unverified until it succeeds in your environment.

## Run the CLI

Install FFmpeg and Python 3, then:

```bash
npm run setup:worker
PYTHONPATH=.python python3 worker/archiveshelf.py archive \
  --url "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" \
  --output ./exports \
  --audio-format mp3 \
  --languages 'en.*,en' \
  --concurrency 2 \
  --max-items 25 \
  --rights-confirmed
```

Outputs follow this layout:

```text
exports/
├── index.jsonl
└── Channel name/
    └── 2026/
        └── Video title [video-id]/
            ├── audio.mp3
            ├── transcript.txt
            ├── transcript.md
            ├── transcript.json
            ├── transcript.srt
            ├── transcript.vtt
            ├── metadata.json
            └── manifest.json
```

Only requested artifacts are written. If captions are absent and local transcription is disabled, the item is correctly marked `partial`. Repeating a run skips satisfied outputs; changing audio format or enabling transcription reopens incomplete requirements.

To create a ZIP directly from a local export directory:

```bash
PYTHONPATH=.python python3 worker/archiveshelf.py bundle \
  --input ./exports --output ./exports.zip
```

## Screenshot channel intake

`config/channel-intake.json` records the visible names and the two requested exclusions: Jamie Butler and Vivek Samtani. Truncated or ambiguous names have `url: null` and `status: unresolved`. Supply exact channel URLs before using that list. No identity has been guessed from a name collision, and no third-party channel archive was downloaded during verification.

## Test

```bash
npm run check
npm run test:worker
npm run test:stress
npm run build
npm audit --omit=dev
```

`bash scripts/stress-test.sh` generates original speech/video fixtures, starts a local HTTP server, processes three files with three workers, injects a 404, verifies that no video remains, and checks resume behavior. See `docs/TESTING.md` for the full verification record and known limits.

## Docker

```bash
docker build -t archiveshelf .
docker run --env-file .env -p 3000:3000 archiveshelf
```

The image includes Node 20, Python 3, FFmpeg, the built web app, and worker dependencies. Supply production environment values at runtime; do not bake `.env` into an image.

## Access and licensing

Use the tool only for media you own, have permission to archive, or are otherwise authorized to copy. It does not bypass logins, paywalls, anti-bot systems, geographic restrictions, or rate limits. Restricted items fail visibly and the batch continues. Review the source platform’s current terms before archiving.

Original project code is MIT-licensed. Third-party components and reference boundaries are listed in `CREDITS.md`.
