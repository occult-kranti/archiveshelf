#!/usr/bin/env python3
"""ArchiveShelf: resumable, audio-and-transcript-only media archiving.

The web server and the standalone CLI share this module. It deliberately has no
proxy rotation, credential harvesting, anti-bot bypass, or private-media access.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import dataclasses
import datetime as dt
import html
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import unicodedata
from typing import Any, Iterable
from urllib.parse import urlsplit
import zipfile

import webvtt
import yt_dlp


INDEX_LOCK = threading.Lock()
WHISPER_LOCK = threading.Lock()
_WHISPER_MODELS: dict[str, Any] = {}


def event(kind: str, **payload: Any) -> None:
    print(json.dumps({"type": kind, **payload}, ensure_ascii=False), flush=True)


def safe_name(value: str, limit: int = 110) -> str:
    value = unicodedata.normalize("NFKC", value or "Untitled")
    value = re.sub(r"[<>:\"/\\|?*\x00-\x1f]", " ", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    return (value[:limit].rstrip(" .") or "Untitled")


def seconds(value: str) -> float:
    parts = value.replace(",", ".").split(":")
    numbers = [float(part) for part in parts]
    if len(numbers) == 3:
        return numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    if len(numbers) == 2:
        return numbers[0] * 60 + numbers[1]
    return numbers[0]


def timestamp(value: float, srt: bool = False) -> str:
    millis = max(0, round(value * 1000))
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1000)
    separator = "," if srt else "."
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{millis:03d}"


@dataclasses.dataclass
class Segment:
    start: float
    end: float
    text: str


@dataclasses.dataclass
class Options:
    output: Path
    audio_format: str = "mp3"
    languages: tuple[str, ...] = ("en.*", "en")
    transcribe_missing: bool = False
    whisper_model: str = "tiny"
    whisper_backend: str = "openai"
    concurrency: int = 1
    max_items: int = 25
    allow_private_urls: bool = False


def clean_caption_text(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    value = html.unescape(value).replace("\x00", " ")
    return re.sub(r"\s+", " ", value).strip()


def read_vtt(path: Path) -> list[Segment]:
    segments: list[Segment] = []
    previous = ""
    for cue in webvtt.read(str(path)):
        text = clean_caption_text(cue.text)
        if not text or text == previous:
            continue
        previous = text
        start = seconds(cue.start)
        end = max(start, seconds(cue.end))
        segments.append(Segment(start, end, text))
    return segments


def paragraphs(segments: Iterable[Segment], width: int = 560) -> list[str]:
    blocks: list[str] = []
    current = ""
    for segment in segments:
        candidate = f"{current} {segment.text}".strip()
        if len(candidate) > width and current:
            blocks.append(current)
            current = segment.text
        else:
            current = candidate
    if current:
        blocks.append(current)
    return blocks


def write_transcripts(
    item_dir: Path,
    segments: list[Segment],
    metadata: dict[str, Any],
    origin: str,
) -> dict[str, str]:
    artifacts: dict[str, str] = {}
    text = "\n\n".join(paragraphs(segments)) + "\n"
    (item_dir / "transcript.txt").write_text(text, encoding="utf-8")
    artifacts["transcriptTxt"] = "transcript.txt"

    header = [
        f"# {metadata.get('title') or 'Untitled'}",
        "",
        f"- Source: {metadata.get('webpage_url') or metadata.get('url') or 'unknown'}",
        f"- Channel: {metadata.get('channel') or metadata.get('uploader') or 'Unknown'}",
        f"- Transcript origin: {origin}",
        "",
    ]
    (item_dir / "transcript.md").write_text(
        "\n".join(header) + text, encoding="utf-8"
    )
    artifacts["transcriptMd"] = "transcript.md"

    payload = {
        "source": metadata.get("webpage_url") or metadata.get("url"),
        "title": metadata.get("title"),
        "origin": origin,
        "segments": [dataclasses.asdict(segment) for segment in segments],
    }
    (item_dir / "transcript.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    artifacts["transcriptJson"] = "transcript.json"

    srt_blocks = []
    for index, segment in enumerate(segments, 1):
        srt_blocks.append(
            f"{index}\n{timestamp(segment.start, True)} --> {timestamp(segment.end, True)}\n{segment.text}"
        )
    (item_dir / "transcript.srt").write_text(
        "\n\n".join(srt_blocks) + ("\n" if srt_blocks else ""), encoding="utf-8"
    )
    artifacts["transcriptSrt"] = "transcript.srt"

    vtt_blocks = ["WEBVTT"]
    for segment in segments:
        vtt_blocks.append(
            f"{timestamp(segment.start)} --> {timestamp(segment.end)}\n{segment.text}"
        )
    (item_dir / "transcript.vtt").write_text(
        "\n\n".join(vtt_blocks) + "\n", encoding="utf-8"
    )
    artifacts["transcriptVtt"] = "transcript.vtt"
    return artifacts


def validate_url(url: str, allow_private: bool = False) -> None:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Only absolute HTTP(S) URLs are supported")
    if parsed.username or parsed.password:
        raise ValueError("Credential-bearing URLs are not accepted")
    if allow_private:
        return
    try:
        addresses = {entry[4][0] for entry in socket.getaddrinfo(parsed.hostname, None)}
    except socket.gaierror as exc:
        raise ValueError(f"Could not resolve host: {parsed.hostname}") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise ValueError("Private, local, and link-local destinations are blocked")


def yt_options(extra: dict[str, Any] | None = None) -> dict[str, Any]:
    options: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
        "ignoreerrors": False,
        "retries": 2,
        "fragment_retries": 2,
        "socket_timeout": 30,
        "sleep_interval_requests": 0.35,
        "max_sleep_interval_requests": 0.75,
        "no_call_home": True,
    }
    options.update(extra or {})
    return options


def normalized_metadata(info: dict[str, Any], source_url: str) -> dict[str, Any]:
    keys = (
        "id", "title", "description", "channel", "channel_id", "uploader",
        "uploader_id", "duration", "upload_date", "webpage_url", "extractor",
        "language", "view_count", "like_count", "thumbnail",
    )
    metadata = {key: info.get(key) for key in keys if info.get(key) is not None}
    metadata["webpage_url"] = info.get("webpage_url") or source_url
    metadata["retrievedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
    return metadata


def is_collection(url: str) -> bool:
    lowered = url.lower()
    return any(token in lowered for token in ("/playlist", "list=", "/channel/", "/@"))


def expand_source(url: str, options: Options) -> list[str]:
    if not is_collection(url):
        return [url]
    ydl_opts = yt_options({
        "extract_flat": "in_playlist",
        "skip_download": True,
        "ignoreerrors": True,
        "playlistend": options.max_items,
        "noplaylist": False,
    })
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
    entries = (info or {}).get("entries") or []
    urls: list[str] = []
    for entry in entries:
        if not entry:
            continue
        target = entry.get("webpage_url") or entry.get("url")
        if target and not target.startswith("http") and entry.get("id"):
            target = f"https://www.youtube.com/watch?v={entry['id']}"
        if target:
            urls.append(target)
        if len(urls) >= options.max_items:
            break
    event("discovered", source=url, count=len(urls))
    return urls


def classify_error(message: str) -> str:
    lowered = message.lower()
    if any(token in lowered for token in ("private video", "members-only", "login required", "sign in")):
        return "restricted"
    if any(token in lowered for token in ("429", "too many requests", "rate limit")):
        return "rate_limited"
    if any(token in lowered for token in ("copyright", "unavailable", "removed", "not found", "404")):
        return "unavailable"
    if any(token in lowered for token in ("timed out", "timeout", "network", "temporary failure", "connection")):
        return "network"
    return "error"


def manifest_complete(item_dir: Path, options: Options | None = None) -> bool:
    path = item_dir / "manifest.json"
    if not path.exists():
        return False
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        if manifest.get("status") not in {"complete", "partial"}:
            return False
        artifacts = manifest.get("artifacts") or {}
        if not all((item_dir / relative).exists() for relative in artifacts.values()):
            return False
        if options and options.audio_format != "none":
            audio = artifacts.get("audio", "")
            if not audio.endswith(f".{options.audio_format}"):
                return False
        if options and options.transcribe_missing and not artifacts.get("transcriptTxt"):
            return False
        return True
    except (OSError, ValueError):
        return False


def whisper_segments(audio_path: Path, model_name: str, backend: str = "openai") -> list[Segment]:
    download_root = os.environ.get("WHISPER_DOWNLOAD_ROOT", ".models")
    cache_key = f"{backend}:{model_name}"
    if backend == "openai":
        try:
            import whisper
        except ImportError as exc:
            raise RuntimeError(
                "OpenAI Whisper is not installed; run pip install -r worker/requirements-whisper-openai.txt"
            ) from exc
        with WHISPER_LOCK:
            if cache_key not in _WHISPER_MODELS:
                _WHISPER_MODELS[cache_key] = whisper.load_model(
                    model_name, device="cpu", download_root=download_root
                )
            model = _WHISPER_MODELS[cache_key]
        result = model.transcribe(str(audio_path), fp16=False)
        return [
            Segment(float(item["start"]), float(item["end"]), clean_caption_text(item["text"]))
            for item in result.get("segments", [])
            if clean_caption_text(item["text"])
        ]
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError(
            "faster-whisper is not installed; run pip install -r worker/requirements-transcribe.txt"
        ) from exc
    with WHISPER_LOCK:
        if cache_key not in _WHISPER_MODELS:
            _WHISPER_MODELS[cache_key] = WhisperModel(
                model_name, device="cpu", compute_type="int8", download_root=download_root
            )
        model = _WHISPER_MODELS[cache_key]
    segments, _ = model.transcribe(str(audio_path), beam_size=1, vad_filter=True)
    return [
        Segment(float(item.start), float(item.end), clean_caption_text(item.text))
        for item in segments
        if clean_caption_text(item.text)
    ]


def download_audio(url: str, item_dir: Path, audio_format: str) -> Path:
    target = item_dir / f"audio.{audio_format}"
    ydl_opts = yt_options({
        "format": "bestaudio/best",
        "outtmpl": str(item_dir / "audio.%(ext)s"),
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": audio_format,
            "preferredquality": "64" if audio_format == "mp3" else "0",
        }],
        "keepvideo": False,
        "overwrites": True,
        "postprocessor_args": ["-ac", "1", "-ar", "16000"],
    })
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])
    if not target.exists():
        candidates = sorted(item_dir.glob(f"audio.{audio_format}*"))
        if not candidates:
            raise RuntimeError("Audio extraction completed without an output file")
        target = candidates[0]
    return target


def fetch_captions(
    url: str, item_dir: Path, languages: tuple[str, ...]
) -> tuple[dict[str, Any], list[Segment], str | None]:
    ydl_opts = yt_options({
        "skip_download": True,
        "writesubtitles": True,
        "writeautomaticsub": True,
        "subtitleslangs": list(languages),
        "subtitlesformat": "vtt",
        "outtmpl": str(item_dir / "source.%(ext)s"),
        "ignore_no_formats_error": True,
    })
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
    metadata = normalized_metadata(info or {}, url)
    candidates = sorted(
        path for path in item_dir.glob("source*.vtt")
        if path.name != "transcript.vtt"
    )
    if not candidates:
        return metadata, [], None
    # Keep the first successfully parsed track. Preference is already applied by
    # yt-dlp's subtitleslangs ordering; malformed tracks are skipped.
    errors: list[str] = []
    for path in candidates:
        try:
            segments = read_vtt(path)
            if segments:
                return metadata, segments, path.name
        except Exception as exc:  # malformed third-party caption track
            errors.append(f"{path.name}: {exc}")
    if errors:
        event("warning", message="Caption track parse failed", details=errors)
    return metadata, [], None


def process_video(url: str, options: Options) -> dict[str, Any]:
    validate_url(url, options.allow_private_urls)
    started = time.monotonic()
    event("item_started", url=url)
    # Metadata is fetched once before choosing a deterministic output folder.
    with yt_dlp.YoutubeDL(yt_options({"skip_download": True})) as ydl:
        initial = ydl.extract_info(url, download=False)
    metadata = normalized_metadata(initial or {}, url)
    channel = safe_name(metadata.get("channel") or metadata.get("uploader") or "Unknown channel")
    date = str(metadata.get("upload_date") or "")
    year = date[:4] if re.match(r"^\d{4}", date) else "Undated"
    title = safe_name(metadata.get("title") or metadata.get("id") or "Untitled", 80)
    external_id = safe_name(str(metadata.get("id") or "item"), 40)
    item_dir = options.output / channel / year / f"{title} [{external_id}]"
    item_dir.mkdir(parents=True, exist_ok=True)

    if manifest_complete(item_dir, options):
        manifest = json.loads((item_dir / "manifest.json").read_text(encoding="utf-8"))
        manifest["resumed"] = True
        event("item_skipped", url=url, path=str(item_dir))
        return manifest

    errors: list[dict[str, str]] = []
    artifacts: dict[str, str] = {}
    segments: list[Segment] = []
    origin: str | None = None
    try:
        caption_metadata, segments, source_track = fetch_captions(url, item_dir, options.languages)
        metadata.update(caption_metadata)
        origin = f"captions:{source_track}" if source_track else None
    except Exception as exc:
        errors.append({"stage": "captions", "code": classify_error(str(exc)), "message": str(exc)[:1200]})

    audio_path: Path | None = None
    if options.audio_format != "none" or (not segments and options.transcribe_missing):
        try:
            audio_path = download_audio(
                url, item_dir, "mp3" if options.audio_format == "none" else options.audio_format
            )
            if options.audio_format != "none":
                artifacts["audio"] = audio_path.name
        except Exception as exc:
            errors.append({"stage": "audio", "code": classify_error(str(exc)), "message": str(exc)[:1200]})

    if not segments and options.transcribe_missing and audio_path:
        try:
            segments = whisper_segments(audio_path, options.whisper_model, options.whisper_backend)
            origin = f"{options.whisper_backend}:{options.whisper_model}"
        except Exception as exc:
            errors.append({"stage": "transcription", "code": classify_error(str(exc)), "message": str(exc)[:1200]})

    if segments:
        artifacts.update(write_transcripts(item_dir, segments, metadata, origin or "unknown"))

    (item_dir / "metadata.json").write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    artifacts["metadata"] = "metadata.json"

    # Source caption tracks and intermediate files are not part of the clean
    # archive. Only normalized transcript.* files and audio.* remain.
    for path in item_dir.glob("source*"):
        if path.is_file():
            path.unlink()
    if options.audio_format == "none" and audio_path:
        audio_path.unlink(missing_ok=True)

    status = "failed"
    if artifacts.get("audio") and artifacts.get("transcriptTxt"):
        status = "complete"
    elif artifacts.get("audio") or artifacts.get("transcriptTxt"):
        status = "partial"
    manifest = {
        "version": 1,
        "status": status,
        "url": url,
        "id": metadata.get("id"),
        "title": metadata.get("title"),
        "channel": metadata.get("channel") or metadata.get("uploader"),
        "duration": metadata.get("duration"),
        "webpageUrl": metadata.get("webpage_url"),
        "path": str(item_dir),
        "relativePath": str(item_dir.relative_to(options.output)),
        "artifacts": artifacts,
        "transcriptText": "\n\n".join(paragraphs(segments)) if segments else "",
        "transcriptOrigin": origin,
        "errors": errors,
        "elapsedSeconds": round(time.monotonic() - started, 3),
    }
    (item_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    event("item_finished", url=url, status=status, path=str(item_dir), errors=errors)
    return manifest


def append_index(output: Path, manifest: dict[str, Any]) -> None:
    summary = {key: value for key, value in manifest.items() if key != "transcriptText"}
    with INDEX_LOCK:
        with (output / "index.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(summary, ensure_ascii=False) + "\n")


def archive(urls: list[str], options: Options) -> int:
    options.output.mkdir(parents=True, exist_ok=True)
    expanded: list[str] = []
    for source in urls:
        validate_url(source, options.allow_private_urls)
        try:
            expanded.extend(expand_source(source, options))
        except Exception as exc:
            event("source_error", source=source, code=classify_error(str(exc)), message=str(exc)[:1200])
    expanded = list(dict.fromkeys(expanded))[: options.max_items]
    event("batch_started", total=len(expanded), concurrency=options.concurrency)
    results: list[dict[str, Any]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=options.concurrency) as pool:
        futures = {pool.submit(process_video, url, options): url for url in expanded}
        for future in concurrent.futures.as_completed(futures):
            url = futures[future]
            try:
                manifest = future.result()
            except Exception as exc:
                manifest = {
                    "version": 1, "status": "failed", "url": url,
                    "artifacts": {}, "transcriptText": "",
                    "errors": [{"stage": "item", "code": classify_error(str(exc)), "message": str(exc)[:1200]}],
                }
                event("item_finished", url=url, status="failed", errors=manifest["errors"])
            append_index(options.output, manifest)
            results.append(manifest)
            event("batch_progress", completed=len(results), total=len(expanded), status=manifest["status"])
    succeeded = sum(result["status"] != "failed" for result in results)
    event("batch_finished", total=len(results), succeeded=succeeded, failed=len(results) - succeeded)
    return 0 if succeeded or not results else 2


def bundle(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive_file:
        for path in sorted(source.rglob("*")):
            if path.is_file() and path.resolve() != destination.resolve():
                archive_file.write(path, path.relative_to(source))


def doctor() -> dict[str, Any]:
    return {
        "python": sys.version.split()[0],
        "ytDlp": yt_dlp.version.__version__,
        "ffmpeg": shutil.which("ffmpeg"),
        "fasterWhisper": bool(__import__("importlib").util.find_spec("faster_whisper")),
        "openaiWhisper": bool(__import__("importlib").util.find_spec("whisper")),
    }


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__)
    commands = root.add_subparsers(dest="command", required=True)
    archive_parser = commands.add_parser("archive", help="Archive audio and transcripts")
    archive_parser.add_argument("--url", action="append", required=True, help="Video, playlist, channel, or direct media URL")
    archive_parser.add_argument("--output", type=Path, required=True)
    archive_parser.add_argument("--audio-format", choices=("mp3", "m4a", "wav", "none"), default="mp3")
    archive_parser.add_argument("--languages", default="en.*,en", help="Comma-separated subtitle language preferences")
    archive_parser.add_argument("--transcribe-missing", action="store_true")
    archive_parser.add_argument("--whisper-model", default="tiny")
    archive_parser.add_argument("--whisper-backend", choices=("openai", "faster-whisper"), default="openai")
    archive_parser.add_argument("--concurrency", type=int, choices=(1, 2, 3), default=1)
    archive_parser.add_argument("--max-items", type=int, default=25)
    archive_parser.add_argument("--allow-private-urls", action="store_true", help="Only for local fixtures you control")
    archive_parser.add_argument("--rights-confirmed", action="store_true", required=True, help="Confirm ownership, permission, or other authorization")

    bundle_parser = commands.add_parser("bundle", help="Zip an export directory")
    bundle_parser.add_argument("--input", type=Path, required=True)
    bundle_parser.add_argument("--output", type=Path, required=True)
    commands.add_parser("doctor", help="Report runtime dependencies")
    return root


def main() -> int:
    args = parser().parse_args()
    if args.command == "doctor":
        print(json.dumps(doctor(), indent=2))
        return 0
    if args.command == "bundle":
        bundle(args.input.resolve(), args.output.resolve())
        event("bundle_finished", output=str(args.output), bytes=args.output.stat().st_size)
        return 0
    if not 1 <= args.max_items <= 500:
        raise SystemExit("--max-items must be between 1 and 500")
    options = Options(
        output=args.output.resolve(),
        audio_format=args.audio_format,
        languages=tuple(part.strip() for part in args.languages.split(",") if part.strip()),
        transcribe_missing=args.transcribe_missing,
        whisper_model=args.whisper_model,
        whisper_backend=args.whisper_backend,
        concurrency=args.concurrency,
        max_items=args.max_items,
        allow_private_urls=args.allow_private_urls,
    )
    return archive(args.url, options)


if __name__ == "__main__":
    raise SystemExit(main())
