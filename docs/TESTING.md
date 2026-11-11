# Verification record

Verified on 12 November 2026 in the project sandbox. No third-party channel archive was downloaded. External live media was MDN's CC0 fixture; all speech and stress fixtures were generated locally.

## Results

| Layer | Check | Result |
|---|---|---|
| Python unit tests | Filename safety, timestamps, five transcript serializers, error classes | **4/4 passed** |
| Engine option comparison | `yt-dlp` and direct FFmpeg extraction of the same CC0 clip | Both produced identical **41,042-byte MP3** files |
| Engine integration | CC0 URL through the standalone worker | Audio, metadata, and manifest only; no video retained |
| Parallel stress | Six local files plus a deliberate 404, three workers | Six MP3s, one isolated failure, zero retained videos; **10 seconds** |
| Resume | Repeat one completed source | `item_skipped` emitted; existing artifacts preserved |
| Benchmark | Same three local files, one versus three workers | **5.767 s sequential / 2.592 s parallel** |
| Web import | Authenticated CC0 import through the visible UI | Completed with audio; partial status correctly indicates no captions |
| Object storage | Upload, exists, head, list, signed download, delete, exists-after | All passed; downloaded bytes matched the fixture |
| Video ZIP | Integrity and audio comparison | Valid ZIP; embedded audio byte-identical to source |
| Batch ZIP | Authenticated job archive | Valid ZIP; correct audio, metadata, and manifest |
| Transcript exports | Original two-cue caption fixture | TXT, MD, JSON, SRT, VTT, metadata, manifest all valid |
| Cancellation | Three-source job cancelled immediately | `cancelling` → `cancelled` in two polls |
| Access control | ZIP route without a session | **401**; malformed video ID returns **400** |
| Browser | Library, import, jobs, details, copy action, downloads, mobile drawer | All reached expected states; **0 console errors / 0 failed requests** |
| Responsive geometry | 375, 768, 1024, and 1440 pixels | No horizontal overflow; small-screen controls use a 44 px minimum |
| Production dependencies | `npm audit --omit=dev` | **0 vulnerabilities** after compatible updates |

## Reproduce

```bash
npm install
npm run setup:worker
npm run check
npm run test:worker
npm run test:stress
npm run build
```

The browser checks used a test-only user and a short-lived session. The original transcript fixture is explicitly labelled as test data. Neither the test session nor downloaded media belongs in the repository.

## Known limits

- The `faster-whisper` package imports successfully after a clean install, but downloading its model exceeded a two-minute hard limit in this sandbox. The local transcription fallback is implemented but **not live-verified here**.
- CC0 `flower.mp4` has no speech transcript, so its completed jobs correctly remain **partial** when audio succeeds. Caption serialization was verified separately with an original timed fixture.
- On-demand web ZIPs have a **95 MB** input-audio ceiling to bound memory. The standalone CLI has no such web limit and writes archives directly to disk.
- Web jobs are capped at 20 input URLs, 50 discovered items, and three workers. The CLI permits up to 500 discovered items.
- Development-only dependencies still report advisories through the broader audit; production dependencies are clean. No force upgrade was used.
